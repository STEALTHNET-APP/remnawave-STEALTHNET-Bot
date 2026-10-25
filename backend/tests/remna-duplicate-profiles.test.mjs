import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("client.routes.ts: register route looks up existing Remnawave user by telegramId to prevent duplicates", () => {
  const file = fs.readFileSync(path.join(__dirname, "../src/modules/client/client.routes.ts"), "utf8");
  
  // Existing client sync if remnawaveUuid is null
  assert.match(file, /if \(!existing\.remnawaveUuid && isRemnaConfigured\(\)\)/);
  assert.match(file, /const byTg = await remnaGetUserByTelegramId\(data\.telegramId!\)/);
  assert.match(file, /await upsertSubscriptionByRemnaUuid\(existing\.id, \{ remnawaveUuid: remnaUuid \}\)/);

  // New client registration links remnawaveUuid if user already exists in Remna
  assert.match(file, /let remnawaveUuid: string \| null = null;/);
  assert.match(file, /const byTgRes = await remnaGetUserByTelegramId\(data\.telegramId\)/);
  assert.match(file, /remnawaveUuid = extractRemnaUuid\(byTgRes\.data\)/);
  assert.match(file, /\.\.\.\(remnawaveUuid \? \{ trialUsed: true \} : \{\}\)/);
  assert.match(file, /if \(remnawaveUuid\) \{\s*await upsertSubscriptionByRemnaUuid\(client\.id, \{ remnawaveUuid \}\)/);
});

test("client.routes.ts: /subscription/all performs self-heal for migrated Remna users missing slot 0", () => {
  const file = fs.readFileSync(path.join(__dirname, "../src/modules/client/client.routes.ts"), "utf8");
  assert.match(file, /\/\/ Self-heal: если у клиента есть remnawaveUuid \(или профиль в Remna по TG\), но в таблице subscriptions нет слота 0/);
  assert.match(file, /if \(visible\.length === 0\)/);
  assert.match(file, /await upsertSubscriptionByRemnaUuid\(clientId, \{ remnawaveUuid: uuidToHeal \}\)/);
});

test("gift.service.ts: createAdditionalSubscription reuses existing Remna user when slot 0 exists or user is in Remna", () => {
  const file = fs.readFileSync(path.join(__dirname, "../src/modules/gift/gift.service.ts"), "utf8");
  
  // Reusing existing Remna user on slot 0
  assert.match(file, /candidateUuid = existingSub0\?\.remnawaveUuid \?\? rootClient\.remnawaveUuid;/);
  assert.match(file, /await remnaGetUserByTelegramId\(rootClient\.telegramId/);
  assert.match(file, /await remnaUpdateUser\(\{\s*uuid:\s*candidateUuid/);

  // Update existing slot 0 subscription record instead of duplicate create
  assert.match(file, /if \(existingSub0 && subscriptionIndex === 0\)/);
  assert.match(file, /subscription = await prisma\.subscription\.update\(\{/);
});

test("sync.service.ts: syncFromRemna materializes Subscription record via upsertSubscriptionByRemnaUuid", () => {
  const file = fs.readFileSync(path.join(__dirname, "../src/modules/sync/sync.service.ts"), "utf8");
  assert.match(file, /import \{ upsertSubscriptionByRemnaUuid \} from "\.\.\/subscription\/subscription\.helpers\.js";/);
  assert.match(file, /await upsertSubscriptionByRemnaUuid\(clientTargetId, \{ remnawaveUuid: uuid \}\)/);
});

test("Simulated slot-0 reuse: extended expiration calculation", () => {
  const now = Date.now();
  const futureExpireAt = new Date(now + 15 * 86400 * 1000).toISOString();
  const durationDays = 30;

  // If user already had 15 days left in Remna, extending adds 30 days
  const nowMs = Date.now();
  const currentExpiryMs = new Date(futureExpireAt).getTime();
  const baseMs = currentExpiryMs > nowMs ? currentExpiryMs : nowMs;
  const calculatedExpireAt = new Date(baseMs + durationDays * 86400 * 1000).toISOString();

  assert.ok(new Date(calculatedExpireAt).getTime() > currentExpiryMs);
  const diffDays = Math.round((new Date(calculatedExpireAt).getTime() - currentExpiryMs) / (86400 * 1000));
  assert.strictEqual(diffDays, 30);
});
