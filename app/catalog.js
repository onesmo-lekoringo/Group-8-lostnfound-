import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "register.json");

function readCatalog() {
  const register = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const catalog = register.settings?.catalog;
  if (
    !catalog ||
    !Array.isArray(catalog.categories) ||
    !Array.isArray(catalog.places) ||
    !Array.isArray(catalog.desks) ||
    !Array.isArray(catalog.roles)
  ) {
    throw new Error("The register catalog is incomplete.");
  }
  return catalog;
}

const catalog = readCatalog();

export const categories = catalog.categories;
export const places = catalog.places;
export const desks = catalog.desks;
export const roles = catalog.roles;
