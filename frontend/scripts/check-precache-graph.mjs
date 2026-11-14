import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRECACHE_ENTRY = /url:"([^"]+)"/g;
const STATIC_IMPORT = /(?:from|import)\s*"\.\/([^"]+\.js)"/g;

export function parsePrecacheManifest(source) {
  const urls = new Set();
  for (const match of source.matchAll(PRECACHE_ENTRY)) urls.add(match[1]);
  return urls;
}

export function parseStaticImports(source) {
  const dependencies = new Set();
  for (const match of source.matchAll(STATIC_IMPORT)) dependencies.add(match[1]);
  return dependencies;
}

export function findPrecacheViolations(manifest, sources) {
  const violations = [];
  for (const [url, source] of sources) {
    if (!manifest.has(url) || !url.endsWith(".js")) continue;
    for (const dependency of parseStaticImports(source)) {
      const resolved = `assets/${dependency}`;
      if (!manifest.has(resolved)) violations.push({ file: url, missing: resolved });
    }
  }
  return violations;
}

async function main() {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
  const manifest = parsePrecacheManifest(await readFile(path.join(dist, "sw.js"), "utf8"));
  const sources = [];
  for (const url of manifest) {
    if (!url.endsWith(".js")) continue;
    sources.push([url, await readFile(path.join(dist, url), "utf8")]);
  }
  const violations = findPrecacheViolations(manifest, sources);
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`precache graph: ${violation.file} statically imports ${violation.missing}, which is not precached`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`precache graph ok: ${manifest.size} entries`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
