import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { categories, desks, places, roles } from "./catalog.js";
import { filterItems, suggest, todayISO, validateClaim, validateReport } from "./logic.js";
import { DATA_FILE, load, mutate } from "./store.js";

const register = JSON.parse(fs.readFileSync(new URL("../data/register.json", import.meta.url), "utf8"));
const byId = Object.fromEntries(register.items.map((item) => [item.id, item]));

test("phone reports match each other and not the laptop", () => {
  const ids = suggest(byId["LST-2026-1036"], register.items).map((match) => match.item.id);
  assert.ok(ids.includes("OB-2026-1038"));
  assert.equal(ids.includes("OB-2026-1008"), false);
});

test("calculus reports match across lost and found", () => {
  const ids = suggest(byId["OB-2026-1031"], register.items).map((match) => match.item.id);
  assert.deepEqual(ids, ["LST-2026-1030"]);
});

test("search finds a reference and a place without listing private contacts", () => {
  const hits = filterItems(register.items, {
    q: "OB-2026-1008",
    kind: "all",
    category: "all",
    place: "all",
    status: "all",
  });
  assert.equal(hits.length, 1);
  const library = filterItems(register.items, {
    q: "",
    kind: "all",
    category: "all",
    place: "Library & Information Center",
    status: "all",
  });
  assert.ok(library.length >= 2);
});

test("report validation rejects an empty item and accepts a found item at a desk", () => {
  const bad = validateReport({}, { categories, places, desks, roles, today: todayISO() });
  assert.ok(bad.errors.title);
  const good = validateReport(
    {
      kind: "found",
      title: "Grey hoodie",
      category: "Clothing & accessories",
      description: "Grey hoodie with a small USIU crest embroidered on the chest.",
      place: "Auditorium",
      occurredOn: "2026-11-18",
      reporterName: "Test Student",
      reporterRole: "Student",
      reporterContact: "test.student@usiu.demo",
      handIn: "desk",
      desk: "Administration Block — Security Desk",
    },
    { categories, places, desks, roles, today: "2026-11-19" },
  );
  assert.deepEqual(good.errors, {});
  assert.equal(good.value.custody, "desk");
});

test("a claim needs an ID and a private detail", () => {
  const weak = validateClaim({ name: "A", contact: "nope", studentId: "1", proof: "mine" });
  assert.ok(weak.errors.studentId);
  assert.ok(weak.errors.proof);
});

test("writes go to the JSON register and can be rolled back", () => {
  const before = fs.readFileSync(DATA_FILE, "utf8");
  try {
    mutate((data) => {
      data.items.push({
        id: "LST-2026-9999",
        ref: "LST-2026-9999",
        kind: "lost",
        title: "Temporary test slip",
        category: "Other",
        color: "",
        description: "Created by the automated check and removed immediately.",
        place: "Other",
        detail: "",
        occurredOn: "2026-11-19",
        status: "open",
        custody: "n/a",
        desk: "",
        reporterName: "Test",
        reporterContact: "test@usiu.demo",
        reporterRole: "Student",
        studentId: "",
        createdAt: "2026-11-19T12:00:00.000Z",
        returnedAt: null,
        returnedTo: "",
        returnedToId: "",
        releaseNote: "",
        events: [],
      });
    });
    assert.ok(load().items.some((item) => item.id === "LST-2026-9999"));
  } finally {
    fs.writeFileSync(DATA_FILE, before);
  }
  assert.equal(load().items.some((item) => item.id === "LST-2026-9999"), false);
});
