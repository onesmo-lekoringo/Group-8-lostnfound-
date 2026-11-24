const STOP = new Set(
  `with from that this your have been were them they into over under near left
   item lost found still and the for not yet was are but its his her she him
   you our out off any all can had has will just than then also onto about
   black white blue navy brown gold silver yellow grey gray red green pink
   matte cover name inside case corner front right left top small inch first
   edition hardcover textbook desk security student campus colour color`.split(
    /\s+/,
  ),
);

export function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function tokens(text) {
  return [
    ...new Set(
      String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9+]+/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3 && !STOP.has(word)),
    ),
  ];
}

export function validContact(value) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15 && /^[+0-9]/.test(value);
}

export function validId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9 /-]{2,19}$/.test(value);
}

export function validRef(id) {
  return /^(OB|LST)-\d{4}-\d{3,6}$/.test(String(id || ""));
}

export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return "";
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

export function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function kindLabel(kind) {
  return kind === "found" ? "Found item" : "Lost report";
}

export function locationLabel(item) {
  if (!item) return "";
  return item.detail ? `${item.place} — ${item.detail}` : item.place || "";
}

export function statusMeta(item) {
  if (!item) return { key: "open", label: "Open" };
  if (item.kind === "lost" && item.status === "open") return { key: "missing", label: "Still missing" };
  if (item.kind === "lost" && item.status === "resolved") return { key: "resolved", label: "Resolved" };
  if (item.kind === "found" && item.status === "returned") return { key: "returned", label: "Returned" };
  if (item.status === "review") return { key: "review", label: "Claim in review" };
  if (item.kind === "found" && item.custody === "finder") return { key: "finder", label: "With the finder" };
  if (item.kind === "found" && item.custody === "desk") return { key: "desk", label: "At the security desk" };
  return { key: "open", label: "Open" };
}

export function plural(n, singular, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function validateReport(body, { categories, places, desks, roles, today }) {
  const errors = {};
  const kind = body.kind === "found" || body.kind === "lost" ? body.kind : "";
  if (!kind) errors.kind = "Choose lost or found.";

  const title = clean(body.title, 80);
  if (title.length < 3) errors.title = "Give the item a short name (at least 3 characters).";

  const category = categories.includes(body.category) ? body.category : "";
  if (!category) errors.category = "Choose a category.";

  const color = clean(body.color, 40);
  const description = clean(body.description, 800);
  if (description.length < 12) errors.description = "Add a few details someone could recognise — marks, contents, or what is printed on it.";

  const place = places.includes(body.place) ? body.place : "";
  if (!place) errors.place = "Choose the place on campus.";

  const detail = clean(body.detail, 80);
  const occurredOn = String(body.occurredOn || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || occurredOn > today) {
    errors.occurredOn = "Choose a date that is today or earlier.";
  }

  const reporterName = clean(body.reporterName, 80);
  if (reporterName.length < 2) errors.reporterName = "Enter your name so the desk can reach you.";

  const reporterRole = roles.includes(body.reporterRole) ? body.reporterRole : "";
  if (!reporterRole) errors.reporterRole = "Choose student, staff, faculty, or visitor.";

  const studentId = clean(body.studentId, 20);
  if (studentId && !validId(studentId)) errors.studentId = "Use letters and numbers only, or leave ID blank.";

  const reporterContact = clean(body.reporterContact, 80);
  if (!validContact(reporterContact)) errors.reporterContact = "Enter a phone number or email.";

  let custody = "n/a";
  let desk = "";
  let handIn = "";
  if (kind === "found") {
    handIn = body.handIn === "finder" || body.handIn === "desk" ? body.handIn : "";
    if (!handIn) errors.handIn = "Say whether a security desk has the item or you still do.";
    if (handIn === "desk") {
      desk = desks.includes(body.desk) ? body.desk : "";
      if (!desk) errors.desk = "Choose the security desk holding the item.";
      custody = "desk";
    } else if (handIn === "finder") {
      custody = "finder";
    }
  }

  return {
    errors,
    value: {
      kind,
      title,
      category,
      color,
      description,
      place,
      detail,
      occurredOn,
      reporterName,
      reporterRole,
      studentId,
      reporterContact,
      custody,
      desk,
      handIn,
    },
  };
}

export function validateClaim(body) {
  const errors = {};
  const name = clean(body.name, 80);
  const contact = clean(body.contact, 80);
  const studentId = clean(body.studentId, 20);
  const proof = clean(body.proof, 500);
  if (name.length < 2) errors.name = "Enter the name on your ID.";
  if (!validContact(contact)) errors.contact = "Enter a phone number or email the desk can use.";
  if (!validId(studentId)) errors.studentId = "Enter the ID you will show at the desk.";
  if (proof.length < 12) errors.proof = "Add a detail that is not already in the public description.";
  return { ok: Object.keys(errors).length === 0, errors, value: { name, contact, studentId, proof } };
}

export function validateLead(body) {
  const errors = {};
  const name = clean(body.name, 80);
  const contact = clean(body.contact, 80);
  const message = clean(body.message, 500);
  if (name.length < 2) errors.name = "Enter your name.";
  if (!validContact(contact)) errors.contact = "Enter a phone number or email.";
  if (message.length < 12) errors.message = "Say where and when you saw it.";
  return { ok: Object.keys(errors).length === 0, errors, value: { name, contact, message } };
}

export function validateRelease(body) {
  const errors = {};
  const name = clean(body.name, 80);
  const studentId = clean(body.studentId, 20);
  const note = clean(body.note, 200);
  if (name.length < 2) errors.name = "Enter the collector's name.";
  if (!validId(studentId)) errors.studentId = "Enter the ID you checked.";
  return { ok: Object.keys(errors).length === 0, errors, value: { name, studentId, note } };
}

export function validateDeskCode(value) {
  const code = clean(value, 8);
  if (!/^\d{4,8}$/.test(code)) return { ok: false };
  return { ok: true, code };
}

export function suggest(item, items) {
  const mine = new Set(tokens(`${item.title} ${item.description}`));
  const out = [];
  for (const other of items) {
    if (other.id === item.id || other.kind === item.kind) continue;
    const reasons = [];
    let score = 0;
    if (other.category === item.category) {
      score += 3;
      reasons.push("Same category");
    }
    if (item.color && other.color && item.color.toLowerCase() === other.color.toLowerCase()) {
      score += 2;
      reasons.push("Same colour");
    }
    if (item.place && other.place === item.place) {
      score += 2;
      reasons.push("Same place");
    }
    const theirs = new Set(tokens(`${other.title} ${other.description}`));
    const shared = [...mine].filter((word) => theirs.has(word));
    if (shared.length) {
      score += Math.min(shared.length, 4);
      const shown = shared.slice(0, 2).map((word) => `“${word}”`).join(", ");
      reasons.push(`Both mention ${shown}`);
    }
    if (other.status === "open" || other.status === "review") score += 1;
    const strong = shared.length > 0 || item.place === other.place;
    if (score >= 5 && strong && reasons.length) out.push({ item: other, score, reasons });
  }
  out.sort((a, b) => b.score - a.score || (a.item.createdAt < b.item.createdAt ? 1 : -1));
  return out.slice(0, 3);
}

export function filterItems(items, query) {
  const needle = String(query.q || "").trim().toLowerCase();
  const words = needle.split(/\s+/).filter((word) => word.length > 1);
  return items.filter((item) => {
    if (query.kind !== "all" && item.kind !== query.kind) return false;
    if (query.category !== "all" && item.category !== query.category) return false;
    if (query.place !== "all" && item.place !== query.place) return false;
    if (query.status === "open" && item.status !== "open" && item.status !== "review") return false;
    if (
      query.status === "desk" &&
      !(item.kind === "found" && item.custody === "desk" && (item.status === "open" || item.status === "review"))
    ) {
      return false;
    }
    if (query.status === "review" && item.status !== "review") return false;
    if (query.status === "closed" && item.status !== "returned" && item.status !== "resolved") return false;
    if (!needle) return true;
    const hay = `${item.ref} ${item.title} ${item.description} ${item.category} ${item.color} ${item.place} ${item.detail} ${item.kind}`.toLowerCase();
    if (hay.includes(needle)) return true;
    return words.length > 0 && words.every((word) => hay.includes(word));
  });
}

export function sortItems(items, sort) {
  return [...items].sort((a, b) => {
    if (a.createdAt === b.createdAt) return a.ref < b.ref ? -1 : 1;
    const olderFirst = a.createdAt < b.createdAt ? -1 : 1;
    return sort === "oldest" ? olderFirst : -olderFirst;
  });
}

export function paginate(list, page, perPage = 8) {
  const pages = Math.max(1, Math.ceil(list.length / perPage) || 1);
  const current = Math.min(Math.max(1, page || 1), pages);
  const start = (current - 1) * perPage;
  return { pages, current, total: list.length, slice: list.slice(start, start + perPage) };
}

export function hrefWith(base, query, overrides = {}) {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();
  for (const key of ["q", "kind", "category", "status", "place", "sort", "page"]) {
    const value = merged[key];
    if (value === undefined || value === null || value === "" || value === "all") continue;
    if (key === "page" && Number(value) <= 1) continue;
    if (key === "sort" && value === "newest") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}
