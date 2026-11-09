import { Composer } from "grammy";
import type { Context } from "grammy";
import * as api from "../api.js";
import { awaitingGiftCode, clearUserState, giftOptionsCache, selectedGiftOption } from "../state-store.js";
import { RECEIPT_OK_LINE, _t, applyExtraDevicesPriceBot, backButton, backToMenu, blockUnsubscribedCallback, buildPaymentMessage, callbackUi, editMessageContent, enforceSubscription, formatMoney, formatRuDays, getOrRestoreToken, getSubscriptionUrl, getUserLang, giftCodeResultButtons, giftCodesListButtons, giftMenuButtons, giftPostPurchaseButtons, giftSubscriptionButtons, giftTariffButtons, hasExtraDevices, markHasOptions, openSubscribePageMarkup, payUrlMarkup, receiptPromptKeyboard, receiptPromptText, setTranslations, showCloudCheckout, showGiftDevicePicker, showGiftPaymentConfirm, sortedPriceOptions, storePendingReceipt, t, tariffErrMarkup, textInputUserId } from "./shared.js";
import type { InlineMarkup, TariffCategory, TariffItem } from "./shared.js";
import { resolveCallbackDomain } from "./routing.js";

export function createGiftHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

  composer.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from?.id;
    if (!userId) return;
    if (resolveCallbackDomain(data) !== "gifts") return next();
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

    if (data === "menu:gift") {
      clearUserState(userId);
      if (!config?.giftSubscriptionsEnabled) {
        await editMessageContent(ctx, "Функция подарков недоступна.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const intro = ((config as { giftIntroText?: string | null })?.giftIntroText ?? "").trim()
        || "🎁 Подарки и подписки\n\nЗдесь вы можете купить новые подписки, подарить их или активировать подарок.";
      await editMessageContent(
        ctx,
        intro,
        giftMenuButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
      );
      return;
    }

    if (data === "gift:buy") {
      const { items } = await api.getPublicTariffs();
      if (!items?.length) {
        await editMessageContent(ctx, "Тарифы не настроены.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      // текст редактируется в админке («Тексты бота» → bot_gift_buy_text);
      // раньше был захардкожен здесь (эталон клиента с описанием тарифов).
      const text = (config?.botGiftBuyText ?? "").trim() || [
        "Выберите тип подписки, которую хотите подарить:",
        "",
        "🚀 Стандартная — стандартная подписка с доступом ко всем локациям",
        "🔓 Unblock — позволяет оставаться на связи в любых ситуациях. Помогает, если у вас в регионе действуют ограничения интернета (отключают интернет), либо локации из обычной подписки уже не спасают.",
        "Есть лимит по трафику",
        "🔓∞ Безлимитный Unblock — Unblock без лимита трафика",
      ].join("\n");
      await editMessageContent(
        ctx,
        text,
        giftTariffButtons(markHasOptions(items), config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
      );
      return;
    }

    if (data.startsWith("gift_tariff:")) {
      const tariffId = data.slice("gift_tariff:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const opts = sortedPriceOptions(tariff.priceOptions);
      // Если опций > 1 — показываем picker длительности.
      if (opts.length > 1) {
        giftOptionsCache.set(userId, { tariffId, options: opts });
        const text = `🎁 ${tariff.name}\n\nВыберите длительность подписки:`;
        // Используем тот же picker длительности что и для основных тарифов, но с другим callback prefix.
        // звёздочка «лучшая цена за день» убрана по запросу клиента.
        const tariffPay = "success" as const;
        const rows: { text: string; callback_data: string }[][] = opts.map((o, idx) => {
          const sym = tariff.currency.toUpperCase() === "RUB" ? "₽" : tariff.currency.toUpperCase() === "USD" ? "$" : tariff.currency;
          return [{ text: `${o.durationDays} дн — ${o.price} ${sym}`.slice(0, 64), callback_data: `gift_topt:${idx}` }];
        });
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        await editMessageContent(ctx, text, { inline_keyboard: rows.map((r) => r.map((b) => ({ ...b, style: tariffPay }))) } as InlineMarkup);
        return;
      }
      // Одна опция — сохраняем её и идём к picker'у устройств (если включены)
      const onlyOpt = opts[0] ?? null;
      selectedGiftOption.set(userId, { tariffId, option: onlyOpt, extraDevices: 0 });
      if (hasExtraDevices(tariff)) {
        await showGiftDevicePicker(ctx, userId, tariff, onlyOpt, config, innerStyles, innerEmojiIds);
        return;
      }
      // Без опций и без extras — сразу подтверждение оплаты.
      await showGiftPaymentConfirm(ctx, userId, tariff, onlyOpt, 0, config, innerStyles, innerEmojiIds, token);
      return;
    }

    if (data.startsWith("gift_topt:")) {
      const idx = parseInt(data.slice("gift_topt:".length), 10);
      const cache = giftOptionsCache.get(userId);
      if (!cache || !Number.isFinite(idx) || idx < 0 || idx >= cache.options.length) {
        await editMessageContent(ctx, "Сессия истекла. Откройте подарки заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const option = cache.options[idx]!;
      selectedGiftOption.set(userId, { tariffId: cache.tariffId, option, extraDevices: 0 });
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === cache.tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (hasExtraDevices(tariff)) {
        await showGiftDevicePicker(ctx, userId, tariff, option, config, innerStyles, innerEmojiIds);
        return;
      }
      await showGiftPaymentConfirm(ctx, userId, tariff, option, 0, config, innerStyles, innerEmojiIds, token);
      return;
    }

    if (data.startsWith("gift_tdev:")) {
      const extras = parseInt(data.slice("gift_tdev:".length), 10);
      const sel = selectedGiftOption.get(userId);
      if (!sel || !Number.isFinite(extras) || extras < 0) {
        await editMessageContent(ctx, "Сессия истекла. Откройте подарки заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === sel.tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const cappedExtras = Math.min(Math.max(0, extras), tariff.maxExtraDevices ?? 0);
      selectedGiftOption.set(userId, { ...sel, extraDevices: cappedExtras });
      await showGiftPaymentConfirm(ctx, userId, tariff, sel.option, cappedExtras, config, innerStyles, innerEmojiIds, token);
      return;
    }

    if (data.startsWith("gift_pay_balance:")) {
      const tariffId = data.slice("gift_pay_balance:".length);
      try {
        const sel = selectedGiftOption.get(userId);
        const tariffPriceOptionId = sel?.tariffId === tariffId ? sel.option?.id : undefined;
        const extraDevices = sel?.tariffId === tariffId ? sel.extraDevices : 0;
        const result = await api.buyGiftSubscription(token, { tariffId, tariffPriceOptionId, extraDevices });
        selectedGiftOption.delete(userId);
        await editMessageContent(
          ctx,
          `✅ Подписка создана!\n\nПодписка #${result.subscriptionIndex}\n\nВы можете активировать её на своём аккаунте или подарить другу.`,
          giftPostPurchaseButtons(result.subscriptionId, result.subscriptionIndex, config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift_pay_cispay:") || data.startsWith("gift_pay_stars:") || data.startsWith("gift_pay_yookassa:") || data.startsWith("gift_pay_yoomoney:") || data.startsWith("gift_pay_cryptopay:") || data.startsWith("gift_pay_heleket:") || data.startsWith("gift_pay_lava:") || data.startsWith("gift_pay_paritypay:") || data.startsWith("gift_pay_cloudpayments:") || data.startsWith("gift_pay_platega:")) {
      const isPlategaGift = data.startsWith("gift_pay_platega:");
      const giftParts = isPlategaGift ? data.split(":") : [];
      const plategaMethodId = isPlategaGift ? Number(giftParts[2]) : null;
      const provider = data.startsWith("gift_pay_stars:") ? "telegram_stars" : data.startsWith("gift_pay_yookassa:") ? "yookassa"
        : data.startsWith("gift_pay_yoomoney:") ? "yoomoney"
        : data.startsWith("gift_pay_cryptopay:") ? "cryptopay"
        : data.startsWith("gift_pay_heleket:") ? "heleket"
        : data.startsWith("gift_pay_cispay:") ? "cispay"
        : data.startsWith("gift_pay_cloudpayments:") ? "cloudpayments"
        : data.startsWith("gift_pay_paritypay:") ? "paritypay"
        : isPlategaGift ? "platega"
        : "lava";
      const tariffId = isPlategaGift ? (giftParts[1] ?? "") : data.slice(data.indexOf(":") + 1);
      try {
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
        if (!tariff) {
          await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        const sel = selectedGiftOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;

        // T-unify: создаём платёж с покупкой подарочной. На бэке metadata.purchasedAsGift=true.
        // Используем тот же flow что обычная asAdditional покупка, но с дополнительным флагом.
        const nameWithDaysGift = `🎁 ${tariff.name} · ${formatRuDays(effectiveDays)} (подарочная)`;
        const renderGiftFinal = async (payUrl: string, receiptSentTo: string | null) => {
          const msg = buildPaymentMessage(config, {
            name: nameWithDaysGift,
            price: formatMoney(effectivePrice, tariff.currency),
            amount: String(effectivePrice),
            currency: tariff.currency,
            action: "Нажмите кнопку ниже для оплаты:",
          });
          const markup = payUrlMarkup(payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
          if (receiptSentTo) {
            await ctx.reply(`${msg.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
          } else {
            await ctx.reply(msg.text, { entities: msg.entities, reply_markup: markup });
          }
        };

        if (provider === "yookassa") {
          // 54-ФЗ-чек prompt только для ЮКассы.
          const meGf = await api.getMe(token);
          const savedEmailGf = meGf?.email ?? null;
          const tokRcptGf = storePendingReceipt({
            userId,
            savedEmail: savedEmailGf,
            builder: (receiptEmail) => api.createYookassaPayment(token, { amount: effectivePrice, currency: "RUB", tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true, receiptEmail }),
            finalize: async (payment, { receiptSentTo }) => {
              selectedGiftOption.delete(userId);
              await renderGiftFinal(payment.confirmationUrl, receiptSentTo);
            },
          });
          await editMessageContent(ctx, receiptPromptText(savedEmailGf), receiptPromptKeyboard(tokRcptGf, savedEmailGf));
          return;
        }

        // Остальные провайдеры — как было (без чека-prompt).
        let payUrl: string | null = null;
        if (provider === "yoomoney") {
          const p = await api.createYoomoneyPayment(token, { amount: effectivePrice, paymentType: "AC", tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.paymentUrl;
        } else if (provider === "cryptopay" || provider === "telegram_stars") {
          const p = await (provider === "telegram_stars" ? api.createStarsPayment : api.createCryptopayPayment)(token, { amount: effectivePrice, currency: tariff.currency, tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.payUrl;
        } else if (provider === "heleket") {
          const p = await api.createHeleketPayment(token, { amount: effectivePrice, currency: tariff.currency, tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.payUrl;
        } else if (provider === "cispay") {
          const p = await api.createCispayPayment(token, { amount: effectivePrice, currency: tariff.currency, tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.payUrl;
        } else if (provider === "cloudpayments") {
          const p = await api.createCloudpaymentsPayment(token, { amount: effectivePrice, currency: "RUB", tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          selectedGiftOption.delete(userId);
          await showCloudCheckout(ctx, token, p, config?.cloudpaymentsBotDirect === true);
          return;
        } else if (provider === "paritypay") {
          const p = await api.createParitypayPayment(token, { amount: effectivePrice, currency: "RUB", tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.payUrl;
        } else if (provider === "platega" && plategaMethodId != null) {
          const p = await api.createPlategaPayment(token, { amount: effectivePrice, currency: "RUB", paymentMethod: plategaMethodId, tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.paymentUrl;
        } else {
          const p = await api.createLavaPayment(token, { amount: effectivePrice, currency: "RUB", tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.payUrl;
        }

        selectedGiftOption.delete(userId);

        if (!payUrl) {
          await editMessageContent(ctx, "❌ Не удалось получить ссылку оплаты", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        await renderGiftFinal(payUrl, null);
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${errMsg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "gift:subscriptions") {
      try {
        const result = await api.getGiftSubscriptions(token);
        if (!result.subscriptions?.length) {
          await editMessageContent(
            ctx,
            "🎁 Мои подарки\n\nУ вас нет купленных подарочных подписок.\n\nКупите подписку через «🛒 Купить новую подписку» — она появится здесь.",
            giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null),
          );
          return;
        }
        // «🎁 Мои подарки» — только подписки купленные через gift flow.
        // Для GIFT_RESERVED — кнопки «Показать код» / «Отменить» / «Забрать себе».
        // Для без статуса — «Подарить» / «Удалить» / «Забрать себе».
        await editMessageContent(
          ctx,
          `🎁 Мои подарки\n\nУ вас ${result.subscriptions.length} ${result.subscriptions.length === 1 ? "подарочная подписка" : "подарочных подписок"}:\n\n📌 Если подписка БЕЗ кода:\n• «🎁 Подарить» — создать код для друга\n• «✅ Забрать себе» — перенести в «📋 Мои подписки»\n• «🗑 Удалить» — отменить покупку\n\n📌 Если КОД УЖЕ СОЗДАН (нажмите на подписку):\n• Откроется ссылка на подарок — переслать другу\n• «❌ Отменить код» — снять резерв подарка\n• «✅ Забрать себе» — отменить код и забрать себе`,
          giftSubscriptionButtons(result.subscriptions, config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift:take_self:")) {
      const subscriptionId = data.slice("gift:take_self:".length);
      try {
        await api.activateGiftForSelf(token, subscriptionId);
        await editMessageContent(
          ctx,
          "✅ Подписка перенесена в «📋 Мои подписки»!\n\nТеперь её можно подключить через главное меню → «🔌 Подключиться».",
          {
            inline_keyboard: [
              [{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка переноса";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift:connect:")) {
      const subscriptionId = data.slice("gift:connect:".length);
      try {
        // больше НЕ зовём activateGiftForSelf автоматически.
        // Раньше при простом получении URL подарок автоматом «забирался себе» →
        // подписка пропадала из «🎁 Мои подарки» и появлялась в «📋 Мои подписки».
        // Теперь забрать себе можно ТОЛЬКО явной кнопкой «✅ Забрать себе» в gift menu.
        const result = await api.getGiftSubscriptionUrl(token, subscriptionId);
        const appUrl2 = config?.publicAppUrl?.replace(/\/$/, "") ?? null;

        // Если включена Remna-страница подписки — отдаём remna subscriptionUrl.
        if (config?.useRemnaSubscriptionPage) {
          const byUuid = await api.getSubscriptionByUuid(token, result.uuid);
          const remnaUrl = getSubscriptionUrl(byUuid.subscription);
          if (!remnaUrl) {
            await editMessageContent(
              ctx,
              "❌ Не удалось получить ссылку Remna для этой подписки.",
              backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds),
            );
            return;
          }
          await editMessageContent(
            ctx,
            `📲 Ссылка на подписку:\n\n${remnaUrl}`,
            openSubscribePageMarkup(appUrl2 ?? "", config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds, remnaUrl),
          );
          return;
        }

        // Иначе показываем ссылку + кнопку "Подключиться" в мини-апп на нашу страницу
        // подключения для конкретной secondary-подписки.
        const webUrl = appUrl2 ? `${appUrl2}/cabinet/subscribe?uuid=${encodeURIComponent(result.uuid)}` : null;
        const buttons = webUrl
          ? {
              inline_keyboard: [
                [{ text: "📲 Подключиться", web_app: { url: webUrl } }],
                [{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:gift" }],
              ],
            }
          : giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null);
        await editMessageContent(
          ctx,
          `📲 Ссылка на подписку:\n\n${webUrl ?? `Подписка UUID: ${result.uuid}`}`,
          buttons,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка получения ссылки";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift:noop:")) {
      await ctx.answerCallbackQuery({ text: "Используйте кнопки ниже для управления кодом подарка" }).catch(() => {});
      return;
    }

    if (data.startsWith("gift:show_code:")) {
      const subscriptionId = data.slice("gift:show_code:".length);
      try {
        const result = await api.getActiveGiftCodeForSubscription(token, subscriptionId);
        const expiresAt = new Date(result.expiresAt).toLocaleDateString("ru-RU");
        const tariffLabel = result.tariffName ? `\nТариф: ${result.tariffName}` : "";
        const botUsername = ctx.me?.username ?? "";
        const giftUrl = botUsername ? `https://t.me/${botUsername}?start=gift_${result.code}` : "";
        // Telegram share API требует `?url=` параметр —
        // без него share-окно не открывается на десктопе и части мобильных клиентов.
        // Ссылка автоматически идёт как preview-карточка сверху. Это нативное поведение TG,
        // изменить порядок невозможно через стандартное share API.
        // новый текст для шеринга подарочной подписки.
        const shareText = `У меня для тебя подарок 🎁\n \nПодписка на сервис безопасного удалённого доступа 🛡 \n\n💡 Нажми на ссылку, чтобы активировать:\n\n${giftUrl}`;
        const shareUrl = giftUrl ? `https://t.me/share/url?url=${encodeURIComponent(giftUrl)}&text=${encodeURIComponent(shareText)}` : "";
        const buttons: (({ text: string; callback_data: string } | { text: string; url: string })[])[] = [];
        if (shareUrl) buttons.push([{ text: "📤 Поделиться в Telegram", url: shareUrl }]);
        // убрана кнопка «🔗 Ссылка на подарок (для пересылки)»
        // по запросу клиента — ссылка уже видна в тексте сообщения, копируется тапом.
        buttons.push([{ text: "❌ Отменить код", callback_data: `gift:cancel_code:${subscriptionId}` }]);
        buttons.push([{ text: backButton(config?.botEmojis ?? null).text, callback_data: "gift:subscriptions" }]);
        await editMessageContent(
          ctx,
          `🎁 Активный подарочный код:\n\nКод: \`${result.code}\`${tariffLabel}\n\n📲 Перешлите получателю эту ссылку — она откроет бота и активирует подписку автоматически:\n${giftUrl}\n\nКод действителен до ${expiresAt}.`,
          { inline_keyboard: buttons },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки кода";
        await editMessageContent(ctx, `❌ ${msg}`, {
          inline_keyboard: [[{ text: "← К подаркам", callback_data: "gift:subscriptions" }]],
        });
      }
      return;
    }

    if (data.startsWith("gift:cancel_code:")) {
      const subscriptionId = data.slice("gift:cancel_code:".length);
      try {
        // Сначала находим активный код по подписке, потом отменяем по нему.
        const codeInfo = await api.getActiveGiftCodeForSubscription(token, subscriptionId);
        await api.cancelGiftCode(token, codeInfo.code);
        await editMessageContent(
          ctx,
          `✅ Подарочный код отменён.\n\nПодписка снова доступна для подарка или активации.`,
          {
            inline_keyboard: [
              [{ text: "🎁 К моим подаркам", callback_data: "gift:subscriptions" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка отмены";
        await editMessageContent(ctx, `❌ ${msg}`, {
          inline_keyboard: [[{ text: "← К подаркам", callback_data: "gift:subscriptions" }]],
        });
      }
      return;
    }

    if (data.startsWith("gift:give:")) {
      const subscriptionId = data.slice("gift:give:".length);
      try {
        const result = await api.createGiftCode(token, { subscriptionId: subscriptionId });

        // ссылка teper deep-link в Telegram-бот.
        const botUsername = ctx.me?.username ?? "";
        const giftUrl = botUsername ? `https://t.me/${botUsername}?start=gift_${result.code}` : "";

        // `?url=` обязателен — иначе share не работает на части клиентов.
        // URL всегда идёт превью сверху (нативное поведение TG, не меняется через standard share API).
        // новый текст для шеринга подарочной подписки.
        const shareText = `У меня для тебя подарок 🎁\n \nПодписка на сервис безопасного удалённого доступа 🛡 \n\n💡 Нажми на ссылку, чтобы активировать:\n\n${giftUrl}`;
        const shareUrl = giftUrl
          ? `https://t.me/share/url?url=${encodeURIComponent(giftUrl)}&text=${encodeURIComponent(shareText)}`
          : "";

        const buttons: (({ text: string; callback_data: string } | { text: string; url: string })[])[] = [];
        if (shareUrl) {
          buttons.push([{ text: "📤 Поделиться в Telegram", url: shareUrl }]);
        }
        buttons.push([{ text: "❌ Отменить код", callback_data: `gift:cancel_code:${subscriptionId}` }]);
        buttons.push([{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:gift" }]);

        // два формата текста подарка из ТЗ клиента —
        // 1) Стандартная (без трафика) — формат «Код / Тариф / N дней».
        // 2) Unblock (с трафиком) — формат «N дней, NN GB» + «💡 Чтобы скопировать ссылку, нажмите...».
        const hasTrafficLimit = result.trafficLimitBytes != null && result.trafficLimitBytes > 0;
        const tariffDisplay = result.tariffName ?? "Подписка";
        const trafficGb = hasTrafficLimit ? `${Math.round((result.trafficLimitBytes ?? 0) / 1024 ** 3)} GB` : "";
        const days = result.durationDays ?? 0;
        let msgText: string;
        if (hasTrafficLimit) {
          msgText = `💝 Подарочная ${tariffDisplay} готова!\n\n✅ Оплата прошла успешно.\n📅 ${days} дней, ${trafficGb}\n\n👉 Перешлите ссылку человеку, которому хотите подарить подписку ⬇️\n\n💡 Чтобы скопировать ссылку, нажмите на неё один раз.\n\n${giftUrl}\n\n🎉 При переходе по ссылке подписка автоматически активируется!`;
        } else {
          msgText = `💝 Подарочная подписка готова!\n\n✅ Оплата прошла успешно.\nКод: \`${result.code}\`\nТариф: ${tariffDisplay}\n📅 ${days} дней\n\n👉 Перешлите ссылку человеку, которому хотите подарить подписку ⬇️\n\n${giftUrl}\n\n🎉 При переходе по ссылке подписка автоматически активируется!`;
        }

        await editMessageContent(ctx, msgText, { inline_keyboard: buttons });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания кода";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift:delete:")) {
      const subscriptionId = data.slice("gift:delete:".length);
      try {
        const result = await api.deleteGiftSubscription(token, subscriptionId);
        await editMessageContent(
          ctx,
          `✅ ${result.message || "Подписка удалена"}`,
          giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка удаления";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "gift:redeem") {
      awaitingGiftCode.add(userId);
      // «← Назад» в gift меню + «🏠 Главное меню».
      await editMessageContent(
        ctx,
        "🎁 Введите подарочный код:",
        {
          inline_keyboard: [
            [{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:gift" }],
            [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
          ],
        },
      );
      return;
    }

    if (data === "gift:codes") {
      try {
        const result = await api.getGiftCodes(token);
        if (!result.codes?.length) {
          await editMessageContent(
            ctx,
            "🎟️ Мои подарки\n\nУ вас пока нет подарочных кодов.",
            giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null),
          );
          return;
        }
        const lines = result.codes.map((c) => {
          const statusLabel = c.status === "ACTIVE" ? "✅ Активен" : c.status === "REDEEMED" ? "🎁 Использован" : "❌ Отменён";
          return `${c.code} — ${statusLabel}`;
        }).join("\n");
        await editMessageContent(
          ctx,
          `🎟️ Мои подарки\n\n${lines}`,
          giftCodesListButtons(result.codes, config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift:cancel_code:")) {
      const codeOrId = data.slice("gift:cancel_code:".length);
      try {
        const result = await api.cancelGiftCode(token, codeOrId);
        await editMessageContent(
          ctx,
          `✅ ${result.message}`,
          giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка отмены";
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

  composer.on("message:text", async (ctx, next) => {
    const userId = textInputUserId(ctx);
    if (!userId) return next();
    if (!awaitingGiftCode.has(userId)) return next();

    const token = await getOrRestoreToken(userId, ctx.from?.username);
    if (!token) return;
    const publicConfig = await api.getPublicConfig().catch(() => null);
    if (await enforceSubscription(ctx, publicConfig)) return;

  if (awaitingGiftCode.has(userId)) {
    awaitingGiftCode.delete(userId);
    const code = ctx.message.text.trim().toUpperCase();
    const menuKb = { reply_markup: { inline_keyboard: [[{ text: backButton(publicConfig?.botEmojis ?? null).text, callback_data: "menu:gift" }]] } };
    if (!code) {
      await ctx.reply("Код не может быть пустым.", menuKb);
      return;
    }
    try {
      const result = await api.redeemGiftCode(token, code);
      let text = `✅ Подарок активирован!\n\nПодписка #${result.subscriptionIndex} добавлена в ваш аккаунт!`;
      if (result.tariffName) {
        text += `\nТариф: ${result.tariffName}`;
      }
      if (result.giftMessage) {
        text += `\n\n💌 Сообщение от дарителя:\n«${result.giftMessage}»`;
      }
      await ctx.reply(text, menuKb);

      // Уведомляем дарителя о том, что подарок активирован
      if (result.creatorTelegramId) {
        const recipientName = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? "Пользователь";
        const notifyText = `🎁 Ваш подарок активирован!\n\n${recipientName} принял(а) ваш подарок${result.tariffName ? ` (${result.tariffName})` : ""}.`;
        ctx.api.sendMessage(result.creatorTelegramId, notifyText).catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка активации подарка";
      await ctx.reply(`❌ ${msg}`, menuKb);
    }
    return;
  }

    return next();
  });

  return composer;
}
