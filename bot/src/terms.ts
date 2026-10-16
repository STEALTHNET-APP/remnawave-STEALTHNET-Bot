import type { Context, MiddlewareFn } from "grammy";
import type { BotTermsStatus } from "./api.js";

type TermsApi = {
  getBotTerms: (telegramId: number, pendingStart?: string) => Promise<BotTermsStatus>;
  acceptBotTerms: (telegramId: number, version: string) => Promise<BotTermsStatus>;
};

export function createTermsGate(api: TermsApi, resume: (ctx: Context, payload: string) => Promise<void>): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot || (!ctx.message && !ctx.callbackQuery)) return next();
    if (ctx.chat?.type !== "private") return;
    const english = ctx.from.language_code?.startsWith("en") ?? false;
    const data = ctx.callbackQuery?.data ?? "";
    const command = ctx.message?.text?.match(/^\/(start|link)(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/);
    const pendingStart = command ? (command[1] === "link" && command[2] ? `link_${command[2]}` : command[2] || undefined) : undefined;
    let status: BotTermsStatus;
    try {
      if (data.startsWith("terms:accept:")) {
        await ctx.answerCallbackQuery().catch(() => {});
        status = await api.acceptBotTerms(ctx.from.id, data.slice("terms:accept:".length));
      } else {
        status = await api.getBotTerms(ctx.from.id, pendingStart);
      }
    } catch {
      if (ctx.callbackQuery && !data.startsWith("terms:accept:")) await ctx.answerCallbackQuery().catch(() => {});
      await ctx.reply(english ? "Unable to check the terms. Please try /start again later." : "Не удалось проверить условия. Попробуйте /start чуть позже.");
      return;
    }
    if (data.startsWith("terms:accept:") && status.accepted) {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
      if (status.completed || !status.required) {
        await resume(ctx, status.pendingStart ?? "");
      } else {
        await ctx.reply(english ? "Already accepted. Open /start to continue." : "Условия уже приняты. Для продолжения нажмите /start.");
      }
      return;
    }
    if (status.accepted) return next();
    if (ctx.callbackQuery && !data.startsWith("terms:accept:")) await ctx.answerCallbackQuery().catch(() => {});
    const labels: Record<string, string> = english
      ? { agreement: "User agreement", offer: "Public offer", refund: "Refund policy" }
      : { agreement: "Пользовательское соглашение", offer: "Публичная оферта", refund: "Политика возврата" };
    await ctx.reply(english ? "Before using the bot, please read and accept the terms below." : "Перед использованием бота ознакомьтесь с документами ниже и примите условия.", {
      reply_markup: { inline_keyboard: [
        ...status.documents.map((doc) => [{ text: labels[doc.kind] ?? doc.kind, url: doc.url }]),
        [{ text: english ? "Accept" : "Принимаю", callback_data: `terms:accept:${status.version}` }],
      ] },
    });
  };
}
