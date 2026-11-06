import { Composer } from "grammy";
import type { Context } from "grammy";
import * as api from "../api.js";
import { _t, blockUnsubscribedCallback, buildHelpScreen, callbackUi, editMessageContent, getOrRestoreToken, getUserLang, setTranslations } from "./shared.js";
import { resolveCallbackDomain } from "./routing.js";

export function createSupportHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

composer.command("support", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const token = await getOrRestoreToken(userId, ctx.from?.username);
  if (!token) {
    await ctx.reply("🔐 Сначала запустите бота через /start");
    return;
  }
  try {
    const cfg = await api.getPublicConfig().catch(() => null);
    const tgId = String(userId);
    const tgUsername = ctx.from?.username ?? "";
    let subsCount = 0;
    try {
      const subs = await api.getAllSubscriptions(token);
      subsCount = subs.items?.length ?? 0;
    } catch { /* ignore */ }
    // тот же билд, что и callback menu:support → ID копируется.
    const { text, entities, markup } = buildHelpScreen({
      helpIntroText: cfg?.helpIntroText,
      supportLink: cfg?.supportLink,
      publicAppUrl: cfg?.publicAppUrl,
      ticketsEnabled: cfg?.ticketsEnabled,
      botBackLabel: cfg?.botBackLabel,
      botEmojis: cfg?.botEmojis,
      tgId,
      tgUsername,
      subsCount,
      lang: getUserLang(userId),
    });
    await ctx.reply(text, {
      entities: entities.length ? entities : undefined,
      reply_markup: markup,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    await ctx.reply(`❌ ${msg}`);
  }
});

  composer.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from?.id;
    if (!userId) return;
    if (resolveCallbackDomain(data) !== "support") return next();
    const token = await getOrRestoreToken(userId, ctx.from?.username);
    if (!token) {
      await ctx.reply(_t("auth_failed", getUserLang(userId)));
      return;
    }
    try {
      const config = await api.getPublicConfig();
      if (config?.translations) setTranslations(config.translations);
      if (await blockUnsubscribedCallback(ctx, userId, config)) return;
      const { appUrl, innerStyles, botEmojis, innerEmojiIds } = callbackUi(config);

    if (data === "menu:support") {
      const lang = getUserLang(userId);
      const tgId = String(userId);
      const tgUsername = ctx.from?.username ?? "";
      // Подсчёт подписок клиента: всё что есть в getAllSubscriptions
      let subsCount = 0;
      try {
        const subs = await api.getAllSubscriptions(token);
        subsCount = subs.items?.length ?? 0;
      } catch {
        /* ignore */
      }
      // единый билд экрана Помощи (см. buildHelpScreen).
      const { text, entities, markup } = buildHelpScreen({
        helpIntroText: config?.helpIntroText,
        supportLink: config?.supportLink,
        publicAppUrl: config?.publicAppUrl,
        ticketsEnabled: config?.ticketsEnabled,
        botBackLabel: config?.botBackLabel,
        botEmojis: config?.botEmojis,
        tgId,
        tgUsername,
        subsCount,
        backStyle: innerStyles?.back,
        emojiIds: innerEmojiIds,
        lang,
      });
      await editMessageContent(ctx, text, markup, entities);
      return;
    }

      return next();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      await ctx.reply(`❌ ${msg}`).catch(() => {});
    }
  });

  return composer;
}
