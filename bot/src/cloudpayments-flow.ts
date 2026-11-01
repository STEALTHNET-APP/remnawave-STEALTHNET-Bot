import type { Context, Composer } from "grammy";
import * as api from "./api.js";
const back = { text: "В меню", callback_data: "menu:main" };
const pendingEmails = new Map<number, { id: string; revision: string; recurring: boolean; expires: number }>();

export function clearCloudEmail(userId: number) { pendingEmails.delete(userId); }
setInterval(() => { for (const [id, pending] of pendingEmails) if (pending.expires < Date.now()) pendingEmails.delete(id); }, 60_000).unref();

export async function showCloudCheckout(ctx: Context, token: string, payment: { paymentId: string; payUrl: string }, direct: boolean) {
  if (!direct) { await ctx.reply("Счёт готов. Условия и сумма доступны перед оплатой.", { reply_markup: { inline_keyboard: [[{ text: "Перейти к оплате", url: payment.payUrl }], [back]] } }); return; }
  const quote = await api.cloudCheckoutQuote(token, payment.paymentId);
  const buttons = [];
  if (quote.recurring) buttons.push([{ text: "Согласен на автоплатёж — продолжить", callback_data: `cp:pay:${payment.paymentId}:1:${quote.revision}` }]);
  if (!quote.requiredRecurring) buttons.push([{ text: "Оплатить без автоплатежа", callback_data: `cp:pay:${payment.paymentId}:0:${quote.revision}` }]);
  buttons.push([back]);
  await ctx.reply(`${quote.product}\n\n${quote.terms}${quote.receiptRequired ? "\n\nДля отправки чека потребуется email. Он не изменит email вашего аккаунта." : ""}`, { reply_markup: { inline_keyboard: buttons } });
}
async function showAutopay(ctx: Context, token: string) {
  const { subscriptions } = await api.cloudSubscriptions(token);
  const active = subscriptions.filter(s => ["PENDING", "ACTIVE", "PAST_DUE", "CANCEL_PENDING"].includes(s.state));
  if (!active.length) { await ctx.reply("Активных автоплатежей CloudPayments нет.", { reply_markup: { inline_keyboard: [[back]] } }); return; }
  for (const row of active) {
    const status = { PENDING: "Ожидает оплаты", ACTIVE: "Активен", PAST_DUE: "Не удалось списать оплату", CANCEL_PENDING: "Отмена обрабатывается" }[row.state] || row.state;
    await ctx.reply(`${status} · ${row.amount} ${row.currency} каждые ${row.periodDays} дн.\n${row.nextChargeAt ? `Следующий платёж: ${new Date(row.nextChargeAt).toLocaleDateString("ru-RU")}` : "Первый платёж ещё не подтверждён"}`, { reply_markup: { inline_keyboard: [[{ text: "Отменить автоплатёж", callback_data: `cp:cancel:${row.id}` }], [back]] } });
  }
}
export function registerCloudPaymentsFlow(composer: Composer<Context>, getToken: (id: number, username?: string) => Promise<string | null>) {
  composer.command("autopay", async ctx => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    const token = await getToken(ctx.from.id, ctx.from.username);
    if (!token) return;
    try { await showAutopay(ctx, token); } catch { await ctx.reply("Не удалось загрузить автоплатежи. Повторите /autopay."); }
  });
  composer.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    pendingEmails.delete(ctx.from.id);
    if (data !== "menu:autopay" && !data.startsWith("cp:")) return next();
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCallbackQuery().catch(() => {});
    const token = await getToken(ctx.from.id, ctx.from.username);
    if (!token) return;
    try {
      if (data === "menu:autopay") { await showAutopay(ctx, token); return; }
      const [, action, id, flag, revision] = data.split(":");
      if (action === "pay") {
        const quote = await api.cloudCheckoutQuote(token, id);
        if (quote.revision !== revision) { await ctx.reply("Условия изменились. Откройте оплату заново."); return; }
        const choice = { id, revision, recurring: flag === "1", expires: Date.now() + 15 * 60_000 };
        if (quote.receiptRequired) {
          pendingEmails.set(ctx.from.id, choice);
          await ctx.reply("Введите email для отправки чека. Для отмены нажмите «В меню».", { reply_markup: { inline_keyboard: [[back]] } });
          return;
        }
        const result = await api.cloudHostedCheckout(token, id, choice);
        await ctx.reply("Сформировали ссылку на оплату.", { reply_markup: { inline_keyboard: [[{ text: "Оплатить", url: result.payUrl }], [back]] } });
      } else if (action === "cancel") {
        const { subscriptions } = await api.cloudSubscriptions(token);
        const row = subscriptions.find(s => s.id === id);
        if (!row) throw new Error("Автоплатёж не найден");
        await ctx.reply(row.trialEndsAt ? "Отменить автоплатёж? Пробный доступ закроется сразу." : "Отменить автоплатёж? Уже оплаченный доступ останется до окончания срока.", { reply_markup: { inline_keyboard: [[{ text: "Да, отменить автоплатёж", callback_data: `cp:stop:${id}` }], [{ text: "Назад", callback_data: "menu:autopay" }]] } });
      } else if (action === "stop") {
        await api.cloudCancel(token, id);
        await ctx.reply("Автоплатёж отменён.", { reply_markup: { inline_keyboard: [[back]] } });
      }
    } catch (e) { await ctx.reply(e instanceof Error ? e.message : "Не удалось выполнить запрос. Повторите позже."); }
  });
  composer.on("message:text", async (ctx, next) => {
    const pending = pendingEmails.get(ctx.from.id);
    if (!pending) return next();
    if (ctx.message.text.startsWith("/")) { pendingEmails.delete(ctx.from.id); return next(); }
    if (ctx.chat.type !== "private") return;
    if (pending.expires < Date.now()) { pendingEmails.delete(ctx.from.id); await ctx.reply("Время ввода истекло. Откройте оплату заново."); return; }
    const email = ctx.message.text.trim();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { await ctx.reply("Проверьте email и отправьте его ещё раз."); return; }
    const token = await getToken(ctx.from.id, ctx.from.username);
    if (!token) return;
    try {
      const result = await api.cloudHostedCheckout(token, pending.id, { ...pending, email });
      pendingEmails.delete(ctx.from.id);
      await ctx.reply("Сформировали ссылку на оплату. Чек будет отправлен на указанный email после успешной оплаты.", { reply_markup: { inline_keyboard: [[{ text: "Оплатить", url: result.payUrl }], [back]] } });
    } catch (e) { await ctx.reply(e instanceof Error ? e.message : "Не удалось создать ссылку. Повторите позже."); }
  });
}
