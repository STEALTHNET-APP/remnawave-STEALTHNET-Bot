// Before publishing a new release, update version.json and run:
// node scripts/sync-version.cjs
// This keeps package.json versions aligned with the single source of truth.

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf8"));

for (const relativePath of ["backend/package.json", "frontend/package.json", "bot/package.json"]) {
  const filePath = path.join(root, relativePath);
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  json.version = version;
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
}
