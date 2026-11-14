import { Composer } from "grammy";
import type { Context } from "grammy";
import * as api from "../api.js";
import { activeDiscountCode, awaitingPromoCode, awaitingWithdrawAmount, awaitingWithdrawDetails, clearUserState, pendingWithdrawals, type WithdrawMethod } from "../state-store.js";
import { _t, applyMarkdownAndEmoji, backButton, backToMenu, blockUnsubscribedCallback, callbackUi, currencyButtons, editMessageContent, enforceSubscription, formatMoney, getOrRestoreToken, getUserLang, groupedProfileMenu, langButtons, navRowWithProfileBack, profileButtons, referralRewardLines, sectionBackToMenu, setTranslations, setUserLang, t, tariffErrMarkup, textInputUserId, titleWithEmoji } from "./shared.js";
import { resolveCallbackDomain } from "./routing.js";

const WITHDRAW_METHODS: WithdrawMethod[] = ["sbp", "card", "usdt"];

function availableWithdrawMethods(config: { withdrawalMethods?: string[] } | null): WithdrawMethod[] {
  if (!Array.isArray(config?.withdrawalMethods)) return WITHDRAW_METHODS;
  return WITHDRAW_METHODS.filter((method) => config?.withdrawalMethods?.includes(method));
}

function withdrawMethodLabel(method: WithdrawMethod): string {
  if (method === "sbp") return "СБП (Система быстрых платежей)";
  if (method === "card") return "Банковская карта";
  return "USDT TRC20";
}

function withdrawDetailsPrompt(method: WithdrawMethod): string {
  if (method === "sbp") return "🏦 Введите номер телефона и банк получателя.\nПример: +79991234567, Сбербанк";
  if (method === "card") return "💳 Введите номер банковской карты (16-19 цифр):";
  return "🌐 Введите адрес кошелька USDT TRC20 (начинается с T):";
}

function withdrawDetailsError(method: WithdrawMethod): string {
  if (method === "sbp") return "❌ Укажите номер телефона и банк через запятую.\nПример: +79991234567, Сбербанк\nПопробуйте снова:";
  if (method === "card") return "❌ Некорректный номер карты.\nНомер должен содержать 16-19 цифр.\nПопробуйте снова:";
  return "❌ Некорректный кошелёк TRC20.\n\nАдрес должен начинаться с буквы T и содержать 34 символа.\nПопробуйте снова:";
}

function normalizeWithdrawDetails(method: WithdrawMethod, raw: string): string | null {
  const value = raw.trim();
  if (method === "usdt") {
    return /^T[A-Za-z0-9]{33}$/.test(value) ? value : null;
  }
  if (method === "card") {
    const digits = value.replace(/[\s-]/g, "");
    if (!/^\d{16,19}$/.test(digits)) return null;
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let digit = Number(digits[i]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      double = !double;
    }
    if (sum % 10 !== 0) return null;
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  }
  const parts = value.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const bank = parts.slice(1).join(", ");
  if (bank.length < 2) return null;
  const phoneDigits = parts[0]?.replace(/\D/g, "") ?? "";
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return null;
  let phone: string;
  if (phoneDigits.length === 11 && (phoneDigits.startsWith("7") || phoneDigits.startsWith("8"))) {
    phone = `+7${phoneDigits.slice(1)}`;
  } else if (phoneDigits.length === 10) {
    phone = `+7${phoneDigits}`;
  } else {
    phone = parts[0]?.trim().startsWith("+") ? `+${phoneDigits}` : phoneDigits;
  }
  return `${phone}, ${bank}`.slice(0, 255);
}

export function createProfileHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

composer.command("referral", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const token = await getOrRestoreToken(userId, ctx.from?.username);
  if (!token) {
    await ctx.reply("🔐 Сначала запустите бота через /start");
    return;
  }
  try {
    const client = await api.getMe(token);
    if (!client.referralCode) {
      await ctx.reply("Реферальная ссылка пока недоступна. Попробуйте позже.");
      return;
    }
    const cfg = await api.getPublicConfig().catch(() => null);
    const stats = await api.getReferralStats(token).catch(() => null);
    const baseUrl = cfg?.publicAppUrl?.replace(/\/$/, "") ?? "";
    const linkSite = baseUrl ? `${baseUrl}/cabinet/register?ref=${encodeURIComponent(client.referralCode)}` : null;
    const linkBot = `https://t.me/${ctx.me?.username ?? "bot"}?start=ref_${client.referralCode}`;
    const p1 = stats?.referralPercent ?? client.referralPercent ?? (cfg?.defaultReferralPercent ?? 0);
    const p2 = stats?.referralPercentLevel2 ?? (cfg?.referralPercentLevel2 ?? 0);
    const fmt = (n: number) => `${Math.round(n)}₽`;
    const lines: string[] = [
      "👥 Реферальная программа",
      "",
      "Поделитесь ссылкой с друзьями и получайте процент со всех их пополнений! 🤝",
      "",
      `👥 Рефералы 1 уровня: ${p1}%`,
      `Вы получаете ${p1}% от пополнений тех, кто перешёл по вашей ссылке.`,
      `• Переходов по вашей ссылке: ${stats?.l1Clicks ?? 0}`,
      `• Приобрели подписку: ${stats?.l1Purchased ?? 0}`,
      `• Доход с рефералов 1 уровня: ${fmt(stats?.l1Earned ?? 0)}`,
      "",
      `🤝 Рефералы 2 уровня: ${p2}%`,
      `Вы получаете ${p2}% от пополнений рефералов ваших рефералов.`,
      `• Приглашено вашими рефералами: ${stats?.l2InvitesCount ?? 0}`,
      `• Доход с рефералов 2 уровня: ${fmt(stats?.l2Earned ?? 0)}`,
      "",
      `💰 Ваш заработок (всего): ${fmt(stats?.totalEarned ?? 0)}`,
      `💸 Выведено: ${fmt(stats?.totalWithdrawn ?? 0)}`,
      `🛒 Потрачено: ${fmt(stats?.totalSpent ?? 0)}`,
      `💵 Доступно: ${fmt(stats?.availableBalance ?? client.balance ?? 0)}`,
      "",
      "🔗 Ваша реферальная ссылка:",
      "",
      "Telegram Бот:",
      linkBot,
    ];
    const rewardLines = referralRewardLines(stats);
    if (rewardLines) lines.splice(2, lines.indexOf("🔗 Ваша реферальная ссылка:") - 2, ...rewardLines);
    if (linkSite) {
      lines.push("", "Сайт:", linkSite);
    }
    lines.push("", stats?.referralRewardMode === "days" ? "💡 Дни продлевают основную подписку автоматически." : "💡 С реферального баланса можно оплатить подписку или вывести эти средства на свой кошелёк.");
    // формат как в gift — `url=` + `text=`.
    // Ссылку В САМ ТЕКСТ НЕ кладём — она уже идёт через параметр `url=` и
    // выводится TG-клиентом ПЕРВОЙ строкой автоматически. Если продублировать
    // в shareText — получим две одинаковых ссылки подряд (баг юзера 14.05).
    const shareText = `\n🛡 Надёжный VPN, который реально работает!\n\nРаботает там, где другие не справляются.\n\n💡 Нажми на ссылку выше, чтобы подключиться.`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(linkBot)}&text=${encodeURIComponent(shareText)}`;
    const rows: ({ text: string; url: string } | { text: string; callback_data: string })[][] = [];
    rows.push([{ text: "📢 Поделиться ссылкой", url: shareUrl }]);
    rows.push([{ text: "💳 Оплатить/продлить доступ", callback_data: "menu:tariffs" }]);
    // кнопка вывода скрывается тогглом из админки;
    // мин. сумма — из настройки withdrawal_min_amount (была захардкожена 3000₽).
    if (cfg?.withdrawalsEnabled !== false) {
      rows.push([{ text: `💰 Заявка на вывод (от ${cfg?.withdrawalMinAmount ?? 3000}₽)`, callback_data: "withdraw:start" }]);
    }
    rows.push(navRowWithProfileBack([{ text: "🏠 Главное меню", callback_data: "menu:main" }], "referral", cfg));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.reply(lines.join("\n"), { reply_markup: { inline_keyboard: rows as any } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    await ctx.reply(`❌ ${msg}`);
  }
});

  composer.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from?.id;
    if (!userId) return;
    if (resolveCallbackDomain(data) !== "profile") return next();
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

    if (data === "menu:profile") {
      const client = await api.getMe(token);
      if (client?.preferredLang) setUserLang(userId, client.preferredLang);
      const lang = getUserLang(userId);
      const langs = config?.activeLanguages?.length ? config.activeLanguages : ["ru", "en"];
      const currencies = config?.activeCurrencies?.length ? config.activeCurrencies : ["usd", "rub"];
      const autoRenewStr = client?.autoRenewEnabled ? _t("profile.autorenew_on", lang) : _t("profile.autorenew_off", lang);
      const { text, entities } = titleWithEmoji(
        "PROFILE",
        `${_t("profile.title", lang)}\n\n${_t("profile.balance", lang)}${formatMoney(client?.balance ?? 0, client?.preferredCurrency ?? "usd")}\n${_t("profile.lang", lang)}${client?.preferredLang ?? "ru"}\n${_t("profile.currency", lang)}${client?.preferredCurrency ?? "usd"}\n${_t("profile.autorenew", lang)}${autoRenewStr}\n\n${_t("profile.change", lang)}`,
        config?.botEmojis
      );
      await editMessageContent(ctx, text, profileButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, client?.autoRenewEnabled, lang, await groupedProfileMenu(config, token, client?.trialUsed ?? false)), entities);
      return;
    }

    if (data === "profile:lang") {
      const lang = getUserLang(userId);
      const langs = config?.activeLanguages?.length ? config.activeLanguages : ["ru", "en"];
      await editMessageContent(ctx, _t("profile.choose_lang", lang), langButtons(langs, innerStyles, innerEmojiIds, lang));
      return;
    }

    if (data.startsWith("set_lang:")) {
      const lang = data.slice("set_lang:".length);
      await api.updateProfile(token, { preferredLang: lang });
      setUserLang(userId, lang);
      await editMessageContent(ctx, _t("profile.lang_changed", lang, { lang: lang.toUpperCase() }), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      return;
    }

    if (data === "profile:currency") {
      const lang = getUserLang(userId);
      const currencies = config?.activeCurrencies?.length ? config.activeCurrencies : ["usd", "rub"];
      await editMessageContent(ctx, _t("profile.choose_currency", lang), currencyButtons(currencies, innerStyles, innerEmojiIds, lang));
      return;
    }

    if (data.startsWith("set_currency:")) {
      const lang = getUserLang(userId);
      const currency = data.slice("set_currency:".length);
      await api.updateProfile(token, { preferredCurrency: currency });
      await editMessageContent(ctx, _t("profile.currency_changed", lang, { currency: currency.toUpperCase() }), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      return;
    }

    if (data.startsWith("profile:autorenew:")) {
      const enabled = data === "profile:autorenew:on";
      try {
        await api.toggleAutoRenew(token, enabled);
        const client = await api.getMe(token);
        if (client?.preferredLang) setUserLang(userId, client.preferredLang);
        const lang = getUserLang(userId);
        const autoRenewStr = client?.autoRenewEnabled ? _t("profile.autorenew_on", lang) : _t("profile.autorenew_off", lang);
        const { text, entities } = titleWithEmoji(
          "PROFILE",
          `${_t("profile.title", lang)}\n\n${_t("profile.balance", lang)}${formatMoney(client?.balance ?? 0, client?.preferredCurrency ?? "usd")}\n${_t("profile.lang", lang)}${client?.preferredLang ?? "ru"}\n${_t("profile.currency", lang)}${client?.preferredCurrency ?? "usd"}\n${_t("profile.autorenew", lang)}${autoRenewStr}\n\n${_t("profile.change", lang)}`,
          config?.botEmojis
        );
        await editMessageContent(ctx, text, profileButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, client?.autoRenewEnabled, lang, await groupedProfileMenu(config, token, client?.trialUsed ?? false)), entities);
      } catch (err: any) {
        await ctx.answerCallbackQuery({ text: err.message || "Ошибка", show_alert: true });
      }
      return;
    }

    if (data === "menu:balance") {
      try {
        const me = await api.getMe(token);
        const stats = await api.getReferralStats(token).catch(() => null);
        const currency = (me?.preferredCurrency ?? "RUB").toUpperCase();
        const sym = currency === "RUB" ? "₽" : currency === "USD" ? "$" : currency;
        const balance = (me?.balance ?? 0).toFixed(2);
        const totalEarned = stats ? stats.totalEarned.toFixed(2) : "0.00";
        const totalSpent = stats ? stats.totalSpent.toFixed(2) : "0.00";
        // подсказка внизу редактируется в админке («Тексты бота» →
        // bot_balance_text); раньше была захардкожена здесь.
        const balanceHint = (config?.botBalanceText ?? "").trim() || [
          "💡 С баланса можно оплатить любую подписку или докупить устройство.",
          "",
          "Пополнить баланс можно с помощью кнопки «💳 Пополнить баланс» или через 👥 Реферальную программу.",
        ].join("\n");
        const lines: string[] = [
          "💼 Мой баланс",
          "",
          `💵 Доступно: **${balance} ${sym}**`,
          "",
          "📊 Статистика:",
          `• 🛒 Потрачено с баланса: ${totalSpent} ${sym}`,
          `• 👥 Начислено от рефералов: ${totalEarned} ${sym}`,
          "",
          balanceHint,
        ];
        const { text, entities } = applyMarkdownAndEmoji(lines.join("\n"), config?.botEmojis ?? null);
        await editMessageContent(ctx, text, {
          inline_keyboard: [
            [{ text: "💳 Пополнить баланс", callback_data: "menu:topup" }],
            [{ text: "👥 Реферальная программа", callback_data: "menu:referral" }],
            // «← Назад» к списку тарифов (привязка к bot_emojis.BACK).
            [{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:tariffs" }],
            [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
          ],
        }, entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "menu:referral") {
      clearUserState(userId);
      const lang = getUserLang(userId);
      const client = await api.getMe(token);
      if (client?.preferredLang) setUserLang(userId, client.preferredLang);
      if (!client.referralCode) {
        await editMessageContent(ctx, _t("referral.link_unavailable", lang), sectionBackToMenu("referral", config, innerStyles, innerEmojiIds, lang));
        return;
      }
      // новый текст по эталону клиента + статистика из /referral-stats.
      const stats = await api.getReferralStats(token).catch(() => null);
      const linkSite = appUrl ? `${appUrl}/cabinet/register?ref=${encodeURIComponent(client.referralCode)}` : null;
      const linkBot = `https://t.me/${ctx.me?.username ?? "bot"}?start=ref_${client.referralCode}`;
      const p1 = stats?.referralPercent ?? client.referralPercent ?? (config?.defaultReferralPercent ?? 0);
      const p2 = stats?.referralPercentLevel2 ?? (config?.referralPercentLevel2 ?? 0);
      const fmt = (n: number) => `${Math.round(n)}₽`;
      // вступление и футер редактируются в админке («Тексты бота» →
      // bot_referral_intro_text / bot_referral_footer_text); раньше были захардкожены.
      const referralIntro = (config?.botReferralIntroText ?? "").trim()
        || "Поделитесь ссылкой с друзьями и получайте процент со всех их пополнений! 🤝";
      const lines: string[] = [
        "👥 Реферальная программа",
        "",
        referralIntro,
        "",
        `👥 Рефералы 1 уровня: ${p1}%`,
        `Вы получаете ${p1}% от пополнений тех, кто перешёл по вашей ссылке.`,
        `• Переходов по вашей ссылке: ${stats?.l1Clicks ?? 0}`,
        `• Приобрели подписку: ${stats?.l1Purchased ?? 0}`,
        `• Доход с рефералов 1 уровня: ${fmt(stats?.l1Earned ?? 0)}`,
        "",
        `🤝 Рефералы 2 уровня: ${p2}%`,
        `Вы получаете ${p2}% от пополнений рефералов ваших рефералов.`,
        `• Приглашено вашими рефералами: ${stats?.l2InvitesCount ?? 0}`,
        `• Доход с рефералов 2 уровня: ${fmt(stats?.l2Earned ?? 0)}`,
        "",
        `💰 Ваш заработок (всего): ${fmt(stats?.totalEarned ?? 0)}`,
        `💸 Выведено: ${fmt(stats?.totalWithdrawn ?? 0)}`,
        `🛒 Потрачено: ${fmt(stats?.totalSpent ?? 0)}`,
        `💵 Доступно: ${fmt(stats?.availableBalance ?? client.balance ?? 0)}`,
        "",
        "🔗 Ваша реферальная ссылка:",
        "",
        "Telegram Бот:",
        linkBot,
      ];
      const rewardLines = referralRewardLines(stats);
      if (rewardLines) lines.splice(2, lines.indexOf("🔗 Ваша реферальная ссылка:") - 2, ...rewardLines);
      if (linkSite) {
        lines.push("");
        lines.push("Сайт:");
        lines.push(linkSite);
      }
      lines.push("");
      lines.push(
        stats?.referralRewardMode === "days" ? "💡 Дни продлевают основную подписку автоматически." : (config?.botReferralFooterText ?? "").trim()
          || "💡 С реферального баланса можно оплатить подписку или вывести эти средства на свой кошелёк.",
      );

      // T-fix (11.05.2026): кнопки по эталону клиента.
      // 1. «📢 Поделиться ссылкой» — t.me/share URL для пересылки
      // 2. «💳 Оплатить/продлить доступ» — callback menu:tariffs (можно купить с реф. баланса)
      // 3. «💰 Заявка на вывод (от 3000₽)» — conversation flow withdraw:start
      // формат как в gift — `url=` + `text=`.
      // Ссылку В САМ ТЕКСТ НЕ кладём — она уже идёт через параметр `url=` и
      // выводится TG-клиентом ПЕРВОЙ строкой автоматически. Если продублировать
      // в shareText — получим две одинаковых ссылки подряд (баг юзера 14.05).
      // текст шаринга редактируется в админке («Тексты бота» → bot_referral_share_text).
      // Ведущий \n обязателен: ссылка из `url=` рисуется TG-клиентом первой строкой.
      const shareBody = (config?.botReferralShareText ?? "").trim()
        || "🛡 Надёжный VPN, который реально работает!\n\nРаботает там, где другие не справляются.\n\n💡 Нажми на ссылку выше, чтобы подключиться.";
      const shareText = `\n${shareBody}`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(linkBot)}&text=${encodeURIComponent(shareText)}`;
      const rows: ({ text: string; url: string } | { text: string; callback_data: string })[][] = [];
      rows.push([{ text: "📢 Поделиться ссылкой", url: shareUrl }]);
      rows.push([{ text: "💳 Оплатить/продлить доступ", callback_data: "menu:tariffs" }]);
      // кнопка вывода скрывается тогглом; мин. сумма из настройки.
      if (config?.withdrawalsEnabled !== false) {
        rows.push([{ text: `💰 Заявка на вывод (от ${config?.withdrawalMinAmount ?? 3000}₽)`, callback_data: "withdraw:start" }]);
      }
      rows.push(navRowWithProfileBack([{ text: "🏠 Главное меню", callback_data: "menu:main" }], "referral", config, innerStyles, innerEmojiIds, lang));

      const { text: refText, entities: refEntities } = titleWithEmoji("LINK", lines.join("\n"), config?.botEmojis);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await editMessageContent(ctx, refText, { inline_keyboard: rows as any }, refEntities);
      return;
    }

    if (data === "withdraw:start") {
      try {
        if (config?.withdrawalsEnabled === false) {
          await editMessageContent(ctx, "💰 Заявки на вывод временно отключены.", {
            inline_keyboard: [[{ text: "👥 К рефералке", callback_data: "menu:referral" }]],
          });
          return;
        }
        const methods = availableWithdrawMethods(config);
        if (methods.length === 0) {
          await editMessageContent(ctx, "💰 Заявки на вывод временно недоступны.", {
            inline_keyboard: [[{ text: "👥 К рефералке", callback_data: "menu:referral" }]],
          });
          return;
        }
        const withdrawMin = config?.withdrawalMinAmount ?? 3000;
        const me = await api.getMe(token);
        const balance = me?.balance ?? 0;
        if (balance < withdrawMin) {
          await editMessageContent(
            ctx,
            `💰 Заявка на вывод\n\n⚠️ Минимальная сумма вывода — ${withdrawMin}₽\n\nВаш текущий баланс: ${balance.toFixed(2)}₽\n\nПродолжайте приглашать друзей по реферальной ссылке — и накопите нужную сумму!`,
            {
              inline_keyboard: [
                [{ text: "👥 К рефералке", callback_data: "menu:referral" }],
                [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
              ],
            },
          );
          return;
        }
        awaitingWithdrawAmount.add(userId);
        awaitingWithdrawDetails.delete(userId);
        pendingWithdrawals.delete(userId);
        await editMessageContent(
          ctx,
          `💰 Заявка на вывод\n\nВведите сумму для вывода (минимум ${withdrawMin}₽).\nДоступно: ${balance.toFixed(2)}₽`,
          {
            inline_keyboard: [
              [{ text: "❌ Отмена", callback_data: "menu:referral" }],
            ],
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("withdraw:method:")) {
      const method = data.slice("withdraw:method:".length) as WithdrawMethod;
      const draft = pendingWithdrawals.get(userId);
      const methods = availableWithdrawMethods(config);
      if (!draft || !WITHDRAW_METHODS.includes(method) || !methods.includes(method)) {
        awaitingWithdrawAmount.delete(userId);
        awaitingWithdrawDetails.delete(userId);
        pendingWithdrawals.delete(userId);
        await editMessageContent(ctx, "❌ Заявка устарела или способ вывода недоступен. Начните заново.", {
          inline_keyboard: [
            [{ text: "💰 Новая заявка", callback_data: "withdraw:start" }],
            [{ text: "👥 К рефералке", callback_data: "menu:referral" }],
          ],
        });
        return;
      }
      pendingWithdrawals.set(userId, { amount: draft.amount, method });
      awaitingWithdrawDetails.add(userId);
      await editMessageContent(
        ctx,
        `💸 Сумма: ${draft.amount.toFixed(2)}₽\nСпособ: ${withdrawMethodLabel(method)}\n\n${withdrawDetailsPrompt(method)}`,
        {
          inline_keyboard: [
            [{ text: "❌ Отмена", callback_data: "menu:referral" }],
          ],
        },
      );
      return;
    }

    if (data === "withdraw:confirm") {
      const draft = pendingWithdrawals.get(userId);
      const withdrawConfirmMin = config?.withdrawalMinAmount ?? 3000;
      if (!draft?.method || !draft.details || !Number.isFinite(draft.amount) || draft.amount < withdrawConfirmMin) {
        awaitingWithdrawAmount.delete(userId);
        awaitingWithdrawDetails.delete(userId);
        pendingWithdrawals.delete(userId);
        await editMessageContent(ctx, "❌ Данные заявки устарели. Начните заново.", {
          inline_keyboard: [
            [{ text: "💰 Новая заявка", callback_data: "withdraw:start" }],
            [{ text: "👥 К рефералке", callback_data: "menu:referral" }],
          ],
        });
        return;
      }
      try {
        const result = await api.createWithdrawal(token, { amount: draft.amount, method: draft.method, details: draft.details });
        pendingWithdrawals.delete(userId);
        awaitingWithdrawAmount.delete(userId);
        awaitingWithdrawDetails.delete(userId);
        await editMessageContent(
          ctx,
          `✅ ${result.message}\n\n💸 Сумма: ${draft.amount.toFixed(2)}₽\nСпособ: ${withdrawMethodLabel(draft.method)}\nРеквизиты: ${draft.details}\n\nКак только администратор обработает заявку — мы пришлём уведомление в этот чат.`,
          {
            inline_keyboard: [
              [{ text: "👥 К рефералке", callback_data: "menu:referral" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, {
          inline_keyboard: [[{ text: "👥 К рефералке", callback_data: "menu:referral" }]],
        });
      }
      return;
    }

    if (data.startsWith("withdraw:confirm:")) {
      const parts = data.slice("withdraw:confirm:".length).split(":");
      const amount = parseFloat(parts[0] ?? "0");
      const wallet = parts.slice(1).join(":");
      const withdrawConfirmMin = config?.withdrawalMinAmount ?? 3000;
      if (!Number.isFinite(amount) || amount < withdrawConfirmMin || !/^T[A-Za-z0-9]{33}$/.test(wallet)) {
        await editMessageContent(ctx, "❌ Некорректные данные заявки. Попробуйте снова.", {
          inline_keyboard: [[{ text: "👥 К рефералке", callback_data: "menu:referral" }]],
        });
        return;
      }
      try {
        const result = await api.createWithdrawal(token, { amount, method: "usdt", details: wallet });
        awaitingWithdrawAmount.delete(userId);
        awaitingWithdrawDetails.delete(userId);
        pendingWithdrawals.delete(userId);
        await editMessageContent(
          ctx,
          `✅ ${result.message}\n\n💸 Сумма: ${amount.toFixed(2)}₽\nСпособ: ${withdrawMethodLabel("usdt")}\nРеквизиты: ${wallet}\n\nКак только администратор обработает заявку — мы пришлём уведомление в этот чат.`,
          {
            inline_keyboard: [
              [{ text: "👥 К рефералке", callback_data: "menu:referral" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, {
          inline_keyboard: [[{ text: "👥 К рефералке", callback_data: "menu:referral" }]],
        });
      }
      return;
    }

    if (data === "menu:promocode") {
      const lang = getUserLang(userId);
      awaitingPromoCode.add(userId);
      // текст редактируется в админке («Тексты бота» → bot_promocode_text); fallback — i18n.
      await editMessageContent(
        ctx,
        (config?.botPromocodeText ?? "").trim() || _t("promo.enter_title", lang),
        sectionBackToMenu("promocode", config, innerStyles, innerEmojiIds, lang),
      );
      return;
    }

      return next();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      await ctx.reply(`❌ ${msg}`).catch(() => {});
    }
  });

  composer.on("message:text", async (ctx, next) => {
    const userId = textInputUserId(ctx);
    if (!userId) return next();
    if (!awaitingWithdrawAmount.has(userId) && !awaitingWithdrawDetails.has(userId) && !awaitingPromoCode.has(userId)) return next();

    const token = await getOrRestoreToken(userId, ctx.from?.username);
    if (!token) return;
    const publicConfig = await api.getPublicConfig().catch(() => null);
    if (await enforceSubscription(ctx, publicConfig)) return;

  if (awaitingWithdrawAmount.has(userId)) {
    const raw = ctx.message.text.trim().replace(/[,\s]/g, ".").replace(/[^\d.]/g, "");
    const amount = parseFloat(raw);
    const backRef = { reply_markup: { inline_keyboard: [[{ text: "↩️ Отмена", callback_data: "menu:referral" }]] } };
    const wdCfg = await api.getPublicConfig().catch(() => null);
    const withdrawMin = wdCfg?.withdrawalMinAmount ?? 3000;
    if (availableWithdrawMethods(wdCfg).length === 0) {
      awaitingWithdrawAmount.delete(userId);
      await ctx.reply("💰 Заявки на вывод временно недоступны.", backRef);
      return;
    }
    if (!Number.isFinite(amount) || amount < withdrawMin) {
      await ctx.reply(`❌ Минимальная сумма вывода — ${withdrawMin}₽. Введите корректную сумму или нажмите «Отмена».`, backRef);
      return;
    }
    try {
      const me = await api.getMe(token);
      if ((me?.balance ?? 0) < amount) {
        await ctx.reply(`❌ Недостаточно средств. Доступно: ${(me?.balance ?? 0).toFixed(2)}₽`, backRef);
        awaitingWithdrawAmount.delete(userId);
        return;
      }
    } catch {
      // ignore — backend всё равно проверит при создании
    }
    const methods = availableWithdrawMethods(wdCfg);
    awaitingWithdrawAmount.delete(userId);
    awaitingWithdrawDetails.delete(userId);
    pendingWithdrawals.set(userId, { amount });
    if (methods.length === 1) {
      const method = methods[0] ?? "usdt";
      pendingWithdrawals.set(userId, { amount, method });
      awaitingWithdrawDetails.add(userId);
      await ctx.reply(
        `✅ Сумма: ${amount.toFixed(2)}₽\nСпособ: ${withdrawMethodLabel(method)}\n\n${withdrawDetailsPrompt(method)}`,
        backRef,
      );
      return;
    }
    const methodButtons = methods.map((method) => ({
      text: method === "sbp" ? "🏦 СБП (по номеру телефона)" : method === "card" ? "💳 Банковская карта (РФ)" : "🌐 USDT TRC-20",
      callback_data: `withdraw:method:${method}`,
    }));
    await ctx.reply(
      `✅ Сумма: ${amount.toFixed(2)}₽\n\nВыберите способ вывода:`,
      {
        reply_markup: {
          inline_keyboard: [
            ...methodButtons.map((button) => [button]),
            [{ text: "↩️ Отмена", callback_data: "menu:referral" }],
          ],
        },
      },
    );
    return;
  }

  if (awaitingWithdrawDetails.has(userId)) {
    const draft = pendingWithdrawals.get(userId);
    const backRef = { reply_markup: { inline_keyboard: [[{ text: "↩️ Отмена", callback_data: "menu:referral" }]] } };
    if (!draft?.method) {
      awaitingWithdrawDetails.delete(userId);
      pendingWithdrawals.delete(userId);
      await ctx.reply("❌ Заявка устарела. Начните заново.", backRef);
      return;
    }
    const details = normalizeWithdrawDetails(draft.method, ctx.message.text);
    if (!details) {
      await ctx.reply(withdrawDetailsError(draft.method), backRef);
      return;
    }
    awaitingWithdrawDetails.delete(userId);
    pendingWithdrawals.set(userId, { ...draft, details });
    await ctx.reply(
      `📋 Проверьте данные заявки на вывод:\n\n💸 Сумма: ${draft.amount.toFixed(2)} ₽\nСпособ: ${withdrawMethodLabel(draft.method)}\nРеквизиты: ${details}\n\nСоздать заявку?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Подтвердить", callback_data: "withdraw:confirm" }],
            [{ text: "❌ Отмена", callback_data: "menu:referral" }],
          ],
        },
      },
    );
    return;
  }

  // Если пользователь ожидает ввод промокода
  if (awaitingPromoCode.has(userId)) {
    awaitingPromoCode.delete(userId);
    const lang = getUserLang(userId);
    const code = ctx.message.text.trim();
    const menuKb = { reply_markup: { inline_keyboard: [[{ text: publicConfig?.botBackLabel ?? _t("back_to_menu", lang), callback_data: "menu:main" }]] } };
    if (!code) {
      await ctx.reply(_t("promo.empty_code", lang), menuKb);
      return;
    }
    try {
      const checkResult = await api.checkPromoCode(token, code);
      if (checkResult.type === "FREE_DAYS") {
        const activateResult = await api.activatePromoCode(token, code);
        await ctx.reply(`✅ ${activateResult.message}`, menuKb);
      } else if (checkResult.type === "DISCOUNT") {
        const desc = checkResult.discountPercent
          ? `скидка ${checkResult.discountPercent}%`
          : checkResult.discountFixed
            ? `скидка ${checkResult.discountFixed}`
            : "скидка";
        activeDiscountCode.set(userId, { code, discountPercent: checkResult.discountPercent, discountFixed: checkResult.discountFixed });
        await ctx.reply(`✅ Промокод «${checkResult.name}» принят! ${desc}.\n\n${_t("promo.discount_applied", lang)}`, menuKb);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : _t("error_generic", lang);
      await ctx.reply(`❌ ${msg}`, menuKb);
    }
    return;
  }

    return next();
  });

  return composer;
}
