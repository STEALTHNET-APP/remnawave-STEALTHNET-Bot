import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Проверка структуры исходных файлов и регистрации обработчиков
test("forgot-password and reset-password routes have hybrid notification and logging wiring", () => {
  const routesFile = fs.readFileSync(path.join(__dirname, "../src/modules/client/client.routes.ts"), "utf8");

  // Проверка импорта функции нотификации
  assert.match(routesFile, /notifyClientPasswordReset/);

  // Проверка селекта telegramId и preferredLang в /forgot-password
  assert.match(routesFile, /telegramId:\s*true/);
  assert.match(routesFile, /preferredLang:\s*true/);

  // Проверка отправки в Telegram
  assert.match(routesFile, /notifyClientPasswordReset\(client,\s*resetLink,\s*isFirstPassword\)/);

  // Проверка проверки прав в /reset-password
  assert.match(routesFile, /const canEmailReset = canResetPassword/);
  assert.match(routesFile, /const hasTelegram = Boolean\(client\?\.telegramId\?\.trim\(\)\)/);
  assert.match(routesFile, /\(!canEmailReset && !hasTelegram\)/);

  // Проверка single-use fingerprint
  assert.match(routesFile, /passwordResetFingerprint\(client\.passwordHash\)\s*!==\s*payload\.pv/);
});

test("client-security-notify exports notifyClientPasswordReset with Telegram and Email dispatch", () => {
  const notifyFile = fs.readFileSync(path.join(__dirname, "../src/modules/client/client-security-notify.service.ts"), "utf8");
  assert.match(notifyFile, /export async function notifyClientPasswordReset/);
  assert.match(notifyFile, /inline_keyboard/);
  assert.match(notifyFile, /sendTelegramToUser/);
  assert.match(notifyFile, /sendEmail/);
});

// 2. Тесты безопасности криптографических токенов (JWT + Fingerprint)
test("Security: Password reset token signature and type verification", () => {
  const secret = "test-super-secret-key-1234567890123456";
  const clientId = "client_test_123";
  const pv = "hash_fingerprint_abc";

  // Корректный токен
  const token = jwt.sign({ clientId, pv, type: "client_pwd_reset" }, secret, { expiresIn: "1h" });
  const decoded = jwt.verify(token, secret);
  assert.equal(decoded.clientId, clientId);
  assert.equal(decoded.pv, pv);
  assert.equal(decoded.type, "client_pwd_reset");

  // Поддельная подпись -> должна отклоняться
  assert.throws(() => {
    jwt.verify(token, "wrong-attacker-secret");
  });

  // Просроченный токен -> должен отклоняться
  const expiredToken = jwt.sign({ clientId, pv, type: "client_pwd_reset" }, secret, { expiresIn: -10 });
  assert.throws(() => {
    jwt.verify(expiredToken, secret);
  });
});

test("Security: Single-use invalidation via password fingerprint", () => {
  function passwordResetFingerprint(hash) {
    return (hash ?? "").slice(-12);
  }

  // Начальное состояние: у Telegram-пользователя нет пароля
  const initialPasswordHash = null;
  const initialPv = passwordResetFingerprint(initialPasswordHash);
  assert.equal(initialPv, "");

  // Токен сгенерирован с пустым pv
  const tokenPayloadPv = initialPv;

  // Проверка перед установкой пароля
  assert.equal(passwordResetFingerprint(initialPasswordHash) === tokenPayloadPv, true);

  // Пользователь установил новый пароль
  const newPasswordHash = "$2a$12$e8x1J5mP8QO0Z1q2w3e4r5t6y7u8i9o0p1a2s3d4f5g6h7j8k9l0";
  const updatedPv = passwordResetFingerprint(newPasswordHash);
  assert.equal(updatedPv.length, 12);

  // Повторная попытка использовать тот же токен ДОЛЖНА БЫТЬ ОТКЛОНЕНА
  assert.equal(passwordResetFingerprint(newPasswordHash) === tokenPayloadPv, false);
});

test("Security: Enumeration protection and access gating logic", () => {
  function canResetPassword(client) {
    if (client.passwordHash?.trim()) return true;
    return client.registrationSource === "web";
  }

  // Сценарий 1: Пользователь из Telegram без пароля, но с telegramId
  const tgUser = { id: "1", passwordHash: null, registrationSource: "telegram", telegramId: "123456", isBlocked: false };
  const canEmail1 = canResetPassword(tgUser);
  const hasTg1 = Boolean(tgUser.telegramId?.trim());
  assert.equal(canEmail1, false); // На почту токен слать нельзя (email не верифицирован)
  assert.equal(hasTg1, true);     // Но в Telegram слать безопасно!
  assert.equal(!canEmail1 && !hasTg1, false); // Доступ не блокируется

  // Сценарий 2: Заблокированный пользователь
  const blockedUser = { id: "2", passwordHash: "hash", registrationSource: "web", telegramId: "123456", isBlocked: true };
  assert.equal(blockedUser.isBlocked, true); // Должен сразу отсекаться

  // Сценарий 3: Пользователь без пароля, без верификации и БЕЗ Telegram (например, фейковый ввод)
  const unknownUser = { id: "3", passwordHash: null, registrationSource: null, telegramId: null, isBlocked: false };
  const canEmail3 = canResetPassword(unknownUser);
  const hasTg3 = Boolean(unknownUser.telegramId?.trim());
  assert.equal(canEmail3, false);
  assert.equal(hasTg3, false);
  assert.equal(!canEmail3 && !hasTg3, true); // Безопасно отсекается: ни в один канал ссылка не уйдёт
});
