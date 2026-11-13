import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface WidgetPreferences {
  isClassic(userId: number): Promise<boolean>;
  setClassic(userId: number, classic: boolean): Promise<void>;
}

export function createFileWidgetPreferences(directory: string): WidgetPreferences {
  const path = (userId: number) => {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid Telegram user ID");
    return join(directory, `${userId}.json`);
  };
  return {
    async isClassic(userId) {
      try {
        const preference = JSON.parse(await readFile(path(userId), "utf8"));
        if (preference?.classic !== true) throw new Error("Invalid widget preference");
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async setClassic(userId, classic) {
      const destination = path(userId);
      if (!classic) {
        await rm(destination, { force: true });
        return;
      }
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${destination}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ classic: true }), { flag: "wx", mode: 0o600 });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    },
  };
}

export function createMemoryWidgetPreferences(): WidgetPreferences {
  const users = new Set<number>();
  return {
    async isClassic(userId) { return users.has(userId); },
    async setClassic(userId, classic) { if (classic) users.add(userId); else users.delete(userId); },
  };
}
