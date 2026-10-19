import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

export async function starsApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.BOT_TOKEN?.trim();
  if (!token) throw new Error("Токен Telegram-бота не настроен");
  const response = await proxyFetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  }, await getProxyUrl("telegram"));
  const data = await response.json() as { ok: boolean; result?: T; description?: string };
  if (!data.ok || !response.ok) throw new Error(data.description || "Telegram Stars временно недоступны");
  return data.result as T;
}

export function starsAmount(amountRub: number, rubPerStar: number): number {
  if (!Number.isFinite(amountRub) || amountRub <= 0 || !Number.isFinite(rubPerStar) || rubPerStar <= 0) {
    throw new Error("Укажите положительную цену и стоимость звезды");
  }
  const amount = Math.ceil(Number((amountRub / rubPerStar).toPrecision(14)));
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) throw new Error("Сумма должна составлять от 1 до 1000000 Stars");
  return amount;
}
