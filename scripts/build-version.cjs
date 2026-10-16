const fs = require("node:fs");
const path = process.argv[2] || "version.json";
const version = JSON.parse(fs.readFileSync(path, "utf8"));
const commit = process.env.BUILD_COMMIT || "unknown";
const builtAt = process.env.BUILD_DATE || new Date().toISOString();
if (commit !== "unknown" && !/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid build commit");
if (!Number.isFinite(Date.parse(builtAt))) throw new Error("Invalid build date");
fs.writeFileSync(path, JSON.stringify({ ...version, commit, builtAt }, null, 2) + "\n");
