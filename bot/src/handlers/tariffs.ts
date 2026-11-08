import { Composer } from "grammy";
import { InputFile } from "grammy";
import type { Context } from "grammy";
import * as api from "../api.js";
import { addsubPending, convDropExtras, extendingSecondaryPending, extraOptionPending, extraOptionTargetSub, pendingDropExtras, selectedTariffOption, tariffOptionsCache, trialConvertPickCache, trialReplaceChoice } from "../state-store.js";
import { DEFAULT_EMOJI_UNICODE, DEFAULT_TARIFFS_TEXT, DEFAULT_TARIFF_LINE_FIELDS, _t, applyExtraDevicesPriceBot, backToMenu, bestPricePerDayOptionId, blockUnsubscribedCallback, callbackUi, checkoutExtraDeviceCap, currencySymbol, editMessageContent, extraOptionsButtons, formatRuDays, formatTariffLine, getMenuEmojiKey, getOrRestoreToken, getUserLang, hasExtraDevices, markHasOptions, proxyTariffPayButtons, proxyTariffsOfCategoryButtons, renderTariffsText, setTranslations, showPaymentMethodsForTariff, singboxTariffPayButtons, singboxTariffsOfCategoryButtons, sortedPriceOptions, t, tariffCategoryButtons, tariffDevicePickerButtons, tariffErrMarkup, tariffOptionPickerButtons, tariffPayButtons, tariffsOfCategoryButtons, titleWithEmoji, titleWithOptionalEmoji } from "./shared.js";
import type { TariffCategory, TariffItem } from "./shared.js";
import { resolveCallbackDomain } from "./routing.js";

export function createTariffHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

  composer.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from?.id;
    if (!userId) return;
    if (resolveCallbackDomain(data) !== "tariffs") return next();
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

    if (data === "menu:tariffs") {
      // defensive cleanup — возврат в список тарифов сбрасывает addsub-флаг.
      addsubPending.delete(userId);
      const tariffsRes = await api.getPublicTariffs();
      if (tariffsRes.remnaAvailable === false) {
        await editMessageContent(
          ctx,
          "⚠️ Панель VPN временно недоступна. Покупка и продление этих тарифов пока недоступны. Попробуйте позже.",
          {
            inline_keyboard: [
              [{ text: "🔄 Проверить снова", callback_data: "menu:tariffs" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          }
        );
        return;
      }
      const { items } = tariffsRes;
      if (!items?.length) {
        await editMessageContent(ctx, _t("tariffs.not_configured", getUserLang(userId)), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const tariffsEmojiKey = getMenuEmojiKey(config, "tariffs");
      const tariffsEmojiEntry = tariffsEmojiKey ? config?.botEmojis?.[tariffsEmojiKey] : undefined;
      const tariffsEmojiUnicode = tariffsEmojiKey && !tariffsEmojiEntry?.tgEmojiId
        ? (tariffsEmojiEntry?.unicode?.trim() || DEFAULT_EMOJI_UNICODE[tariffsEmojiKey])
        : undefined;
      const tariffsEmojiIds = innerEmojiIds && tariffsEmojiEntry?.tgEmojiId
        ? { ...innerEmojiIds, tariff: tariffsEmojiEntry.tgEmojiId }
        : innerEmojiIds;
      // меню выбора категорий (Настройки → Бот, default ON). Если включено
      // и категорий больше одной — сначала показываем экран выбора категории; клик по
      // категории → cat_tariffs:<id> → список её тарифов. Категории с пустым списком тарифов
      // пропускаем. Если категория всего одна — меню не нужно, сразу её тарифы.
      const showCategories = config?.botShowTariffCategories !== false;
      const nonEmptyCats = items.filter((c: TariffCategory) => (c.tariffs ?? []).length > 0);
      if (showCategories && nonEmptyCats.length > 1) {
        const menuEmojiKey = getMenuEmojiKey(config, "tariffs");
        const menuBody = "Выберите категорию тарифов:";
        const { text, entities } = titleWithOptionalEmoji(menuEmojiKey, menuBody, config?.botEmojis);
        await editMessageContent(
          ctx,
          text,
          tariffCategoryButtons(
            nonEmptyCats.map((c: TariffCategory) => ({ id: c.id, name: c.name, emoji: c.emoji })),
            config?.botBackLabel ?? null,
            innerStyles,
            tariffsEmojiIds,
          ),
          entities,
        );
        return;
      }
      // меню выключено ИЛИ одна категория — плоский список.
      // Несколько категорий при выключенном меню сливаем в одну виртуальную.
      if (items.length > 1) {
        const merged = items.flatMap((c: TariffCategory) => c.tariffs ?? []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const virtual: any = { id: "_all_", name: "Тарифы", emoji: "", emojiKey: null, tariffs: merged };
        items.splice(0, items.length, virtual);
      }
      const cat = items[0]!;
      const nameOnly = (cat.name || "").replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "").trim() || cat.name || "";
      const head = (cat.emoji && cat.emoji.trim() ? cat.emoji + " " : "") + nameOnly;
      const tariffFields = { ...DEFAULT_TARIFF_LINE_FIELDS, ...(config?.botTariffsFields ?? {}) };
      const template = (config?.botTariffsText ?? "").trim() || DEFAULT_TARIFFS_TEXT;
      const tariffLines = cat.tariffs.map((t: TariffItem) => formatTariffLine(t, tariffFields)).join("\n");
      const body = renderTariffsText(template, head, tariffLines);
      const { text, entities } = titleWithOptionalEmoji(tariffsEmojiKey, body, config?.botEmojis);
      // тогглы скрытия кнопок «➕ Докупить устройство» / «💼 Мой баланс» (Настройки → Бот).
      await editMessageContent(ctx, text, tariffPayButtons(markHasOptions(items), config?.botBackLabel ?? null, innerStyles, tariffsEmojiIds, tariffsEmojiUnicode, {
        showExtraDevices: config?.botTariffsShowExtraDevicesButton !== false,
        showBalance: config?.botTariffsShowBalanceButton !== false,
      }), entities);
      return;
    }

    if (data.startsWith("cat_tariffs:")) {
      const categoryId = data.slice("cat_tariffs:".length);
      const { items } = await api.getPublicTariffs();
      const category = items?.find((c: TariffCategory) => c.id === categoryId);
      if (!category?.tariffs?.length) {
        await editMessageContent(ctx, "Категория не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const nameOnly = (category.name || "").replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "").trim() || category.name || "";
      const head = (category.emoji && category.emoji.trim() ? category.emoji + " " : "") + nameOnly;
      const tariffsEmojiKey = getMenuEmojiKey(config, "tariffs");
      const tariffsEmojiEntry = tariffsEmojiKey ? config?.botEmojis?.[tariffsEmojiKey] : undefined;
      const tariffsEmojiUnicode = tariffsEmojiKey && !tariffsEmojiEntry?.tgEmojiId
        ? (tariffsEmojiEntry?.unicode?.trim() || DEFAULT_EMOJI_UNICODE[tariffsEmojiKey])
        : undefined;
      const tariffsEmojiIds = innerEmojiIds && tariffsEmojiEntry?.tgEmojiId
        ? { ...innerEmojiIds, tariff: tariffsEmojiEntry.tgEmojiId }
        : innerEmojiIds;
      const tariffFields = { ...DEFAULT_TARIFF_LINE_FIELDS, ...(config?.botTariffsFields ?? {}) };
      const template = (config?.botTariffsText ?? "").trim() || DEFAULT_TARIFFS_TEXT;
      const tariffLines = category.tariffs.map((t: TariffItem) => formatTariffLine(t, tariffFields)).join("\n");
      const body = renderTariffsText(template, head, tariffLines);
      const { text, entities } = titleWithOptionalEmoji(tariffsEmojiKey, body, config?.botEmojis);
      // тогглы скрытия кнопок «➕ Докупить устройство» / «💼 Мой баланс» (Настройки → Бот).
      await editMessageContent(ctx, text, tariffsOfCategoryButtons(markHasOptions([category])[0]!, config?.botBackLabel ?? null, innerStyles, "menu:tariffs", tariffsEmojiIds, tariffsEmojiUnicode, {
        showExtraDevices: config?.botTariffsShowExtraDevicesButton !== false,
        showBalance: config?.botTariffsShowBalanceButton !== false,
      }), entities);
      return;
    }

    if (data === "menu:proxy") {
      const { items } = await api.getPublicProxyTariffs();
      if (!items?.length || items.every((c: { tariffs: unknown[] }) => !c.tariffs?.length)) {
        await editMessageContent(ctx, "Тарифы прокси пока не настроены.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const cats = items.filter((c: { tariffs: unknown[] }) => c.tariffs?.length > 0);
      if (cats.length === 1 && cats[0]!.tariffs.length <= 5) {
        const head = cats[0]!.name;
        const lines = cats[0]!.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${currencySymbol(t.currency)}`).join("\n");
        await editMessageContent(ctx, `🌐 Прокси\n\n${head}\n${lines}\n\nВыберите тариф:`, proxyTariffPayButtons(cats, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
      } else {
        await editMessageContent(ctx, "🌐 Прокси\n\nВыберите категорию:", proxyTariffPayButtons(cats, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("cat_proxy:")) {
      const categoryId = data.slice("cat_proxy:".length);
      const { items } = await api.getPublicProxyTariffs();
      const category = items?.find((c: { id: string }) => c.id === categoryId);
      if (!category?.tariffs?.length) {
        await editMessageContent(ctx, "Категория не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const head = category.name;
      const lines = category.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${currencySymbol(t.currency)}`).join("\n");
      await editMessageContent(ctx, `🌐 ${head}\n\n${lines}\n\nВыберите тариф:`, proxyTariffsOfCategoryButtons(category, config?.botBackLabel ?? null, innerStyles, "menu:proxy", innerEmojiIds));
      return;
    }

    if (data === "menu:singbox") {
      const { items } = await api.getPublicSingboxTariffs();
      if (!items?.length || items.every((c: { tariffs: unknown[] }) => !c.tariffs?.length)) {
        await editMessageContent(ctx, "Тарифы доступов пока не настроены.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const cats = items.filter((c: { tariffs: unknown[] }) => c.tariffs?.length > 0);
      if (cats.length === 1 && cats[0]!.tariffs.length <= 5) {
        const head = cats[0]!.name;
        const lines = cats[0]!.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${currencySymbol(t.currency)}`).join("\n");
        await editMessageContent(ctx, `🔑 Доступы\n\n${head}\n${lines}\n\nВыберите тариф:`, singboxTariffPayButtons(cats, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
      } else {
        await editMessageContent(ctx, "🔑 Доступы\n\nВыберите категорию:", singboxTariffPayButtons(cats, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("cat_singbox:")) {
      const categoryId = data.slice("cat_singbox:".length);
      const { items } = await api.getPublicSingboxTariffs();
      const category = items?.find((c: { id: string }) => c.id === categoryId);
      if (!category?.tariffs?.length) {
        await editMessageContent(ctx, "Категория не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const head = category.name;
      const lines = category.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${currencySymbol(t.currency)}`).join("\n");
      await editMessageContent(ctx, `🔑 ${head}\n\n${lines}\n\nВыберите тариф:`, singboxTariffsOfCategoryButtons(category, config?.botBackLabel ?? null, innerStyles, "menu:singbox", innerEmojiIds));
      return;
    }

    if (data === "menu:my_singbox") {
      const slotsRes = await api.getSingboxSlots(token);
      const slots = slotsRes.slots ?? [];
      if (slots.length === 0) {
        const keyboard = backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
        const renewUrl = config?.publicAppUrl?.replace(/\/$/, "");
        if (renewUrl) keyboard.inline_keyboard.unshift([{ text: "Посмотреть и продлить доступы", web_app: { url: `${renewUrl}/cabinet/singbox?tab=my` } }]);
        await editMessageContent(ctx, "Активных доступов нет. Истёкшие доступы можно продлить в кабинете.", keyboard);
        return;
      }
      const lines = slots.map((s: { subscriptionLink: string; expiresAt: string; protocol: string }) => {
        const exp = new Date(s.expiresAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
        return `${s.protocol} — до ${exp}${["AMNEZIAWG", "AWP_AWG", "AWP_WIREGUARD"].includes(s.protocol) ? "" : `\n${s.subscriptionLink}`}`;
      }).join("\n\n");
      const msg = `📋 Мои доступы (${slots.length})\n\nСкопируйте ссылку в приложение. Для AmneziaWG скачайте .conf кнопкой ниже или в кабинете:\n\n${lines}`;
      const keyboard = backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
      for (const slot of slots.filter(s => ["AMNEZIAWG", "AWP_AWG", "AWP_WIREGUARD"].includes(s.protocol)).slice(0, 20)) keyboard.inline_keyboard.unshift([{ text: `📄 AmneziaWG · ${slot.id.slice(-8)}`, callback_data: `singbox:conf:${slot.id}` }]);
      const renewUrl = config?.publicAppUrl?.replace(/\/$/, "");
      if (renewUrl) keyboard.inline_keyboard.unshift([{ text: "Продлить доступ / все доступы", web_app: { url: `${renewUrl}/cabinet/singbox?tab=my` } }]);
      await editMessageContent(ctx, msg.slice(0, 4096), keyboard);
      return;
    }

    if (data === "menu:my_proxy") {
      const { slots } = await api.getProxySlots(token);
      if (!slots?.length) {
        await editMessageContent(ctx, "📋 Мои прокси\n\nУ вас пока нет активных прокси. Купите тариф в разделе «Прокси».", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      let text = "📋 Мои прокси\n\n";
      for (const s of slots) {
        text += `• SOCKS5: \`socks5://${s.login}:${s.password}@${s.host}:${s.socksPort}\`\n`;
        text += `• HTTP: \`http://${s.login}:${s.password}@${s.host}:${s.httpPort}\`\n`;
        text += `  До: ${new Date(s.expiresAt).toLocaleString("ru-RU")}\n\n`;
      }
      text += "Скопируйте строку в настройки прокси приложения.";
      await editMessageContent(ctx, text.slice(0, 4096), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      return;
    }

    if (data === "menu:extra_options") {
      const options = config?.sellOptions ?? [];
      if (!options.length) {
        await editMessageContent(ctx, "Доп. опции пока не доступны. Оформите подписку в разделе «Тарифы».", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      // новый текст по эталону клиента.
      // Заголовок «📦 Дополнительные опции» рисует titleWithEmoji — НЕ дублируем эмодзи в тексте.
      // текст редактируется в админке («Тексты бота» →
      // bot_extra_options_text); раньше был захардкожен здесь.
      const optsText = (config?.botExtraOptionsText ?? "").trim() || [
        "Дополнительные опции",
        "",
        "Каждая подписка поддерживает до 4 устройств одновременно.",
        "",
        "✨ Если вы хотите подключить больше устройств, купите ещё одну подписку, либо:",
        "➕ Вы можете докупить устройство для любой из имеющихся подписок.",
        "",
        "🗓️ Цена указана за 30 календарных дней",
        "",
        "Чтобы докупить устройство, нажмите кнопку:",
      ].join("\n");
      const { text, entities } = titleWithEmoji("PACKAGE", optsText, config?.botEmojis);
      await editMessageContent(ctx, text, extraOptionsButtons(options, config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null), entities);
      return;
    }

    if (data.startsWith("extra_opt_pick:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      try {
        const subs = await api.getAllSubscriptions(token);
        const subItems = (subs.items ?? []).filter((sub) => {
          const raw = sub.subscription as Record<string, unknown> | null;
          const payload = raw
            ? ((raw.response ?? raw.data ?? raw) as Record<string, unknown>)
            : null;
          const status = typeof payload?.status === "string" ? payload.status.toUpperCase() : null;
          const expireAtRaw = payload?.expireAt ?? payload?.expire_at;
          const expireAt = typeof expireAtRaw === "string" || typeof expireAtRaw === "number"
            ? new Date(typeof expireAtRaw === "number" && expireAtRaw < 1_000_000_000_000 ? expireAtRaw * 1000 : expireAtRaw)
            : null;
          if (status && status !== "ACTIVE") return false;
          return !expireAt || Number.isNaN(expireAt.getTime()) || expireAt.getTime() > Date.now();
        });
        if (subItems.length === 0) {
          await editMessageContent(ctx, "❌ Сначала оформите подписку — потом сможете покупать опции.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        extraOptionPending.set(userId, { kind, productId });

        // рассчитываем актуальную цену
        // для каждой подписки с объяснением (коэф по остатку дней + личная скидка).
        const product = (config?.sellOptions ?? []).find((o) => o.kind === kind && o.id === productId);
        const basePrice = product?.price ?? 0;
        const me = await api.getMe(token).catch(() => null);
        const personalDiscount = me?.personalDiscountPercent ?? 0;
        const computeForSub = (s: { subscription?: unknown }) => {
          const inner = s.subscription as Record<string, unknown> | null;
          const innerData = inner
            ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>)
            : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) {
              daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
            }
          }
          const coef = Math.max(1, daysLeft / 30);
          // округление ВНИЗ до целых рублей — 230.87 → 230.
          // Эта же цена идёт в бэк (Math.floor там же) — юзер платит ровно сколько видит.
          const rawPrice = Math.floor(basePrice * coef);
          const finalPrice = personalDiscount > 0
            ? Math.max(0, Math.floor(rawPrice * (1 - personalDiscount / 100)))
            : rawPrice;
          return { daysLeft: Math.round(daysLeft), coef: Math.round(coef * 10) / 10, rawPrice, finalPrice };
        };

        const productName = product?.name ?? (kind === "devices" ? "Доп. устройство" : kind === "traffic" ? "Доп. трафик" : "Сервер");

        if (subItems.length === 1) {
          const only = subItems[0]!;
          extraOptionTargetSub.set(userId, only.id);
          const calc = computeForSub(only);
          const lines = [
            `📦 Опция: ${productName}`,
            "",
            `📲 Подписка: #${only.subscriptionIndex ?? 0}${only.tariffDisplayName ? ` (${only.tariffDisplayName})` : ""}`,
            "",
            `🗓️ Базовая цена: ${basePrice} ₽ за 30 дней`,
            `⏰ Осталось дней: ${calc.daysLeft}`,
            `📐 Коэффициент: ×${calc.coef} (дней / 30)`,
            `💰 Цена за период: ${calc.rawPrice} ₽`,
          ];
          if (personalDiscount > 0) {
            const discountAmount = Math.round((calc.rawPrice - calc.finalPrice) * 100) / 100;
            lines.push(`💎 Ваша персональная скидка: −${personalDiscount}% (−${discountAmount} ₽)`);
          }
          lines.push("", `━━━━━━━━━━━━━━`, `💵 Итого к оплате: ${calc.finalPrice} ₽`);
          await editMessageContent(ctx, lines.join("\n"), {
            inline_keyboard: [
              [{ text: `▶ Продолжить к оплате (${calc.finalPrice} ₽)`, callback_data: `pay_option:${kind}:${productId}` }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          });
          return;
        }

        // 2+ подписок → выбор с актуальной ценой для каждой.
        const titleLines = [
          `📦 К какой подписке применить опцию: ${productName}?`,
          "",
          `🗓️ Базовая цена: ${basePrice} ₽ за 30 дней.`,
          `📐 Стоимость зависит от оставшегося количества дней подписки.`,
          `Цена увеличивается пропорционально оставшимся дням подписки (×N от 30 дн).`,
          `💡 Опция «${productName}» действует до окончания выбранной подписки.`,
        ];
        if (personalDiscount > 0) {
          titleLines.push(`💎 К итогу применится ваша персональная скидка −${personalDiscount}%.`);
        }
        const rows: { text: string; callback_data: string }[][] = subItems.map((s) => {
          const calc = computeForSub(s);
          const tariffLabel = s.tariffDisplayName ? ` ${s.tariffDisplayName}` : "";
          // убрали слово «Подписка» с кнопок — оставили #N.
          const label = `#${s.subscriptionIndex ?? 0}${tariffLabel} — ${calc.finalPrice} ₽`;
          return [{ text: label.slice(0, 60), callback_data: `extra_opt_setsub:${s.id}`.slice(0, 64) }];
        });
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        await editMessageContent(ctx, titleLines.join("\n"), { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("extra_opt_setsub:")) {
      // subMarker = subscription.id для всех подписок.
      const subMarker = data.slice("extra_opt_setsub:".length);
      const pending = extraOptionPending.get(userId);
      if (!pending) {
        await editMessageContent(ctx, "⏳ Сессия выбора опции истекла. Откройте меню опций заново.", {
          inline_keyboard: [[{ text: "📦 К опциям", callback_data: "menu:extra_options" }]],
        });
        return;
      }
      const { kind, productId } = pending;
      if (subMarker) extraOptionTargetSub.set(userId, subMarker);

      // подтверждение выбора с детальным
      // расчётом цены (коэф по остатку дней + личная скидка).
      try {
        const subs = await api.getAllSubscriptions(token);
        const target = subs.items?.find((it) => it.id === subMarker);
        const product = (config?.sellOptions ?? []).find((o) => o.kind === kind && o.id === productId);
        const basePrice = product?.price ?? 0;
        const me = await api.getMe(token).catch(() => null);
        const pd = me?.personalDiscountPercent ?? 0;
        const inner = target?.subscription as Record<string, unknown> | null;
        const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
        const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
        let daysLeft = 30;
        if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
          const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
          if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
        }
        const coef = Math.max(1, daysLeft / 30);
        // округление вниз до целых рублей.
        const rawPrice = Math.floor(basePrice * coef);
        const finalPrice = pd > 0 ? Math.max(0, Math.floor(rawPrice * (1 - pd / 100))) : rawPrice;
        const productName = product?.name ?? (kind === "devices" ? "Доп. устройство" : kind === "traffic" ? "Доп. трафик" : "Сервер");
        const lines = [
          `📦 Опция: ${productName}`,
          "",
          `📲 Подписка: #${target?.subscriptionIndex ?? 0}${target?.tariffDisplayName ? ` (${target.tariffDisplayName})` : ""}`,
          "",
          `🗓️ Базовая цена: ${basePrice} ₽ за 30 дней`,
          `⏰ Осталось дней: ${Math.round(daysLeft)}`,
          `📐 Коэффициент: ×${Math.round(coef * 10) / 10}`,
          `💰 Цена за период: ${rawPrice} ₽`,
        ];
        if (pd > 0) {
          const discountAmount = Math.round((rawPrice - finalPrice) * 100) / 100;
          lines.push(`💎 Персональная скидка: −${pd}% (−${discountAmount} ₽)`);
        }
        lines.push("", `━━━━━━━━━━━━━━`, `💵 Итого к оплате: ${finalPrice} ₽`);
        await editMessageContent(ctx, lines.join("\n"), {
          inline_keyboard: [
            [{ text: `▶ Продолжить к оплате (${finalPrice} ₽)`, callback_data: `pay_option:${kind}:${productId}` }],
            [{ text: "← Назад", callback_data: `extra_opt_pick:${kind}:${productId}` }],
            [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
          ],
        });
      } catch {
        // Fallback на простое подтверждение если расчёт не удался.
        await editMessageContent(ctx, `📦 Подписка выбрана.`, {
          inline_keyboard: [
            [{ text: "▶ Продолжить к оплате", callback_data: `pay_option:${kind}:${productId}` }],
            [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
          ],
        });
      }
      return;
    }

    if (data.startsWith("topt:")) {
      // Шаг 1: выбрана опция длительности. Дальше — picker доп. устройств (если включены).
      const idxStr = data.slice("topt:".length);
      const idx = parseInt(idxStr, 10);
      const cache = tariffOptionsCache.get(userId);
      if (!cache || !Number.isFinite(idx) || idx < 0 || idx >= cache.options.length) {
        await editMessageContent(ctx, "Сессия выбора опции истекла. Откройте тарифы заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const option = cache.options[idx]!;
      selectedTariffOption.set(userId, { tariffId: cache.tariffId, option, extraDevices: 0 });
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === cache.tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }

      // если идёт ПРОДЛЕНИЕ подписки с
      // докупленными устройствами — показываем промежуточный экран с детализацией цены
      // и выбором: продлить со всеми устройствами / убрать устройства и продлить только тариф.
      const extPair = extendingSecondaryPending.get(userId);
      if (extPair && extPair.tariffId === tariff.id) {
        try {
          const allSubs = await api.getAllSubscriptions(token);
          const targetSub = allSubs.items?.find((it) => it.id === extPair.secondaryId);
          const extraDevices = targetSub?.extraDevices ?? 0;
          const monthlyPrice = targetSub?.extraDevicesMonthlyPrice ?? 0;
          if (extraDevices > 0 && monthlyPrice > 0) {
            const extrasForPeriod = Math.round(monthlyPrice * (option.durationDays / 30) * 100) / 100;
            const totalWith = option.price + extrasForPeriod;
            // применяем личную скидку для отображения
            const meExt = await api.getMe(token);
            const pdExt = meExt?.personalDiscountPercent ?? 0;
            const displayTotalWith = pdExt > 0 ? Math.max(0, Math.round(totalWith * (1 - pdExt / 100) * 100) / 100) : totalWith;
            const displayPrice = pdExt > 0 ? Math.max(0, Math.round(option.price * (1 - pdExt / 100) * 100) / 100) : option.price;
            const coef = option.durationDays / 30;
            const coefStr = option.durationDays % 30 === 0 ? `${coef}` : coef.toFixed(1);
            const lines = [
              "🔄 Продление подписки",
              "",
              `📦 Тариф: ${tariff.name}`,
              `⏰ Длительность: ${formatRuDays(option.durationDays)}`,
              `💰 Базовая цена тарифа: ${displayPrice} ₽`,
              "",
              `📱 На этой подписке у вас докуплено: ${extraDevices} ${(() => { const n = extraDevices % 100; const n1 = n % 10; if (n > 10 && n < 20) return "доп. устройств"; if (n1 > 1 && n1 < 5) return "доп. устройства"; if (n1 === 1) return "доп. устройство"; return "доп. устройств"; })()}`,
              `💵 Цена устройств: ${monthlyPrice} ₽ за 30 дней × ${coefStr} = ${extrasForPeriod} ₽`,
              "",
              `━━━━━━━━━━━━━━`,
              `💵 Итого со всеми устройствами: ${displayTotalWith} ₽`,
              `💵 Без доп. устройств: ${displayPrice} ₽`,
              "",
              `💡 По умолчанию в подписку входит ${tariff.includedDevices ?? 4} устройства, но у вас куплены дополнительные устройства.`,
              "⚠️ Если продлить подписку без доп. устройств и при этом продолжить использовать прежнее количество устройств, сервис может перестать работать на некоторых из них.",
            ];
            await editMessageContent(ctx, lines.join("\n"), {
              inline_keyboard: [
                [{ text: `✅ Со всеми устройствами (${displayTotalWith} ₽)`, callback_data: `pay_ext_keep:${idx}` }],
                [{ text: `🗑 Убрать устройства, продлить за ${displayPrice} ₽`, callback_data: `pay_ext_drop:${idx}` }],
                [{ text: "← Назад", callback_data: `sub:detail:${targetSub?.type ?? "secondary"}:${extPair.secondaryId}` }],
              ],
            });
            return;
          }
        } catch (e) {
          console.warn("[bot] topt extras intermediate screen failed:", e);
          // упало — продолжаем обычным flow без промежуточного экрана
        }
      }

      // Если в тарифе ВКЛЮЧЕНЫ доп. устройства — показываем picker.
      if (hasExtraDevices(tariff)) {
        const tiers = tariff.deviceDiscountTiers;
        const pricePerExtra = tariff.pricePerExtraDevice ?? 0;
        const targetSubId = extPair && extPair.tariffId === tariff.id ? extPair.secondaryId : null;
        const maxExtras = await checkoutExtraDeviceCap(token, tariff, targetSubId, addsubPending.get(userId) === tariff.id);
        if (maxExtras <= 0) {
          await showPaymentMethodsForTariff(ctx, userId, tariff, option, 0, config, innerStyles, innerEmojiIds, token);
          return;
        }
        const includedDevices = tariff.includedDevices ?? 1;
        // Плитка «+0» = базовая цена тарифа, дальше +1, +2, ... до maxExtras.
        const tiles = Array.from({ length: maxExtras + 1 }, (_, i) => {
          const extras = i;
          const { extrasTotal, pct } = applyExtraDevicesPriceBot(pricePerExtra, extras, tiers, option.durationDays);
          return { extras, total: option.price + extrasTotal, pct };
        });
        const bestExtra = tiles.slice(1).reduce((best, cur) => {
          const perDev = cur.total / (includedDevices + cur.extras);
          if (best == null || perDev < best.perDev) return { extras: cur.extras, perDev };
          return best;
        }, null as { extras: number; perDev: number } | null);
        const tilesWithBest = tiles.map((t) => ({
          extras: t.extras,
          included: includedDevices,
          total: t.total,
          pct: t.pct,
          isBest: bestExtra?.extras === t.extras && t.extras > 0 && t.pct === 0,
        }));
        const text = `${tariff.name} · ${formatRuDays(option.durationDays)}\n\n📱 В тариф включено: ${includedDevices} устр.\nДобавьте дополнительные:`;
        await editMessageContent(ctx, text, tariffDevicePickerButtons(tilesWithBest, tariff.currency, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
        return;
      }
      // Доп. устройств нет — сразу способы оплаты с extras=0.
      await showPaymentMethodsForTariff(ctx, userId, tariff, option, 0, config, innerStyles, innerEmojiIds, token);
      return;
    }

    if (data.startsWith("pay_ext_keep:") || data.startsWith("pay_ext_drop:")) {
      const isKeep = data.startsWith("pay_ext_keep:");
      const idxStr = data.slice(isKeep ? "pay_ext_keep:".length : "pay_ext_drop:".length);
      const idx = parseInt(idxStr, 10);
      const cache = tariffOptionsCache.get(userId);
      const extPair = extendingSecondaryPending.get(userId);
      if (!cache || !extPair || !Number.isFinite(idx) || idx < 0 || idx >= cache.options.length) {
        await editMessageContent(ctx, "Сессия истекла. Откройте подписку заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const option = cache.options[idx]!;
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === cache.tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      let subExtrasMonthlyPrice = 0;
      try {
        const allSubs = await api.getAllSubscriptions(token);
        const target = allSubs.items?.find((it) => it.id === extPair.secondaryId);
        if (!isKeep) {
          // НЕ удаляем сразу — только запоминаем
          // намерение. Реальный removeExtraDevices вызовется в handler'е способа оплаты
          // (yookassa/balance/etc) ПЕРЕД созданием платежа. Если юзер передумает и
          // вернётся назад — устройства останутся при нём.
          pendingDropExtras.set(userId, extPair.secondaryId);
          subExtrasMonthlyPrice = 0; // на экране оплаты показываем цену БЕЗ устройств
        } else {
          // KEEP: на всякий случай сбрасываем pending drop (если юзер передумал убирать).
          pendingDropExtras.delete(userId);
          subExtrasMonthlyPrice = target?.extraDevicesMonthlyPrice ?? 0;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ Не удалось получить данные подписки: ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      selectedTariffOption.set(userId, { tariffId: tariff.id, option, extraDevices: 0 });
      await showPaymentMethodsForTariff(ctx, userId, tariff, option, 0, config, innerStyles, innerEmojiIds, token, subExtrasMonthlyPrice);
      return;
    }

    if (data.startsWith("tdev:")) {
      // Шаг 2: выбрано количество ДОП. устройств (extras). Применяем скидку и показываем способы оплаты.
      const nStr = data.slice("tdev:".length);
      const extraDevices = parseInt(nStr, 10);
      const sel = selectedTariffOption.get(userId);
      if (!sel || !Number.isFinite(extraDevices) || extraDevices < 0) {
        await editMessageContent(ctx, "Сессия выбора устройств истекла. Откройте тарифы заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === sel.tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const extPair = extendingSecondaryPending.get(userId);
      const targetSubId = extPair && extPair.tariffId === tariff.id ? extPair.secondaryId : null;
      const cap = await checkoutExtraDeviceCap(token, tariff, targetSubId, addsubPending.get(userId) === tariff.id);
      const cappedExtras = Math.min(Math.max(0, extraDevices), cap);
      selectedTariffOption.set(userId, { ...sel, extraDevices: cappedExtras });
      await showPaymentMethodsForTariff(ctx, userId, tariff, sel.option, cappedExtras, config, innerStyles, innerEmojiIds, token);
      return;
    }

    if (data === "trialrepl:next") {
      const sel = selectedTariffOption.get(userId);
      if (!sel) {
        await editMessageContent(ctx, "Выбор устарел — откройте оплату заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const subsAll = await api.getAllSubscriptions(token);
        const trials = (subsAll.items ?? []).filter((s) => s.trialId);
        if (trials.length === 0) {
          await editMessageContent(ctx, "Выбор устарел — откройте оплату заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        const currentId = trialReplaceChoice.get(userId);
        const curIdxRaw = currentId ? trials.findIndex((s) => s.id === currentId) : 0;
        const curIdx = curIdxRaw >= 0 ? curIdxRaw : 0;
        const next = trials[(curIdx + 1) % trials.length]!;
        trialReplaceChoice.set(userId, next.id);
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === sel.tariffId);
        if (!tariff) {
          await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        await showPaymentMethodsForTariff(ctx, userId, tariff, sel.option, sel.extraDevices, config, innerStyles, innerEmojiIds, token);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "convx:toggle") {
      const sel = selectedTariffOption.get(userId);
      if (!sel) {
        await editMessageContent(ctx, "Выбор устарел — откройте оплату заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (convDropExtras.has(userId)) convDropExtras.delete(userId);
      else convDropExtras.add(userId);
      try {
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === sel.tariffId);
        if (!tariff) {
          await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        await showPaymentMethodsForTariff(ctx, userId, tariff, sel.option, sel.extraDevices, config, innerStyles, innerEmojiIds, token);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_ext_pickt:")) {
      const idx = Number(data.slice("pay_ext_pickt:".length));
      const cached = trialConvertPickCache.get(userId);
      const choice = cached && Number.isInteger(idx) ? cached.options[idx] : undefined;
      if (!cached || !choice) {
        await editMessageContent(ctx, "Выбор устарел — откройте продление заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === choice.id);
        if (!tariff) {
          await editMessageContent(ctx, "❌ Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        extendingSecondaryPending.set(userId, { tariffId: tariff.id, secondaryId: cached.sid });
        addsubPending.delete(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        if (opts.length > 1) {
          tariffOptionsCache.set(userId, { tariffId: tariff.id, options: opts });
          const bestId = bestPricePerDayOptionId(opts);
          await editMessageContent(ctx, `🔄 Переход на «${tariff.name}»\n\nВыберите длительность:`, tariffOptionPickerButtons(opts, tariff.currency, bestId, null, innerStyles, innerEmojiIds, null, config?.botEmojis ?? null));
          return;
        }
        const onlyOpt = opts[0] ?? null;
        if (onlyOpt) selectedTariffOption.set(userId, { tariffId: tariff.id, option: onlyOpt, extraDevices: 0 });
        await showPaymentMethodsForTariff(ctx, userId, tariff, onlyOpt, 0, config, innerStyles, innerEmojiIds, token);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
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
