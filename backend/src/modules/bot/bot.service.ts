/**
 * No-op shim после удаления multi-bot/clone-bots в v5.0.0.
 *
 * Сохраняет публичные сигнатуры старых helper-функций, чтобы потребители (client.routes,
 * gift.routes, sync.service, external-api.routes и т.д.) продолжали компилироваться без
 * массовых переписываний. Семантика:
 *   - markup всегда 0
 *   - "primary" / "single" бот = тот, чей токен лежит в process.env.BOT_TOKEN
 *   - getBotByToken возвращает stub если переданный токен совпадает с env, иначе null
 *
 * Поля baseAmount / botMarkupPercent / botMarkupAmount удалены из Payment вместе с
 * этим модулем — НЕ передавайте их в createPayment.
 */

import { getSystemConfig } from "../client/client.service.js";

export type StubBot = {
  id: string;
  token: string;
  username: string | null;
  isActive: boolean;
  isPrimary: boolean;
  markupPercent: number;
};

const PRIMARY_ID = "primary";

async function activeBotToken(): Promise<string> {
  try {
    const cfg = await getSystemConfig();
    return (cfg.telegramBotToken || process.env.BOT_TOKEN || "").trim();
  } catch {
    return "";
  }
}

export async function getPrimaryBot(): Promise<StubBot> {
  const token = await activeBotToken();
  return {
    id: PRIMARY_ID,
    token,
    username: null,
    isActive: true,
    isPrimary: true,
    markupPercent: 0,
  };
}

export async function getBotByToken(token: string): Promise<StubBot | null> {
  const t = (token ?? "").trim();
  const expected = await activeBotToken();
  if (!t || !expected || t !== expected) return null;
  return getPrimaryBot();
}

export function getBotById(_id: string): Promise<StubBot | null> {
  return getPrimaryBot();
}

export function listActiveBots(): Promise<StubBot[]> {
  return getPrimaryBot().then((b) => [b]);
}

export function applyMarkup(amount: number, _markupPercent?: number | null): number {
  return amount;
}

export type PaymentSnapshot = {
  amount: number;
};

export function paymentSnapshotProduct(_clientId: string, amount: number): Promise<PaymentSnapshot> {
  return Promise.resolve({
    amount,
  });
}

export function paymentSnapshotTopup(_clientId: string, amount: number): Promise<PaymentSnapshot> {
  return paymentSnapshotProduct(_clientId, amount);
}

export function buildPaymentMarkupSnapshot(amount: number): PaymentSnapshot {
  return { amount };
}

export async function getClientBotPaymentContext(_clientId: string): Promise<{
  bot: StubBot;
  markupPercent: number;
}> {
  const bot = await getPrimaryBot();
  return { bot, markupPercent: 0 };
}

export function getBotEarnings(): Promise<{ earned: number; paidOut: number; outstanding: number }> {
  return Promise.resolve({ earned: 0, paidOut: 0, outstanding: 0 });
}
