import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { categories, desks, places, roles } from "./catalog.js";
import {
  filterItems,
  formatDay,
  formatWhen,
  hrefWith,
  kindLabel,
  locationLabel,
  paginate,
  plural,
  sortItems,
  statusMeta,
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
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("view cache", false);

app.use("/assets", express.static(path.join(__dirname, "public"), { etag: true, maxAge: 0 }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

app.locals.statusMeta = statusMeta;
app.locals.locationLabel = locationLabel;
app.locals.formatWhen = formatWhen;
app.locals.formatDay = formatDay;
app.locals.kindLabel = kindLabel;
app.locals.plural = plural;
app.locals.hrefWith = hrefWith;
app.locals.categories = categories;
app.locals.places = places;
app.locals.desks = desks;
app.locals.roles = roles;

function cookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function deskOn(req) {
  const token = cookies(req).lf_desk;
  return Boolean(token && deskSessions.has(token));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

const NOTICES = {
  logged: (req) => {
    const ref = String(req.query.ref || "");
    return validRef(ref)
      ? `Logged. Your reference is ${ref}. Keep it — the security desk will ask for it.`
      : "Logged in the register.";
  },
  claimed: () => "Your claim is with the security desk. Bring your ID when you collect the item.",
  lead: () => "Your note was sent to the security desk. They will follow up if it matches.",
  approved: () => "Claim approved. The item is marked as returned.",
  rejected: () => "Claim declined. The item is open again.",
  released: () => "Item marked as returned to the owner.",
  resolved: () => "Lost report marked resolved.",
  code: () => "Desk code updated in the register.",
  unlocked: () => "Desk is open. Check an ID before you release anything.",
  locked: () => "Security desk signed out.",
};

const ERRORS = {
  desk: "That desk code does not match the register.",
  signedout: "Open the security desk before changing a record.",
  state: "That record changed before this could be saved. Look at it again.",
  review: "A claim is waiting on this item. Approve or decline it before a walk-in release.",
  release: "Enter the name and ID of the person collecting the item.",
  code: "Use 4 to 8 digits for the desk code.",
};

app.get("/favicon.ico", (_req, res) => res.status(204).end());

app.use((req, res, next) => {
  try {
    const data = load();
    res.locals.pendingCount = data.claims.filter((claim) => claim.status === "pending").length;
    res.locals.savedAt = data.savedAt || "";
    res.locals.deskOn = deskOn(req);
    res.locals.path = req.path;
    res.locals.today = todayISO();
    const noticeKey = typeof req.query.notice === "string" ? req.query.notice : "";
    const errorKey = typeof req.query.error === "string" ? req.query.error : "";
    res.locals.banner = "";
    res.locals.bannerTone = "";
    if (ERRORS[errorKey]) {
      res.locals.banner = ERRORS[errorKey];
      res.locals.bannerTone = "bad";
    } else if (NOTICES[noticeKey]) {
      res.locals.banner = NOTICES[noticeKey](req);
      res.locals.bannerTone = "good";
    }
    next();
  } catch (error) {
    next(error);
  }
});

function page(res, name, data = {}, status = 200) {
  res.status(status).render("layout", {
    errors: {},
    values: {},
    ...data,
    bodyView: name,
  });
}

function readQuery(req) {
  const kind = req.query.kind === "lost" || req.query.kind === "found" ? req.query.kind : "all";
  const category = categories.includes(req.query.category) ? req.query.category : "all";
  const place = places.includes(req.query.place) ? req.query.place : "all";
  const status = ["open", "desk", "review", "closed"].includes(req.query.status) ? req.query.status : "all";
  const sort = req.query.sort === "oldest" ? "oldest" : "newest";
  const pageNumber = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  return { q: clean(req.query.q, 80), kind, category, place, status, sort, page: pageNumber };
}

function active(item) {
  return item.status === "open" || item.status === "review";
}

function requireDesk(req, res, next) {
  if (!deskOn(req)) return res.redirect(303, "/desk?error=signedout");
  next();
}

function claimIdOk(id) {
  return /^CLM-[a-z0-9]{4,12}$/i.test(id);
}

app.get("/", (_req, res) => {
  const data = load();
  const items = data.items;
  const stats = {
    missing: items.filter((item) => item.kind === "lost" && item.status === "open").length,
    atDesk: items.filter((item) => item.kind === "found" && item.custody === "desk" && active(item)).length,
    review: data.claims.filter((claim) => claim.status === "pending").length,
    returned: items.filter((item) => item.status === "returned").length,
  };
  const newest = sortItems(items, "newest");
  const matchIds = new Set(
    items.filter((item) => active(item) && suggest(item, items).length > 0).map((item) => item.id),
  );
  const counts = new Map();
  for (const item of items) counts.set(item.place, (counts.get(item.place) || 0) + 1);
  const hotPlaces = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([place, count]) => ({ place, count }));
  page(res, "home", {
    title: "Lost & Found Register · USIU-Africa",
    stats,
    lostPreview: newest.filter((item) => item.kind === "lost" && item.status === "open").slice(0, 4),
    foundPreview: newest.filter((item) => item.kind === "found" && active(item)).slice(0, 4),
    slips: newest.filter((item) => item.kind === "found" && item.custody === "desk" && active(item)).slice(0, 3),
    hotPlaces,
    matchIds,
  });
});

app.get("/items", (req, res) => {
  const query = readQuery(req);
  const data = load();
  const filtered = sortItems(filterItems(data.items, query), query.sort);
  const pageResult = paginate(filtered, query.page, 8);
  if (pageResult.current !== query.page) {
    return res.redirect(302, hrefWith("/items", query, { page: pageResult.current }));
  }
  const matchIds = new Set(pageResult.slice.filter((item) => suggest(item, data.items).length > 0).map((item) => item.id));
  const hasFilters = Boolean(
    query.q || query.kind !== "all" || query.category !== "all" || query.place !== "all" || query.status !== "all" || query.sort !== "newest",
  );
  page(res, "items", {
    title: "The register · USIU-Africa",
    query,
    pageResult,
    matchIds,
    hasFilters,
  });
});

app.get("/report", (req, res) => {
  const kind = req.query.kind === "found" ? "found" : "lost";
  page(res, "report", {
    title: "Report an item · USIU-Africa",
    values: { kind, occurredOn: res.locals.today, handIn: "desk" },
  });
});

app.post("/report", (req, res) => {
  const parsed = validateReport(req.body, { categories, places, desks, roles, today: todayISO() });
  if (Object.keys(parsed.errors).length) {
    res.locals.banner = "Check the highlighted fields and try again.";
    res.locals.bannerTone = "bad";
    return page(res, "report", {
      title: "Report an item · USIU-Africa",
      errors: parsed.errors,
      values: { ...parsed.value, occurredOn: parsed.value.occurredOn || todayISO() },
    }, 400);
  }
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
      events: [
        {
          at: now,
          text:
            stored.kind === "found"
              ? stored.custody === "desk"
                ? `Logged as found and held at ${stored.desk}. Reference ${ref} issued.`
                : `Logged as found. The finder still has it and should hand it to a security desk. Reference ${ref} issued.`
              : `Logged as a lost report. Reference ${ref} issued.`,
        },
      ],
    };
    data.items.push(item);
    return item;
  });
  res.redirect(303, `/items/${created.ref}?notice=logged&ref=${created.ref}`);
});

app.get("/items/:id", (req, res) => {
  if (!validRef(req.params.id)) return page(res, "not-found", { title: "Not in the register · USIU-Africa" }, 404);
  const data = load();
  const item = data.items.find((entry) => entry.id === req.params.id);
  if (!item) return page(res, "not-found", { title: "Not in the register · USIU-Africa" }, 404);
  page(res, "item", {
    title: `${item.title} · Lost & Found`,
    item,
    matches: suggest(item, data.items),
    pendingClaim: data.claims.some((claim) => claim.itemId === item.id && claim.status === "pending"),
    form: "",
  });
});

app.post("/items/:id/claim", (req, res) => {
  if (!validRef(req.params.id)) return page(res, "not-found", { title: "Not in the register · USIU-Africa" }, 404);
  const parsed = validateClaim(req.body);
  const data = load();
  const item = data.items.find((entry) => entry.id === req.params.id);
  if (!item) return page(res, "not-found", { title: "Not in the register · USIU-Africa" }, 404);
  if (!parsed.ok) {
    res.locals.banner = "Check the highlighted fields and try again.";
    res.locals.bannerTone = "bad";
    return page(res, "item", {
      title: `${item.title} · Lost & Found`,
      item,
      matches: suggest(item, data.items),
      pendingClaim: data.claims.some((claim) => claim.itemId === item.id && claim.status === "pending"),
      errors: parsed.errors,
      values: parsed.value,
      form: "claim",
    }, 400);
  }
  const result = mutate((register) => {
    const current = register.items.find((entry) => entry.id === item.id);
    if (!current || current.kind !== "found" || current.status !== "open") return { ok: false };
    const now = new Date().toISOString();
    register.claims.push({
      id: `CLM-${crypto.randomBytes(3).toString("hex")}`,
      itemId: current.id,
      ...parsed.value,
      status: "pending",
      createdAt: now,
      resolvedAt: null,
    });
    current.status = "review";
    current.events.push({ at: now, text: "A claim was filed and is waiting at the security desk." });
    return { ok: true };
  });
  if (!result.ok) return res.redirect(303, `/items/${item.id}?error=state`);
  res.redirect(303, `/items/${item.id}?notice=claimed`);
});

app.post("/items/:id/lead", (req, res) => {
  if (!validRef(req.params.id)) return page(res, "not-found", { title: "Not in the register · USIU-Africa" }, 404);
  const parsed = validateLead(req.body);
  const data = load();
  const item = data.items.find((entry) => entry.id === req.params.id);
  if (!item) return page(res, "not-found", { title: "Not in the register · USIU-Africa" }, 404);
  if (!parsed.ok) {
    res.locals.banner = "Check the highlighted fields and try again.";
    res.locals.bannerTone = "bad";
    return page(res, "item", {
      title: `${item.title} · Lost & Found`,
      item,
      matches: suggest(item, data.items),
      pendingClaim: false,
      errors: parsed.errors,
      values: parsed.value,
      form: "lead",
    }, 400);
  }
  const result = mutate((register) => {
    const current = register.items.find((entry) => entry.id === item.id);
    if (!current || current.kind !== "lost" || current.status !== "open") return { ok: false };
    const now = new Date().toISOString();
    register.leads.push({
      id: `LED-${crypto.randomBytes(3).toString("hex")}`,
      itemId: current.id,
      ...parsed.value,
      createdAt: now,
    });
    current.events.push({ at: now, text: "Someone sent the desk a note about where this may have been seen." });
    return { ok: true };
  });
  if (!result.ok) return res.redirect(303, `/items/${item.id}?error=state`);
  res.redirect(303, `/items/${item.id}?notice=lead`);
});

function deskModel(data) {
  const byId = Object.fromEntries(data.items.map((item) => [item.id, item]));
  const withItem = (rows) => rows.map((row) => ({ ...row, item: byId[row.itemId] })).filter((row) => row.item);
  const byDate = (key) => (a, b) => (a[key] < b[key] ? 1 : -1);
  return {
    pending: withItem(data.claims.filter((claim) => claim.status === "pending")).sort(byDate("createdAt")),
    decisions: withItem(data.claims.filter((claim) => claim.status !== "pending")).sort(byDate("resolvedAt")).slice(0, 4),
    leads: withItem(data.leads).sort(byDate("createdAt")),
    holding: sortItems(
      data.items.filter((item) => item.kind === "found" && active(item)),
      "newest",
    ),
    missing: sortItems(
      data.items.filter((item) => item.kind === "lost" && item.status === "open"),
      "newest",
    ),
    closed: sortItems(
      data.items.filter((item) => item.status === "returned" || item.status === "resolved"),
      "newest",
    ).slice(0, 6),
    settings: data.settings,
  };
}

app.get("/desk", (req, res) => {
  const data = load();
  if (!deskOn(req)) {
    return page(res, "desk-login", {
      title: "Security desk · USIU-Africa",
      deskCode: data.settings.deskCode,
    });
  }
  const errorItem = validRef(req.query.item) ? req.query.item : "";
  page(res, "desk", {
    title: "Security desk · USIU-Africa",
    ...deskModel(data),
    errorItem,
  });
});

app.post("/desk/unlock", (req, res) => {
  const data = load();
  const code = clean(req.body.code, 12);
  if (!safeEqual(code, data.settings.deskCode)) return res.redirect(303, "/desk?error=desk");
  const token = crypto.randomBytes(24).toString("hex");
  deskSessions.add(token);
  res.setHeader("Set-Cookie", `lf_desk=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
  res.redirect(303, "/desk?notice=unlocked");
});

app.post("/desk/lock", (req, res) => {
  const token = cookies(req).lf_desk;
  if (token) deskSessions.delete(token);
  res.setHeader("Set-Cookie", "lf_desk=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.redirect(303, "/desk?notice=locked");
});

app.post("/desk/code", requireDesk, (req, res) => {
  const parsed = validateDeskCode(req.body.code);
  if (!parsed.ok) return res.redirect(303, "/desk?error=code");
  mutate((data) => {
    data.settings.deskCode = parsed.code;
  });
  res.redirect(303, "/desk?notice=code");
});

app.post("/desk/claims/:id/approve", requireDesk, (req, res) => {
  if (!claimIdOk(req.params.id)) return res.redirect(303, "/desk?error=state");
  const result = mutate((data) => {
    const claim = data.claims.find((entry) => entry.id === req.params.id);
    const item = claim && data.items.find((entry) => entry.id === claim.itemId);
    if (!claim || !item || claim.status !== "pending") return { ok: false };
    const now = new Date().toISOString();
    claim.status = "approved";
    claim.resolvedAt = now;
    item.status = "returned";
    item.custody = "owner";
    item.returnedAt = now;
    item.returnedTo = claim.name;
    item.returnedToId = claim.studentId;
    item.events.push({ at: now, text: "The security desk approved a claim and released the item." });
    return { ok: true };
  });
  res.redirect(303, result.ok ? "/desk?notice=approved" : "/desk?error=state");
});

app.post("/desk/claims/:id/reject", requireDesk, (req, res) => {
  if (!claimIdOk(req.params.id)) return res.redirect(303, "/desk?error=state");
  const result = mutate((data) => {
    const claim = data.claims.find((entry) => entry.id === req.params.id);
    const item = claim && data.items.find((entry) => entry.id === claim.itemId);
    if (!claim || !item || claim.status !== "pending") return { ok: false };
    const now = new Date().toISOString();
    claim.status = "rejected";
    claim.resolvedAt = now;
    const stillPending = data.claims.some((entry) => entry.itemId === item.id && entry.status === "pending");
    if (!stillPending && item.status === "review") item.status = "open";
    item.events.push({ at: now, text: "The security desk declined a claim. The item is still open." });
    return { ok: true };
  });
  res.redirect(303, result.ok ? "/desk?notice=rejected" : "/desk?error=state");
});

app.post("/desk/items/:id/release", requireDesk, (req, res) => {
  if (!validRef(req.params.id)) return res.redirect(303, "/desk?error=state");
  const parsed = validateRelease(req.body);
  if (!parsed.ok) return res.redirect(303, `/desk?error=release&item=${req.params.id}`);
  const result = mutate((data) => {
    const item = data.items.find((entry) => entry.id === req.params.id);
    if (!item || item.kind !== "found" || item.status !== "open") {
      if (item && item.status === "review") return { ok: false, reason: "review" };
      return { ok: false, reason: "state" };
    }
    const now = new Date().toISOString();
    item.status = "returned";
    item.custody = "owner";
    item.returnedAt = now;
    item.returnedTo = parsed.value.name;
    item.returnedToId = parsed.value.studentId;
    item.releaseNote = parsed.value.note;
    item.events.push({ at: now, text: "Released to the owner at the security desk." });
    return { ok: true };
  });
  if (!result.ok && result.reason === "review") return res.redirect(303, "/desk?error=review");
  res.redirect(303, result.ok ? "/desk?notice=released" : "/desk?error=state");
});

app.post("/desk/items/:id/resolve", requireDesk, (req, res) => {
  if (!validRef(req.params.id)) return res.redirect(303, "/desk?error=state");
  const result = mutate((data) => {
    const item = data.items.find((entry) => entry.id === req.params.id);
    if (!item || item.kind !== "lost" || item.status !== "open") return { ok: false };
    const now = new Date().toISOString();
    item.status = "resolved";
    item.events.push({ at: now, text: "The lost report was marked resolved." });
    return { ok: true };
  });
  res.redirect(303, result.ok ? "/desk?notice=resolved" : "/desk?error=state");
});

app.use((_req, res) => {
  page(res, "not-found", { title: "Not in the register · USIU-Africa" }, 404);
});

app.use((error, _req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  try {
    res.status(error.status || 500).render("layout", {
      bodyView: "error",
      title: "Register problem · USIU-Africa",
      banner: "",
      bannerTone: "",
      errors: {},
      values: {},
    });
  } catch (renderError) {
    console.error(renderError);
    res.status(500).type("text/plain").send("The register hit a problem.");
  }
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
