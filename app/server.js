import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { categories, desks, places, roles } from "./catalog.js";
import {
  filterItems,
  paginate,
  sortItems,
  suggest,
  todayISO,
  validRef,
  validateClaim,
  validateDeskCode,
  validateLead,
  validateRelease,
  validateReport,
  clean,
} from "./logic.js";
import { load, mutate } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const deskSessions = new Set();

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use("/assets", express.static(path.join(__dirname, "public"), { etag: true, maxAge: 0 }));

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function deskOn(req) {
  const token = cookies(req).lf_desk;
  return Boolean(token && deskSessions.has(token));
}

function requireDesk(req, res, next) {
  if (!deskOn(req)) return res.status(401).json({ error: "Open the security desk before changing a record." });
  next();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicItem(item) {
  const { reporterName, reporterContact, reporterRole, studentId, ...publicFields } = item;
  return publicFields;
}

app.get("/api/status", (req, res) => {
  const data = load();
  res.json({
    deskOn: deskOn(req),
    savedAt: data.savedAt || "",
    pendingCount: data.claims.filter((claim) => claim.status === "pending").length,
  });
});

app.get("/api/catalog", (_req, res) => {
  res.json({ categories, places, desks, roles, today: todayISO() });
});

app.get("/api/items", (req, res) => {
  const data = load();
  const query = {
    q: clean(req.query.q, 80),
    kind: req.query.kind === "lost" || req.query.kind === "found" ? req.query.kind : "all",
    category: categories.includes(req.query.category) ? req.query.category : "all",
    place: places.includes(req.query.place) ? req.query.place : "all",
    status: ["open", "desk", "review", "closed"].includes(req.query.status) ? req.query.status : "all",
    sort: req.query.sort === "oldest" ? "oldest" : "newest",
  };
  const pageNumber = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const filtered = sortItems(filterItems(data.items, query), query.sort);
  const result = paginate(filtered, pageNumber, 8);
  res.json({
    items: result.slice.map(publicItem),
    ...result,
    slice: result.slice.map(publicItem),
  });
});

app.get("/api/items/:id", (req, res) => {
  if (!validRef(req.params.id)) return res.status(404).json({ error: "Not found." });
  const data = load();
  const item = data.items.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found." });
  res.json({
    item: publicItem(item),
    matches: suggest(item, data.items).map((match) => ({ ...match, item: publicItem(match.item) })),
    pendingClaim: data.claims.some((claim) => claim.itemId === item.id && claim.status === "pending"),
  });
});

app.post("/api/report", (req, res) => {
  const parsed = validateReport(req.body, { categories, places, desks, roles, today: todayISO() });
  if (Object.keys(parsed.errors).length) return res.status(400).json({ errors: parsed.errors });
  const created = mutate((data) => {
    const number = Number(data.settings.nextNumber) || 2000;
    data.settings.nextNumber = number + 1;
    const year = todayISO().slice(0, 4);
    const ref = `${parsed.value.kind === "found" ? "OB" : "LST"}-${year}-${number}`;
    const now = new Date().toISOString();
    const { handIn: _handIn, ...stored } = parsed.value;
    const item = {
      id: ref,
      ref,
      ...stored,
      status: "open",
      createdAt: now,
      returnedAt: null,
      returnedTo: "",
      returnedToId: "",
      releaseNote: "",
      events: [{
        at: now,
        text: stored.kind === "found"
          ? stored.custody === "desk"
            ? `Logged as found and held at ${stored.desk}. Reference ${ref} issued.`
            : `Logged as found. The finder still has it. Reference ${ref} issued.`
          : `Logged as a lost report. Reference ${ref} issued.`,
      }],
    };
    data.items.push(item);
    return item;
  });
  res.status(201).json({ item: publicItem(created), ref: created.ref });
});

app.post("/api/items/:id/claim", (req, res) => {
  const parsed = validateClaim(req.body);
  if (!parsed.ok) return res.status(400).json({ errors: parsed.errors });
  const result = mutate((data) => {
    const item = data.items.find((entry) => entry.id === req.params.id);
    if (!item || item.kind !== "found" || item.status !== "open") return { ok: false };
    const now = new Date().toISOString();
    data.claims.push({
      id: `CLM-${crypto.randomBytes(3).toString("hex")}`,
      itemId: item.id,
      ...parsed.value,
      status: "pending",
      createdAt: now,
      resolvedAt: null,
    });
    item.status = "review";
    item.events.push({ at: now, text: "A claim was filed and is waiting at the security desk." });
    return { ok: true };
  });
  res.status(result.ok ? 201 : 409).json(result);
});

app.post("/api/items/:id/lead", (req, res) => {
  const parsed = validateLead(req.body);
  if (!parsed.ok) return res.status(400).json({ errors: parsed.errors });
  const result = mutate((data) => {
    const item = data.items.find((entry) => entry.id === req.params.id);
    if (!item || item.kind !== "lost" || item.status !== "open") return { ok: false };
    const now = new Date().toISOString();
    data.leads.push({
      id: `LED-${crypto.randomBytes(3).toString("hex")}`,
      itemId: item.id,
      ...parsed.value,
      createdAt: now,
    });
    item.events.push({ at: now, text: "Someone sent the desk a note about this lost item." });
    return { ok: true };
  });
  res.status(result.ok ? 201 : 409).json(result);
});

app.post("/api/desk/unlock", (req, res) => {
  const code = clean(req.body.code, 12);
  const data = load();
  if (!safeEqual(code, data.settings.deskCode)) return res.status(401).json({ error: "That desk code does not match." });
  const token = crypto.randomBytes(24).toString("hex");
  deskSessions.add(token);
  res.setHeader("Set-Cookie", `lf_desk=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
  res.json({ ok: true });
});

app.post("/api/desk/lock", (req, res) => {
  const token = cookies(req).lf_desk;
  if (token) deskSessions.delete(token);
  res.setHeader("Set-Cookie", "lf_desk=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/desk", requireDesk, (_req, res) => {
  const data = load();
  res.json(data);
});

app.post("/api/desk/code", requireDesk, (req, res) => {
  const parsed = validateDeskCode(req.body.code);
  if (!parsed.ok) return res.status(400).json({ error: "Use 4 to 8 digits." });
  mutate((data) => { data.settings.deskCode = parsed.code; });
  res.json({ ok: true });
});

app.post("/api/desk/claims/:id/:action", requireDesk, (req, res) => {
  if (!/^CLM-[a-z0-9]{4,12}$/i.test(req.params.id) || !["approve", "reject"].includes(req.params.action)) {
    return res.status(400).json({ error: "Invalid action." });
  }
  const result = mutate((data) => {
    const claim = data.claims.find((entry) => entry.id === req.params.id);
    const item = claim && data.items.find((entry) => entry.id === claim.itemId);
    if (!claim || !item || claim.status !== "pending") return { ok: false };
    const now = new Date().toISOString();
    claim.status = req.params.action === "approve" ? "approved" : "rejected";
    claim.resolvedAt = now;
    if (req.params.action === "approve") {
      item.status = "returned";
      item.custody = "owner";
      item.returnedAt = now;
      item.returnedTo = claim.name;
      item.returnedToId = claim.studentId;
      item.events.push({ at: now, text: "The security desk approved the claim and released the item." });
    } else {
      if (!data.claims.some((entry) => entry.itemId === item.id && entry.status === "pending")) item.status = "open";
      item.events.push({ at: now, text: "The security desk declined the claim." });
    }
    return { ok: true };
  });
  res.status(result.ok ? 200 : 409).json(result);
});

app.post("/api/desk/items/:id/:action", requireDesk, (req, res) => {
  if (!validRef(req.params.id) || !["release", "resolve"].includes(req.params.action)) {
    return res.status(400).json({ error: "Invalid action." });
  }
  const result = mutate((data) => {
    const item = data.items.find((entry) => entry.id === req.params.id);
    if (!item) return { ok: false };
    const now = new Date().toISOString();
    if (req.params.action === "resolve") {
      if (item.kind !== "lost" || item.status !== "open") return { ok: false };
      item.status = "resolved";
      item.events.push({ at: now, text: "The lost report was marked resolved." });
    } else {
      const parsed = validateRelease(req.body);
      if (!parsed.ok) return { ok: false, errors: parsed.errors };
      if (item.kind !== "found" || item.status !== "open") return { ok: false };
      item.status = "returned";
      item.custody = "owner";
      item.returnedAt = now;
      item.returnedTo = parsed.value.name;
      item.returnedToId = parsed.value.studentId;
      item.releaseNote = parsed.value.note;
      item.events.push({ at: now, text: "Released to the owner at the security desk." });
    }
    return { ok: true };
  });
  res.status(result.ok ? 200 : 400).json(result);
});

app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : "The register hit a problem." });
});

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const server = app.listen(port, host, () => {
  console.log(`Lost & Found register listening on ${host}:${port}`);
});
server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
