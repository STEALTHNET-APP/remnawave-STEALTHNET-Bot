/**
 * Уведомления пользователя в Telegram (пополнение баланса, оплата тарифа).
 * Вызывается из webhook'ов после успешной обработки платежа.
 */

import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";

async function sendTelegramToUser(telegramId: string, text: string): Promise<void> {
  const config = await getSystemConfig();
  const token = config.telegramBotToken?.trim();
  if (!token) {
    console.warn("[Telegram notify] Bot token not configured, skip notification");
    return;
  }
  const chatId = telegramId.trim();
  if (!chatId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || !data.ok) {
      console.warn("[Telegram notify] sendMessage failed", { chatId: chatId.slice(0, 8) + "...", error: data.description ?? res.statusText });
    }
  } catch (e) {
    console.warn("[Telegram notify] sendMessage error", e);
  }
}

function formatMoney(amount: number, currency: string): string {
  const curr = (currency || "RUB").toUpperCase();
  if (curr === "RUB") return `${amount.toFixed(2)} ₽`;
  if (curr === "USD") return `$${amount.toFixed(2)}`;
  return `${amount.toFixed(2)} ${curr}`;
}

/**
 * Отправить уведомление о пополнении баланса.
 */
export async function notifyBalanceToppedUp(clientId: string, amount: number, currency: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true },
  });
  if (!client?.telegramId) return;
  const text = `✅ <b>Баланс пополнен</b> на ${formatMoney(amount, currency)}.`;
  await sendTelegramToUser(client.telegramId, text);
}

/**
 * Отправить уведомление об оплате и активации тарифа.
 */
export async function notifyTariffActivated(clientId: string, paymentId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true },
  });
  if (!client?.telegramId) return;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { tariff: { select: { name: true } } },
  });
  const tariffName = payment?.tariff?.name?.trim() || "Тариф";
  const text = `✅ <b>Тариф «${escapeHtml(tariffName)}»</b> оплачен и активирован.\n\nМожете подключаться к VPN.`;
  await sendTelegramToUser(client.telegramId, text);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Отправить уведомление о создании прокси-слотов (после оплаты).
 */
export async function notifyProxySlotsCreated(clientId: string, slotIds: string[], tariffName?: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true } });
  if (!client?.telegramId || slotIds.length === 0) return;

  const slots = await prisma.proxySlot.findMany({
    where: { id: { in: slotIds } },
    select: { node: { select: { publicHost: true, socksPort: true, httpPort: true } }, login: true, password: true },
    orderBy: { createdAt: "asc" },
  });

  const name = tariffName?.trim() || "Прокси";
  let text = `✅ <b>Прокси «${escapeHtml(name)}»</b> оплачены.\n\n`;
  for (const s of slots) {
    const host = s.node.publicHost ?? "host";
    text += `• SOCKS5: <code>socks5://${escapeHtml(s.login)}:${escapeHtml(s.password)}@${escapeHtml(host)}:${s.node.socksPort}</code>\n`;
    text += `• HTTP: <code>http://${escapeHtml(s.login)}:${escapeHtml(s.password)}@${escapeHtml(host)}:${s.node.httpPort}</code>\n\n`;
  }
  text += "Скопируйте строку в настройки прокси вашего приложения.";

  await sendTelegramToUser(client.telegramId, text);
}
