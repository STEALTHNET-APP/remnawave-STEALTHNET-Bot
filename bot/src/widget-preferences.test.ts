import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileWidgetPreferences } from "./widget-preferences.js";

test("menu choices survive a new store instance and remain isolated per Telegram user", async () => {
  const directory = await mkdtemp(join(tmpdir(), "widget-preferences-"));
  try {
    const first = createFileWidgetPreferences(directory);
    assert.equal(await first.isClassic(123), false);
    await Promise.all([first.setClassic(123, true), first.setClassic(456, true)]);
    const restarted = createFileWidgetPreferences(directory);
    assert.equal(await restarted.isClassic(123), true);
    assert.equal(await restarted.isClassic(456), true);
    assert.equal(await restarted.isClassic(789), false);
    await restarted.setClassic(123, false);
    const again = createFileWidgetPreferences(directory);
    assert.equal(await again.isClassic(123), false);
    assert.equal(await again.isClassic(456), true);
    assert.deepEqual(await readdir(directory), ["456.json"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid IDs and corrupt preferences fail instead of erasing the user's choice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "widget-preferences-"));
  try {
    const store = createFileWidgetPreferences(directory);
    for (const id of [0, -1, NaN, Infinity, 1.5]) {
      await assert.rejects(store.isClassic(id), /Invalid Telegram user ID/);
      await assert.rejects(store.setClassic(id, true), /Invalid Telegram user ID/);
    }
    await writeFile(join(directory, "123.json"), "corrupt");
    await assert.rejects(store.isClassic(123));
    await writeFile(join(directory, "123.json"), '{"classic":false}');
    await assert.rejects(store.isClassic(123), /Invalid widget preference/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
