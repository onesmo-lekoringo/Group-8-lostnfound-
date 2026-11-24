import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_FILE = path.join(__dirname, "..", "data", "register.json");

function readFresh() {
  if (!fs.existsSync(DATA_FILE)) {
    const error = new Error("The register file is missing.");
    error.status = 500;
    throw error;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    const error = new Error("The register file is not valid JSON.");
    error.status = 500;
    throw error;
  }
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.claims) || !Array.isArray(data.leads)) {
    const error = new Error("The register file is incomplete.");
    error.status = 500;
    throw error;
  }
  if (
    !data.settings ||
    typeof data.settings.deskCode !== "string" ||
    !data.settings.catalog ||
    !Array.isArray(data.settings.catalog.categories) ||
    !Array.isArray(data.settings.catalog.places) ||
    !Array.isArray(data.settings.catalog.desks) ||
    !Array.isArray(data.settings.catalog.roles)
  ) {
    const error = new Error("The register settings are incomplete.");
    error.status = 500;
    throw error;
  }
  return data;
}

export function load() {
  return readFresh();
}

function acquire() {
  const lock = `${DATA_FILE}.lock`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return fs.openSync(lock, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const stat = fs.statSync(lock);
        if (Date.now() - stat.mtimeMs > 5000) fs.unlinkSync(lock);
      } catch {
        // another writer removed it
      }
      const until = Date.now() + 25;
      while (Date.now() < until) {
        // brief spin; the register is a single JSON file
      }
    }
  }
  const error = new Error("The register is busy. Try again.");
  error.status = 503;
  throw error;
}

export function mutate(fn) {
  const fd = acquire();
  try {
    const data = readFresh();
    const result = fn(data);
    data.savedAt = new Date().toISOString();
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(tmp, DATA_FILE);
    return result;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(`${DATA_FILE}.lock`);
  }
}
