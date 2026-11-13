import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type AppVersionFile = { version: string; commit?: string; builtAt?: string };

const versionPath = [
  path.resolve(process.cwd(), "version.json"),
  path.resolve(process.cwd(), "../version.json"),
].find((candidate) => existsSync(candidate));

if (!versionPath) {
  throw new Error("version.json not found");
}

const versionFile = JSON.parse(readFileSync(versionPath, "utf8")) as AppVersionFile;

export const APP_VERSION = versionFile.version;

export const APP_BUILD = { version: APP_VERSION, commit: versionFile.commit ?? null, builtAt: versionFile.builtAt ?? null };
