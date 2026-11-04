import { Composer } from "grammy";
import type { Context } from "grammy";
import * as api from "../api.js";
import { activeDiscountCode, addsubPending, awaitingCustomTopup, clearUserState, convDropExtras, extendingSecondaryPending, extraOptionPending, extraOptionTargetSub, pendingDropExtras, selectedTariffOption, tariffOptionsCache, tokenStore, trialReplaceChoice } from "../state-store.js";
import { EMAIL_PROMPT_TEXT, RECEIPT_OK_LINE, _t, applyExtraDevicesPriceBot, backButton, backToMenu, bestPricePerDayOptionId, blockUnsubscribedCallback, buildPaymentMessage, buildTariffDiscountArg, callbackUi, editMessageContent, enforceSubscription, formatMoney, formatRuDays, getDiscountedPrice, getOrRestoreToken, getUserLang, hasExtraDevices, hasPendingEmailInput, instructionFallbackText, isValidEmail, optionPaymentMethodButtons, payUrlMarkup, peekPendingReceipt, proxyPaymentMethodButtons, receiptPromptKeyboard, receiptPromptText, renewableSubscriptions, setPendingEmailInput, setTranslations, setUserLang, shouldShowPurchaseChoice, showCloudCheckout, showPaymentMethodsForTariff, singboxPaymentMethodButtons, sortedPriceOptions, storePendingReceipt, t, takePendingEmailInput, takePendingReceipt, tariffActionChoiceButtons, tariffDevicePickerButtons, tariffErrMarkup, tariffOptionPickerButtons, textInputUserId, titleWithEmoji, topUpPresets, topupPaymentMethodButtons, tryAutoDeleteUnknown } from "./shared.js";
import type { InnerEmojiIds, TariffCategory, TariffItem } from "./shared.js";
import { resolveCallbackDomain } from "./routing.js";
import { showRenewalChoice } from "./subscriptions.js";

export function createPaymentHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

  composer.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from?.id;
    if (!userId) return;
    if (resolveCallbackDomain(data) !== "payments") return next();
    if (data.startsWith("yk_recpt:")) {
  if (data.startsWith("yk_recpt:")) {
    const parts = data.split(":");
    const action = parts[1]; // no | saved | ask
    const tok = parts.slice(2).join(":");
    if (action === "ask") {
      const p = peekPendingReceipt(tok);
      if (!p || p.userId !== userId) {
        await ctx.reply("⏰ Сессия истекла. Откройте «Оплатить» ещё раз.");
        return;
      }
      setPendingEmailInput(userId, tok);
      await ctx.reply(EMAIL_PROMPT_TEXT);
      return;
    }
    const p = takePendingReceipt(tok);
    if (!p || p.userId !== userId) {
      await ctx.reply("⏰ Сессия истекла. Откройте «Оплатить» ещё раз.");
      return;
    }
    // для "no" передаём пустую строку (явный отказ),
    // не undefined: иначе backend сделает fallback на client.email и пришлёт чек.
    const receiptEmail: string = action === "saved" ? (p.savedEmail ?? "") : "";
    try {
      const payment = await p.builder(receiptEmail);
      await p.finalize(payment, { receiptSentTo: receiptEmail || null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
      await ctx.reply(`❌ ${msg}`);
    }
    return;
  }
    }
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

    if (data.startsWith("pay_proxy_balance:")) {
      const proxyTariffId = data.slice("pay_proxy_balance:".length);
      try {
        const result = await api.payByBalance(token, { proxyTariffId });
        await editMessageContent(ctx, `✅ ${result.message}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_proxy_yoomoney:")) {
      const proxyTariffId = data.slice("pay_proxy_yoomoney:".length);
      const { items } = await api.getPublicProxyTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === proxyTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createYoomoneyPayment(token, { amount: tariff.price, paymentType: "AC", proxyTariffId });
        const msg = buildPaymentMessage(config, {
          name: tariff.name,
          price: formatMoney(tariff.price, tariff.currency),
          amount: String(tariff.price),
          currency: tariff.currency,
          action: "Нажмите для оплаты:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_proxy_yookassa:")) {
      const proxyTariffId = data.slice("pay_proxy_yookassa:".length);
      const { items } = await api.getPublicProxyTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === proxyTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (tariff.currency.toUpperCase() !== "RUB") {
        await editMessageContent(ctx, "ЮKassa принимает только рубли (RUB).", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        // 54-ФЗ-чек prompt перед созданием платежа.
        const mePx = await api.getMe(token);
        const savedEmailPx = mePx?.email ?? null;
        const tokRcptP = storePendingReceipt({
          userId,
          savedEmail: savedEmailPx,
          builder: (receiptEmail) => api.createYookassaPayment(token, { amount: tariff.price, currency: "RUB", proxyTariffId, receiptEmail }),
          finalize: async (payment, { receiptSentTo }) => {
            const msg = buildPaymentMessage(config, {
              name: tariff.name,
              price: formatMoney(tariff.price, tariff.currency),
              amount: String(tariff.price),
              currency: tariff.currency,
              action: "Нажмите для оплаты:",
            });
            const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
            if (receiptSentTo) {
              await ctx.reply(`${msg.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
            } else {
              await ctx.reply(msg.text, { entities: msg.entities, reply_markup: markup });
            }
          },
        });
        await editMessageContent(ctx, receiptPromptText(savedEmailPx), receiptPromptKeyboard(tokRcptP, savedEmailPx));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_proxy_cryptopay:") || data.startsWith("pay_proxy_stars:")) {
      const proxyTariffId = data.slice(data.indexOf(":") + 1);
      const { items } = await api.getPublicProxyTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === proxyTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await (data.startsWith("pay_proxy_stars:") ? api.createStarsPayment : api.createCryptopayPayment)(token, { amount: tariff.price, currency: tariff.currency, proxyTariffId });
        const msg = buildPaymentMessage(config, { name: tariff.name, price: formatMoney(tariff.price, tariff.currency), amount: String(tariff.price), currency: tariff.currency, action: "Нажмите для оплаты:" });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_proxy:")) {
      const rest = data.slice("pay_proxy:".length);
      const parts = rest.split(":");
      const proxyTariffId = parts[0];
      const methodIdFromBtn = parts.length >= 2 ? Number(parts[1]) : null;
      const { items } = await api.getPublicProxyTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === proxyTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const methods = config?.plategaMethods ?? [];
      const client = await api.getMe(token);
      const balanceLabel = client && client.balance >= tariff.price ? `💰 Оплатить балансом (${formatMoney(client.balance, client.preferredCurrency ?? "RUB")})` : null;
      const discountInfoProxy = activeDiscountCode.get(userId);
      const promoCodeProxy = discountInfoProxy?.code;
      const discountArgProxy = discountInfoProxy ? {
        originalPrice: formatMoney(tariff.price, tariff.currency),
        discountedPrice: formatMoney(getDiscountedPrice(tariff.price, discountInfoProxy), tariff.currency),
      } : undefined;
      if (methodIdFromBtn != null && Number.isFinite(methodIdFromBtn)) {
        try {
          const payment = await api.createPlategaPayment(token, {
            amount: tariff.price,
            currency: tariff.currency,
            paymentMethod: methodIdFromBtn,
            description: `Прокси: ${tariff.name}`,
            proxyTariffId: tariff.id,
            promoCode: promoCodeProxy,
          });
          if (promoCodeProxy) activeDiscountCode.delete(userId);
          const msg = buildPaymentMessage(config, {
            name: tariff.name,
            price: formatMoney(tariff.price, tariff.currency),
            amount: String(tariff.price),
            currency: tariff.currency,
            action: "Нажмите для оплаты:",
          }, discountArgProxy);
          await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Ошибка";
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
        }
        return;
      }
      const markup = proxyPaymentMethodButtons(
        proxyTariffId,
        methods,
        config?.botBackLabel ?? null,
        innerStyles?.back,
        innerEmojiIds,
        balanceLabel,
        !!config?.yoomoneyEnabled,
        !!config?.yookassaEnabled,
        !!config?.cryptopayEnabled,
        tariff.currency,
      );
      const msg = buildPaymentMessage(config, {
        name: tariff.name,
        price: formatMoney(tariff.price, tariff.currency),
        amount: String(tariff.price),
        currency: tariff.currency,
        action: "Выберите способ оплаты:",
      }, discountArgProxy);
      await editMessageContent(ctx, msg.text, markup, msg.entities);
      return;
    }

    if (data.startsWith("pay_singbox_balance:")) {
      const singboxTariffId = data.slice("pay_singbox_balance:".length);
      try {
        const result = await api.payByBalance(token, { singboxTariffId });
        await editMessageContent(ctx, `✅ ${result.message}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_singbox_yoomoney:")) {
      const singboxTariffId = data.slice("pay_singbox_yoomoney:".length);
      const { items } = await api.getPublicSingboxTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === singboxTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createYoomoneyPayment(token, { amount: tariff.price, paymentType: "AC", singboxTariffId });
        const msg = buildPaymentMessage(config, {
          name: tariff.name,
          price: formatMoney(tariff.price, tariff.currency),
          amount: String(tariff.price),
          currency: tariff.currency,
          action: "Нажмите для оплаты:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_singbox_yookassa:")) {
      const singboxTariffId = data.slice("pay_singbox_yookassa:".length);
      const { items } = await api.getPublicSingboxTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === singboxTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (tariff.currency.toUpperCase() !== "RUB") {
        await editMessageContent(ctx, "ЮKassa принимает только рубли (RUB).", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        // 54-ФЗ-чек prompt.
        const meSb = await api.getMe(token);
        const savedEmailSb = meSb?.email ?? null;
        const tokRcptSb = storePendingReceipt({
          userId,
          savedEmail: savedEmailSb,
          builder: (receiptEmail) => api.createYookassaPayment(token, { amount: tariff.price, currency: "RUB", singboxTariffId, receiptEmail }),
          finalize: async (payment, { receiptSentTo }) => {
            const msg = buildPaymentMessage(config, {
              name: tariff.name,
              price: formatMoney(tariff.price, tariff.currency),
              amount: String(tariff.price),
              currency: tariff.currency,
              action: "Нажмите для оплаты:",
            });
            const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
            if (receiptSentTo) {
              await ctx.reply(`${msg.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
            } else {
              await ctx.reply(msg.text, { entities: msg.entities, reply_markup: markup });
            }
          },
        });
        await editMessageContent(ctx, receiptPromptText(savedEmailSb), receiptPromptKeyboard(tokRcptSb, savedEmailSb));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_singbox_cryptopay:") || data.startsWith("pay_singbox_stars:")) {
      const singboxTariffId = data.slice(data.indexOf(":") + 1);
      const { items } = await api.getPublicSingboxTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === singboxTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await (data.startsWith("pay_singbox_stars:") ? api.createStarsPayment : api.createCryptopayPayment)(token, { amount: tariff.price, currency: tariff.currency, singboxTariffId });
        const msg = buildPaymentMessage(config, { name: tariff.name, price: formatMoney(tariff.price, tariff.currency), amount: String(tariff.price), currency: tariff.currency, action: "Нажмите для оплаты:" });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_singbox:")) {
      const rest = data.slice("pay_singbox:".length);
      const parts = rest.split(":");
      const singboxTariffId = parts[0];
      const methodIdFromBtn = parts.length >= 2 ? Number(parts[1]) : null;
      const { items } = await api.getPublicSingboxTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === singboxTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const methods = config?.plategaMethods ?? [];
      const client = await api.getMe(token);
      const balanceLabel = client && client.balance >= tariff.price ? `💰 Оплатить балансом (${formatMoney(client.balance, client.preferredCurrency ?? "RUB")})` : null;
      const discountInfoSingbox = activeDiscountCode.get(userId);
      const promoCodeSingbox = discountInfoSingbox?.code;
      const discountArgSingbox = discountInfoSingbox ? {
        originalPrice: formatMoney(tariff.price, tariff.currency),
        discountedPrice: formatMoney(getDiscountedPrice(tariff.price, discountInfoSingbox), tariff.currency),
      } : undefined;
      if (methodIdFromBtn != null && Number.isFinite(methodIdFromBtn)) {
        try {
          const payment = await api.createPlategaPayment(token, {
            amount: tariff.price,
            currency: tariff.currency,
            paymentMethod: methodIdFromBtn,
            description: `Доступы: ${tariff.name}`,
            singboxTariffId: tariff.id,
            promoCode: promoCodeSingbox,
          });
          if (promoCodeSingbox) activeDiscountCode.delete(userId);
          const msg = buildPaymentMessage(config, {
            name: tariff.name,
            price: formatMoney(tariff.price, tariff.currency),
            amount: String(tariff.price),
            currency: tariff.currency,
            action: "Нажмите для оплаты:",
          }, discountArgSingbox);
          await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Ошибка";
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
        }
        return;
      }
      const markup = singboxPaymentMethodButtons(
        singboxTariffId,
        methods,
        config?.botBackLabel ?? null,
        innerStyles?.back,
        innerEmojiIds,
        balanceLabel,
        !!config?.yoomoneyEnabled,
        !!config?.yookassaEnabled,
        !!config?.cryptopayEnabled,
        tariff.currency,
      );
      const msg = buildPaymentMessage(config, {
        name: tariff.name,
        price: formatMoney(tariff.price, tariff.currency),
        amount: String(tariff.price),
        currency: tariff.currency,
        action: "Выберите способ оплаты:",
      }, discountArgSingbox);
      await editMessageContent(ctx, msg.text, markup, msg.entities);
      return;
    }

    if (data.startsWith("pay_tariff_balance:")) {
      const tariffIdRaw = data.slice("pay_tariff_balance:".length);
      // ":go" = юзер подтвердил жёсткую замену на экране-предупреждении балансовой оплаты.
      const balanceReplaceConfirmed = tariffIdRaw.endsWith(":go");
      const tariffId = balanceReplaceConfirmed ? tariffIdRaw.slice(0, -3) : tariffIdRaw;
      // если в addsub-режиме — переключаемся на gift/buy (создаёт
      // secondary subscription напрямую с балансом, без webhook'а — отдельный path
      // от обычной activateTariffForClient). Промокод не применяется к доп. подпискам.
      const asAdditional = addsubPending.get(userId) === tariffId;
      const extPairTid = extendingSecondaryPending.get(userId);
      const extendsSecondarySubId = extPairTid && extPairTid.tariffId === tariffId ? extPairTid.secondaryId : undefined;
      try {
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
        if (!tariff) {
          await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const tariffPriceOptionId = sel?.tariffId === tariffId ? sel.option.id : undefined;
        const extraDevices = sel?.tariffId === tariffId ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        let resultMessage: string;
        // ── Подтверждение перед ЛЮБОЙ покупкой с баланса, кроме чистого продления ──
        // Баланс списывает МГНОВЕННО, поэтому до любой операции, затрагивающей текущую
        // подписку (замена/конвертация/удаление лишних), показываем экран-предупреждение.
        // Пропускаем только чистое продление того же тарифа (extend без удаления других).
        if (!balanceReplaceConfirmed) {
          const convBal = await api.tariffConversionPreview(token, { tariffId, priceOptionId: tariffPriceOptionId }).catch(() => null);
          if (convBal && convBal.willConvert && (convBal.mode !== "extend" || (convBal.othersToRemove ?? 0) > 0)) {
            const subNameBal = convBal.subscription?.tariffName ? `«${convBal.subscription.tariffName}»` : "текущую подписку";
            const bodyBal = convBal.mode === "replace"
              ? `Старая подписка удалится, остаток ${convBal.remainingDays ?? 0} дн. СГОРИТ — создастся новая на выбранный тариф (${convBal.purchasedDays ?? 0} дн. с нуля). VPN-ссылка сохранится.`
              : convBal.mode === "extend"
                ? `Этот тариф у вас уже есть — он будет продлён.`
                : `Текущая подписка будет переведена на новый тариф. Остаток ${convBal.remainingDays ?? 0} дн. пересчитается в ${convBal.convertedDays ?? 0} дн. по цене нового тарифа.`;
            const othersLineBal = (convBal.othersToRemove ?? 0) > 0 ? `\n⚠️ Остальные ${convBal.othersToRemove} ваши подписки будут УДАЛЕНЫ — останется одна.` : "";
            await editMessageContent(
              ctx,
              `🔄 Внимание: ${convBal.mode === "extend" ? "продление затронет" : "покупка ЗАМЕНИТ"} ${subNameBal}.\n\n${bodyBal}${othersLineBal}\n\nСписать ${formatMoney(totalPrice, tariff.currency)} с баланса и продолжить?`,
              { inline_keyboard: [[{ text: "✅ Да, продолжить и списать", callback_data: `pay_tariff_balance:${tariffId}:go` }], [{ text: "◀️ Отмена", callback_data: "menu:tariffs" }]] },
            );
            return;
          }
        }
        // T7b: продление существующей secondary имеет приоритет над addsub.
        if (extendsSecondarySubId) {
          const discountInfoBal = activeDiscountCode.get(userId);
          const promoCode = discountInfoBal?.code;
          const result = await api.payByBalance(token, { tariffId, tariffPriceOptionId, deviceCount: extraDevices, promoCode, extendsSecondarySubId, removeExtrasOnActivate });
          if (promoCode) activeDiscountCode.delete(userId);
          extendingSecondaryPending.delete(userId);
          if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
          resultMessage = result.message;
        } else if (asAdditional) {
          // покупка доп. подписки балансом теперь идёт через
          // /payments/balance с asAdditional=true (НЕ через gift/buy — иначе подписки
          // ошибочно попадали в «🎁 Мои подарки» вместо «📋 Мои подписки»).
          const discountInfoBal = activeDiscountCode.get(userId);
          const promoCode = discountInfoBal?.code;
          const result = await api.payByBalance(token, { tariffId, tariffPriceOptionId, deviceCount: extraDevices, promoCode, asAdditional: true, removeExtrasOnActivate, replaceTrialSubId });
          if (promoCode) activeDiscountCode.delete(userId);
          addsubPending.delete(userId);
          resultMessage = result.message;
        } else {
          const discountInfoBal = activeDiscountCode.get(userId);
          const promoCode = discountInfoBal?.code;
          const result = await api.payByBalance(token, { tariffId, tariffPriceOptionId, deviceCount: extraDevices, promoCode, removeExtrasOnActivate, replaceTrialSubId });
          if (promoCode) activeDiscountCode.delete(userId);
          resultMessage = result.message;
        }
        selectedTariffOption.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        await editMessageContent(ctx, `✅ ${resultMessage}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_tariff_yoomoney:")) {
      const tariffId = data.slice("pay_tariff_yoomoney:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfoYm = activeDiscountCode.get(userId);
        const promoCode = discountInfoYm?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // addsub mode → backend mark metadata.isAdditionalSubscription
        // → activateTariffByPaymentId создаст secondary вместо основной подписки.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // унифицированный расчёт personal+promo,
        // отображаем зачёркнутую базовую цену и финальную с %.
        const me = await api.getMe(token);
        const pd = me?.personalDiscountPercent ?? 0;
        const { discountArg: discountArgYm, finalPrice: priceWithDiscount } = buildTariffDiscountArg(totalPrice, pd, discountInfoYm, tariff.currency);
        const payment = await api.createYoomoneyPayment(token, {
          amount: totalPrice,
          paymentType: "AC",
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, {
          name: nameWithDays,
          price: formatMoney(priceWithDiscount, tariff.currency),
          amount: String(priceWithDiscount),
          currency: tariff.currency,
          action: "Нажмите кнопку ниже для оплаты:",
        }, discountArgYm);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_tariff_yookassa:")) {
      const tariffId = data.slice("pay_tariff_yookassa:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (tariff.currency.toUpperCase() !== "RUB") {
        await editMessageContent(ctx, "ЮKassa принимает только рубли (RUB).", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfoYk = activeDiscountCode.get(userId);
        const promoCode = discountInfoYk?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler выше.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meYk = await api.getMe(token);
        const pdYk = meYk?.personalDiscountPercent ?? 0;
        const { discountArg: discountArgYk, finalPrice: priceWithDiscountYk } = buildTariffDiscountArg(totalPrice, pdYk, discountInfoYk, tariff.currency);
        // 54-ФЗ: перед созданием платежа спрашиваем, нужен ли чек.
        const savedEmailYk = (meYk?.email ?? null);
        const tokRcptT = storePendingReceipt({
          userId,
          savedEmail: savedEmailYk,
          builder: (receiptEmail) => api.createYookassaPayment(token, {
            amount: totalPrice,
            currency: "RUB",
            tariffId: tariff.id,
            tariffPriceOptionId: eff?.id,
            deviceCount: extraDevices,
            promoCode,
            asAdditional: asAdditional || undefined,
            extendsSecondarySubId,
            removeExtrasOnActivate,
            replaceTrialSubId,
            receiptEmail,
          }),
          finalize: async (payment, { receiptSentTo }) => {
            if (promoCode) activeDiscountCode.delete(userId);
            selectedTariffOption.delete(userId);
            if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
            if (asAdditional) addsubPending.delete(userId);
            if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
            convDropExtras.delete(userId);
            trialReplaceChoice.delete(userId);
            const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
              ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
              : tariff.name;
            const msg = buildPaymentMessage(config, {
              name: nameWithDays,
              price: formatMoney(priceWithDiscountYk, tariff.currency),
              amount: String(priceWithDiscountYk),
              currency: tariff.currency,
              action: "Нажмите кнопку ниже для оплаты:",
            }, discountArgYk);
            const baseText = msg.text;
            const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
            if (receiptSentTo) {
              await ctx.reply(`${baseText}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
            } else {
              await ctx.reply(baseText, { entities: msg.entities, reply_markup: markup });
            }
          },
        });
        await editMessageContent(ctx, receiptPromptText(savedEmailYk), receiptPromptKeyboard(tokRcptT, savedEmailYk));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_tariff_cryptopay:") || data.startsWith("pay_tariff_stars:")) {
      const tariffId = data.slice(data.indexOf(":") + 1);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfoCp = activeDiscountCode.get(userId);
        const promoCode = discountInfoCp?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meCp = await api.getMe(token);
        const pdCp = meCp?.personalDiscountPercent ?? 0;
        const { discountArg: discountArgCp, finalPrice: priceWithDiscountCp } = buildTariffDiscountArg(totalPrice, pdCp, discountInfoCp, tariff.currency);
        const payment = await (data.startsWith("pay_tariff_stars:") ? api.createStarsPayment : api.createCryptopayPayment)(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, { name: nameWithDays, price: formatMoney(priceWithDiscountCp, tariff.currency), amount: String(priceWithDiscountCp), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты:" }, discountArgCp);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // Lava: оплата тарифа (RUB only, СБП/Карта/СберPay)
    if (data.startsWith("pay_tariff_lava:")) {
      const tariffId = data.slice("pay_tariff_lava:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfo = activeDiscountCode.get(userId);
        const promoCode = discountInfo?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meLava = await api.getMe(token);
        const pdLava = meLava?.personalDiscountPercent ?? 0;
        const { discountArg, finalPrice: priceWithDiscountLava } = buildTariffDiscountArg(totalPrice, pdLava, discountInfo, tariff.currency);
        const payment = await api.createLavaPayment(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, { name: nameWithDays, price: formatMoney(priceWithDiscountLava, tariff.currency), amount: String(priceWithDiscountLava), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты:" }, discountArg);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "Ошибка создания платежа Lava";
        await editMessageContent(ctx, `❌ ${m}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_tariff_lavatop:")) {
      const tariffId = data.slice("pay_tariff_lavatop:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfo = activeDiscountCode.get(userId);
        const promoCode = discountInfo?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meLavatop = await api.getMe(token);
        const pdLavatop = meLavatop?.personalDiscountPercent ?? 0;
        const { discountArg, finalPrice: priceWithDiscountLavatop } = buildTariffDiscountArg(totalPrice, pdLavatop, discountInfo, tariff.currency);
        const payment = await api.createLavatopPayment(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, { name: nameWithDays, price: formatMoney(priceWithDiscountLavatop, tariff.currency), amount: String(priceWithDiscountLavatop), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты:" }, discountArg);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "Ошибка создания платежа Lava.top";
        await editMessageContent(ctx, `❌ ${m}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // Heleket: оплата тарифа (крипто)
    if (data.startsWith("pay_tariff_heleket:")) {
      const tariffId = data.slice("pay_tariff_heleket:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfo = activeDiscountCode.get(userId);
        const promoCode = discountInfo?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meHeleket = await api.getMe(token);
        const pdHeleket = meHeleket?.personalDiscountPercent ?? 0;
        const { discountArg, finalPrice: priceWithDiscountHeleket } = buildTariffDiscountArg(totalPrice, pdHeleket, discountInfo, tariff.currency);
        const payment = await api.createHeleketPayment(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, { name: nameWithDays, price: formatMoney(priceWithDiscountHeleket, tariff.currency), amount: String(priceWithDiscountHeleket), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты:" }, discountArg);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "Ошибка создания платежа Heleket";
        await editMessageContent(ctx, `❌ ${m}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }
if (data.startsWith("pay_tariff_rollypay:")) {
      const tariffId = data.slice("pay_tariff_rollypay:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfo = activeDiscountCode.get(userId);
        const promoCode = discountInfo?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meHeleket = await api.getMe(token);
        const pdHeleket = meHeleket?.personalDiscountPercent ?? 0;
        const { discountArg, finalPrice: priceWithDiscountHeleket } = buildTariffDiscountArg(totalPrice, pdHeleket, discountInfo, tariff.currency);
        const payment = await api.createRollypayPayment(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, { name: nameWithDays, price: formatMoney(priceWithDiscountHeleket, tariff.currency), amount: String(priceWithDiscountHeleket), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты:" }, discountArg);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "Ошибка создания платежа RollyPay";
        await editMessageContent(ctx, `❌ ${m}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }
    if (data.startsWith("pay_tariff_cloudpayments:")) {
      const tariffId = data.slice("pay_tariff_cloudpayments:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfo = activeDiscountCode.get(userId);
        const promoCode = discountInfo?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch {}
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        const meHeleket = await api.getMe(token);
        const pdHeleket = meHeleket?.personalDiscountPercent ?? 0;
        const { discountArg, finalPrice: priceWithDiscountHeleket } = buildTariffDiscountArg(totalPrice, pdHeleket, discountInfo, tariff.currency);
        const payment = await api.createCloudpaymentsPayment(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        await showCloudCheckout(ctx, token, payment, config?.cloudpaymentsBotDirect === true);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "Ошибка создания платежа CloudPayments";
        await editMessageContent(ctx, `❌ ${m}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }
    if (data.startsWith("pay_tariff_paritypay:")) {
      const tariffId = data.slice("pay_tariff_paritypay:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfo = activeDiscountCode.get(userId);
        const promoCode = discountInfo?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meHeleket = await api.getMe(token);
        const pdHeleket = meHeleket?.personalDiscountPercent ?? 0;
        const { discountArg, finalPrice: priceWithDiscountHeleket } = buildTariffDiscountArg(totalPrice, pdHeleket, discountInfo, tariff.currency);
        const payment = await api.createParitypayPayment(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, { name: nameWithDays, price: formatMoney(priceWithDiscountHeleket, tariff.currency), amount: String(priceWithDiscountHeleket), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты:" }, discountArg);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "Ошибка создания платежа ParityPay";
        await editMessageContent(ctx, `❌ ${m}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_option_balance:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      // T7c: consume target подписки (если был выбран). primary = передаём undefined backend'у.
      const target = extraOptionTargetSub.get(userId);
      const targetSubscriptionId = target && target !== "primary" ? target : undefined;

      // рассчитываем pro-rata цену для display.
      let displayPrice = option.price;
      if (option.kind === "devices" && targetSubscriptionId) {
        try {
          const subs = await api.getAllSubscriptions(token);
          const target_sub = subs.items?.find((it) => it.id === targetSubscriptionId);
          const inner = target_sub?.subscription as Record<string, unknown> | null;
          const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
          }
          const coef = Math.max(1, daysLeft / 30);
          displayPrice = Math.floor(option.price * coef);
        } catch { /* ignore */ }
      }
      const me = await api.getMe(token).catch(() => null);
      const pd = me?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      try {
        const result = await api.payOptionByBalance(token, { kind: option.kind, productId: option.id, targetSubscriptionId });
        extraOptionTargetSub.delete(userId);
        extraOptionPending.delete(userId);
        await editMessageContent(ctx, `✅ ${result.message}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_option_yookassa:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const target = extraOptionTargetSub.get(userId);
      const targetSubscriptionId = target && target !== "primary" ? target : undefined;

      // рассчитываем pro-rata цену для display.
      let displayPrice = option.price;
      if (option.kind === "devices" && targetSubscriptionId) {
        try {
          const subs = await api.getAllSubscriptions(token);
          const target_sub = subs.items?.find((it) => it.id === targetSubscriptionId);
          const inner = target_sub?.subscription as Record<string, unknown> | null;
          const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
          }
          const coef = Math.max(1, daysLeft / 30);
          displayPrice = Math.floor(option.price * coef);
        } catch { /* ignore */ }
      }
      const me = await api.getMe(token).catch(() => null);
      const pd = me?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      try {
        // 54-ФЗ-чек prompt.
        const savedEmailOp = me?.email ?? null;
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const tokRcptOp = storePendingReceipt({
          userId,
          savedEmail: savedEmailOp,
          builder: (receiptEmail) => api.createYookassaPayment(token, {
            extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId },
            receiptEmail,
          }),
          finalize: async (payment, { receiptSentTo }) => {
            const msg = buildPaymentMessage(config, {
              name: optName,
              price: formatMoney(displayPrice, option.currency),
              amount: String(displayPrice),
              currency: option.currency,
              action: "Нажмите кнопку ниже для оплаты:",
            });
            const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
            if (receiptSentTo) {
              await ctx.reply(`${msg.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
            } else {
              await ctx.reply(msg.text, { entities: msg.entities, reply_markup: markup });
            }
            extraOptionTargetSub.delete(userId);
          },
        });
        await editMessageContent(ctx, receiptPromptText(savedEmailOp), receiptPromptKeyboard(tokRcptOp, savedEmailOp));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        const isAuthError = /401|unauthorized|истек|авториз|токен/i.test(msg);
        if (isAuthError) {
          tokenStore.delete(userId);
          const freshToken = await getOrRestoreToken(userId, ctx.from?.username);
          if (freshToken) {
            await editMessageContent(ctx, "🔄 Повторите действие.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          } else {
            await editMessageContent(ctx, "❌ Ошибка авторизации. Отправьте /start", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          }
        } else {
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
        }
      }
      return;
    }

    if (data.startsWith("pay_option_cryptopay:") || data.startsWith("pay_option_stars:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const target = extraOptionTargetSub.get(userId);
      const targetSubscriptionId = target && target !== "primary" ? target : undefined;

      // рассчитываем pro-rata цену для display.
      let displayPrice = option.price;
      if (option.kind === "devices" && targetSubscriptionId) {
        try {
          const subs = await api.getAllSubscriptions(token);
          const target_sub = subs.items?.find((it) => it.id === targetSubscriptionId);
          const inner = target_sub?.subscription as Record<string, unknown> | null;
          const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
          }
          const coef = Math.max(1, daysLeft / 30);
          displayPrice = Math.floor(option.price * coef);
        } catch { /* ignore */ }
      }
      const me = await api.getMe(token).catch(() => null);
      const pd = me?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      try {
        const payment = await (data.startsWith("pay_option_stars:") ? api.createStarsPayment : api.createCryptopayPayment)(token, { extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId } });
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const msg = buildPaymentMessage(config, { name: optName, price: formatMoney(displayPrice, option.currency), amount: String(displayPrice), currency: option.currency, action: "Нажмите кнопку ниже для оплаты:" });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        extraOptionTargetSub.delete(userId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        const isAuthError = /401|unauthorized|истек|авториз|токен/i.test(msg);
        if (isAuthError) {
          tokenStore.delete(userId);
          const freshToken = await getOrRestoreToken(userId, ctx.from?.username);
          if (freshToken) {
            await editMessageContent(ctx, "🔄 Повторите действие.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          } else {
            await editMessageContent(ctx, "❌ Ошибка авторизации. Отправьте /start", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          }
        } else {
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
        }
      }
      return;
    }

    if (data.startsWith("pay_option_yoomoney:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const target = extraOptionTargetSub.get(userId);
      const targetSubscriptionId = target && target !== "primary" ? target : undefined;

      // рассчитываем pro-rata цену для display.
      let displayPrice = option.price;
      if (option.kind === "devices" && targetSubscriptionId) {
        try {
          const subs = await api.getAllSubscriptions(token);
          const target_sub = subs.items?.find((it) => it.id === targetSubscriptionId);
          const inner = target_sub?.subscription as Record<string, unknown> | null;
          const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
          }
          const coef = Math.max(1, daysLeft / 30);
          displayPrice = Math.floor(option.price * coef);
        } catch { /* ignore */ }
      }
      const me = await api.getMe(token).catch(() => null);
      const pd = me?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      try {
        const payment = await api.createYoomoneyPayment(token, {
          amount: displayPrice,
          paymentType: "AC",
          extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId },
        });
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const msg = buildPaymentMessage(config, {
          name: optName,
          price: formatMoney(displayPrice, option.currency),
          amount: String(displayPrice),
          currency: option.currency,
          action: "Нажмите кнопку ниже для оплаты:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        extraOptionTargetSub.delete(userId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_option_platega:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 3 ? parts.slice(2, -1).join(":") : parts[2] ?? "";
      const methodId = parts.length >= 4 ? Number(parts[parts.length - 1]) : Number(parts[2]);
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (!Number.isFinite(methodId)) {
        await editMessageContent(ctx, "Неверный способ оплаты.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const target = extraOptionTargetSub.get(userId);
      const targetSubscriptionId = target && target !== "primary" ? target : undefined;

      // рассчитываем pro-rata цену для display.
      let displayPrice = option.price;
      if (option.kind === "devices" && targetSubscriptionId) {
        try {
          const subs = await api.getAllSubscriptions(token);
          const target_sub = subs.items?.find((it) => it.id === targetSubscriptionId);
          const inner = target_sub?.subscription as Record<string, unknown> | null;
          const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
          }
          const coef = Math.max(1, daysLeft / 30);
          displayPrice = Math.floor(option.price * coef);
        } catch { /* ignore */ }
      }
      const me = await api.getMe(token).catch(() => null);
      const pd = me?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      try {
        const payment = await api.createPlategaPayment(token, {
          amount: displayPrice,
          currency: option.currency,
          paymentMethod: methodId,
          description: option.name || `${option.kind} ${option.id}`,
          extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId },
        });
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const msg = buildPaymentMessage(config, {
          name: optName,
          price: formatMoney(displayPrice, option.currency),
          amount: String(displayPrice),
          currency: option.currency,
          action: "Нажмите кнопку ниже для оплаты:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        extraOptionTargetSub.delete(userId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_option:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена. Обновите меню (/start) и попробуйте снова.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (option.currency.toUpperCase() !== "RUB") {
        await editMessageContent(ctx, "Оплата в боте доступна только в рублях (RUB).", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");

      // на экране выбора способа оплаты
      // показываем РЕАЛЬНУЮ цену (с pro-rata + personal discount), а не базовую option.price.
      let displayPrice = option.price;
      if (option.kind === "devices") {
        const target = extraOptionTargetSub.get(userId);
        if (target && target !== "primary") {
          try {
            const subs = await api.getAllSubscriptions(token);
            const targetSub = subs.items?.find((it) => it.id === target);
            const inner = targetSub?.subscription as Record<string, unknown> | null;
            const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
            const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
            let daysLeft = 30;
            if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
              const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
              if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
            }
            const coef = Math.max(1, daysLeft / 30);
            displayPrice = Math.floor(option.price * coef);
          } catch { /* ignore */ }
        }
      }
      const pd = client?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      const choiceText = buildPaymentMessage(config, {
        name: optName,
        price: formatMoney(displayPrice, option.currency),
        amount: String(displayPrice),
        currency: option.currency,
        action: "Выберите способ оплаты:",
      });
      const markup = optionPaymentMethodButtons(
        { ...option, price: displayPrice },
        client?.balance ?? 0,
        config?.botBackLabel ?? null,
        innerStyles,
        innerEmojiIds,
        config?.plategaMethods ?? [],
        !!config?.yoomoneyEnabled,
        !!config?.yookassaEnabled,
        !!config?.cryptopayEnabled
      );
      await editMessageContent(ctx, choiceText.text, markup, choiceText.entities);
      return;
    }

    if (data.startsWith("pay_tariff:")) {
      const rest = data.slice("pay_tariff:".length);
      const parts = rest.split(":");
      const tariffId = parts[0];
      // TEMP DEBUG: log incoming pay_tariff callback (to be removed after diagnosing).
      console.log(`[pay_tariff] user=${userId} data="${data}" parts=${JSON.stringify(parts)} tariffId="${tariffId}"`);
      // (bypass-маркеры из tariffActionChoiceButtons.
      // burn  → юзер выбрал «🔥 Сменить основную (сжечь дни)» — пропускаем диалог,
      //            идём в обычный flow (proration backend'а конвертирует/сжигает дни).
      // add   → юзер выбрал «➕ Купить как доп. подписку» — пропускаем диалог,
      //            ставим addsub-флаг (читается ниже в pay_<provider>: и Platega-ветке)
      //            и идём в обычный flow (длительность/устройства/методы), но платёж
      //            создаётся с asAdditional=true → backend пометит metadata, на webhook'е
      //            activateTariffByPaymentId вызовет createAdditionalSubscription.
      // T7b (11.05.2026):
      // extsec:<secondaryId> → юзер нажал «💰 Продлить» в детали secondary-подписки.
      //            Идём в обычный flow выбора длительности/устройств/оплаты, но в metadata
      //            платежа добавляется extendsSecondarySubId → backend вызывает
      //            extendSecondarySubscription (продлевает существующую, НЕ создаёт новую).
      const isBurnBypass = parts[1] === "burn";
      const isAddBypass = parts[1] === "add";
      if (isAddBypass && config?.multiSubscriptionsEnabled !== true) {
        addsubPending.delete(userId);
        await editMessageContent(ctx, "Покупка дополнительных подписок отключена. Выберите тариф заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const isExtsec = parts[1] === "extsec" && parts.length >= 3;
      const extsecSecondaryId = isExtsec ? parts.slice(2).join(":") : null;
      // r — маркер «продление root» из renew_pick.
      // Поведение идентично обычному pay_tariff: (без add), просто пропускает промежуточный
      // экран «Продлить / Купить новую» (иначе бесконечный цикл при выборе основной подписки).
      const isRenewRoot = parts[1] === "r";
      const isBypass = isBurnBypass || isAddBypass || isExtsec || isRenewRoot;
      const methodIdFromBtn = !isBypass && parts.length >= 2 ? Number(parts[1]) : null;
      // T7b: запоминаем что юзер хочет продлить именно эту secondary.
      // Consume'ся ниже при создании любого payment — параметр extendsSecondarySubId
      // прокинется во все методы (balance/yookassa/yoomoney/cryptopay/heleket/lava/lavatop/platega).
      if (isExtsec && extsecSecondaryId) {
        extendingSecondaryPending.set(userId, { tariffId, secondaryId: extsecSecondaryId });
        // При extsec НЕ ставим addsubPending (это не создание новой, а продление).
      } else if (methodIdFromBtn == null) {
        // если юзер вошёл в pay_tariff БЕЗ маркера extsec
        // (т.е. это новая покупка / выбор тарифа), сбрасываем «висящий» Map от предыдущего
        // нажатия «💰 Продлить». Иначе при следующей оплате прокидывается extendsSecondarySubId
        // → бэк блокирует кулдауном.
        // methodIdFromBtn != null означает что юзер уже на этапе выбора провайдера — Map нужен.
        extendingSecondaryPending.delete(userId);
      }
      // Управление addsub-стейтом:
      //   add → set; burn → clear; naked → clear (fresh choice).
      //   extsec → НЕ трогаем addsub.
      //   methodIdFromBtn != null (Platega-метод) — не трогаем здесь, ниже сами consume'м.
      if (isAddBypass) {
        addsubPending.set(userId, tariffId);
      } else if (isBurnBypass || methodIdFromBtn == null) {
        addsubPending.delete(userId);
      }
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      // single-режим категории: «одна подписка на категорию». В нём НЕ спрашиваем
      // «Продлить / Купить новую» и не показываем кнопку «Продлить» — покупка всегда
      // конвертирует/продлевает существующую подписку (бэк делает это сам), поэтому
      // сразу ведём на экран оплаты, где convNote разложит «подписка будет продлена».
      const isSingleCategory = items?.find((c: TariffCategory) => c.tariffs.some((t) => t.id === tariffId))?.singleSubscriptionMode === true;
      const canOfferNewSubscription = config?.multiSubscriptionsEnabled === true && !isSingleCategory;
      if (methodIdFromBtn == null && !isBypass && config?.multiSubscriptionsEnabled !== true) {
        try {
          const all = await api.getAllSubscriptions(token);
          if (renewableSubscriptions(all.items ?? [], tariff.id).length > 0) {
            await showRenewalChoice(ctx, token, userId, config, innerStyles, innerEmojiIds, tariff.id);
            return;
          }
        } catch {
          await editMessageContent(ctx, "Не удалось проверить подписки. Повторите попытку.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
      }

      // диалог «Покупка тарифа из другой категории» УБРАН.
      // Раньше при клике на тариф другой категории показывался диалог-промежуток. Юзер не хотел
      // лишнего шага → теперь сразу автоматически идём на «купить как новую подписку» (addsubPending),
      // флоу длительности/устройств/оплаты не меняется, на webhook'е создастся параллельная sub.
      if (methodIdFromBtn == null && !isBypass && config?.multiSubscriptionsEnabled === true) {
        try {
          const me = await api.getMe(token);
          const newCategory = items?.find((c) => c.tariffs.some((t) => t.id === tariffId));
          if (me.currentTariff && me.currentTariff.categoryId && newCategory && newCategory.id !== me.currentTariff.categoryId) {
            // Автоматически помечаем как additional — backend пометит metadata.isAdditionalSubscription
            // → активация через createAdditionalSubscription (новая параллельная sub).
            addsubPending.set(userId, tariff.id);
          }
        } catch {
          // Если /me не ответил — не блокируем покупку, fallback в обычный flow.
        }
      }

      const opts = sortedPriceOptions(tariff.priceOptions);
      const existingSelection = selectedTariffOption.get(userId);
      const matchesThisTariff = existingSelection?.tariffId === tariff.id;

      // При первичном входе (без methodId): picker длительности (если опций > 1),
      // потом picker доп. устройств (если включены), потом — методы оплаты.
      if (methodIdFromBtn == null) {
        // T11+T12 (11.05.2026): подставляем `tariff.description` (rich-text админа)
        // между названием и приглашением выбрать длительность.
        // Если description пустой — экран как раньше: только название + «Выберите длительность».
        if (opts.length > 1) {
          // Сначала явно фиксируем намерение: продлить существующую подписку или
          // оформить новую. Без этого много-срочный тариф сразу открывал длительности,
          // и пользователь мог случайно создать параллельную подписку.
          if (!isBypass && canOfferNewSubscription) {
            try {
              const all = await api.getAllSubscriptions(token);
              if (shouldShowPurchaseChoice({
                tariffId: tariff.id,
                subscriptions: all.items ?? [],
                isBypass,
                isSingleCategory,
                multiSubscriptionsEnabled: config?.multiSubscriptionsEnabled === true,
              })) {
                const desc = ((tariff as TariffItem & { description?: string | null }).description ?? "").trim();
                await editMessageContent(ctx, `${desc || tariff.name}\n\nУ вас уже есть подписка с этим тарифом. Что хотите сделать?`, {
                  inline_keyboard: [
                    [{ text: "🔌 Продлить текущую", callback_data: `renew_pick:${tariff.id}` }],
                    [{ text: "🛒 Купить новую", callback_data: `pay_tariff:${tariff.id}:add` }],
                    [{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:tariffs" }],
                  ],
                });
                return;
              }
            } catch {
              await editMessageContent(ctx, "❌ Не удалось проверить ваши подписки. Повторите попытку — покупка не создана.", {
                inline_keyboard: [[{ text: "🔄 Повторить", callback_data: `pay_tariff:${tariff.id}` }], [{ text: "🏠 Главное меню", callback_data: "menu:main" }]],
              });
              return;
            }
          }
          tariffOptionsCache.set(userId, { tariffId: tariff.id, options: opts });
          const bestId = bestPricePerDayOptionId(opts);
          const desc = ((tariff as TariffItem & { description?: string | null }).description ?? "").trim();
          // заголовок тарифа теперь внутри description.
          // Если desc есть — НЕ дублируем `${tariff.name}` сверху.
          const text = desc
            ? `${desc}\n\nВыберите тариф:`
            : `${tariff.name}\n\nВыберите длительность подписки:`;
          await editMessageContent(
            ctx,
            text,
            tariffOptionPickerButtons(
              opts,
              tariff.currency,
              bestId,
              null,
              innerStyles,
              innerEmojiIds,
              null,
              config?.botEmojis ?? null,
            ),
          );
          return;
        }
        const onlyOpt = opts[0] ?? null;
        if (onlyOpt) {
          selectedTariffOption.set(userId, { tariffId: tariff.id, option: onlyOpt, extraDevices: 0 });
          // для тарифа с ОДНОЙ опцией длительности (Unblock и т.п.) —
          // если у клиента уже есть подписка с этим тарифом, показываем промежуточный экран:
          // «🔌 Продлить» / «🛒 Купить новую». Без подписки — сразу к оплате.
          // single-режим: пропускаем выбор «Продлить / Купить новую» —
          // покупка и так конвертирует/продлит существующую подписку, экран оплаты ниже
          // (showPaymentMethodsForTariff) сам покажет пояснение через convNote.
          if (!isBypass && canOfferNewSubscription) {
            try {
              const all = await api.getAllSubscriptions(token);
              const hasMine = (all.items ?? []).some((it) => it.tariffId === tariff.id);
              if (hasMine) {
                const desc = ((tariff as TariffItem & { description?: string | null }).description ?? "").trim();
                const introText = desc ? desc : tariff.name;
                await editMessageContent(ctx, `${introText}\n\nУ вас уже есть подписка с этим тарифом. Что хотите сделать?`, {
                  inline_keyboard: [
                    [{ text: "🔌 Продлить подписку", callback_data: `renew_pick:${tariff.id}` }],
                    [{ text: "🛒 Купить новую", callback_data: `pay_tariff:${tariff.id}:add` }],
                    // «← Назад» к списку тарифов (привязка к bot_emojis.BACK).
                    [{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:tariffs" }],
                  ],
                });
                return;
              }
            } catch {
              await editMessageContent(ctx, "❌ Не удалось проверить ваши подписки. Повторите попытку — покупка не создана.", {
                inline_keyboard: [[{ text: "🔄 Повторить", callback_data: `pay_tariff:${tariff.id}` }], [{ text: "🏠 Главное меню", callback_data: "menu:main" }]],
              });
              return;
            }
          }
          if (hasExtraDevices(tariff)) {
            const tiers = tariff.deviceDiscountTiers;
            const pricePerExtra = tariff.pricePerExtraDevice ?? 0;
            const maxExtras = tariff.maxExtraDevices ?? 0;
            const includedDevices = tariff.includedDevices ?? 1;
            const tiles = Array.from({ length: maxExtras + 1 }, (_, i) => {
              const extras = i;
              const { extrasTotal, pct } = applyExtraDevicesPriceBot(pricePerExtra, extras, tiers, onlyOpt.durationDays);
              return { extras, total: onlyOpt.price + extrasTotal, pct };
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
            const text = `${tariff.name} · ${formatRuDays(onlyOpt.durationDays)}\n\n📱 В тариф включено: ${includedDevices} устр.\nДобавьте дополнительные:`;
            await editMessageContent(ctx, text, tariffDevicePickerButtons(tilesWithBest, tariff.currency, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
            return;
          }
        }
        await showPaymentMethodsForTariff(ctx, userId, tariff, onlyOpt, 0, config, innerStyles, innerEmojiIds, token);
        return;
      }

      // Метод выбран: считаем effectivePrice с учётом extras + создаём Platega-платёж.
      const eff = matchesThisTariff && existingSelection ? existingSelection.option : (opts.length === 1 ? opts[0]! : null);
      const unitPrice = eff?.price ?? tariff.price;
      const effectiveDays = eff?.durationDays ?? tariff.durationDays;
      const extraDevices = matchesThisTariff && existingSelection ? existingSelection.extraDevices : 0;
      const includedDevices = tariff.includedDevices ?? 1;
      // ВАЖНО: передаём effectiveDays — иначе extras считались за 30 дней (дефолт)
      // вместо реальной длительности опции, и на экране Platega цена занижалась
      // (выглядела как «скидка»), хотя бэк списывал верную сумму. Как во всех др. ветках.
      const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
      const effectivePrice = unitPrice + extrasTotal;
      const discountInfoTariff = activeDiscountCode.get(userId);
      const discountArgTariff = discountInfoTariff ? {
        originalPrice: formatMoney(effectivePrice, tariff.currency),
        discountedPrice: formatMoney(getDiscountedPrice(effectivePrice, discountInfoTariff), tariff.currency),
      } : undefined;
      const totalDevices = includedDevices + extraDevices;
      const devicesSuffix = extraDevices > 0 ? ` · ${totalDevices} устр (+${extraDevices} доп.)` : "";
      const nameWithDays = opts.length > 1 || matchesThisTariff
        ? `${tariff.name} · ${formatRuDays(effectiveDays)}${devicesSuffix}`
        : `${tariff.name}${devicesSuffix}`;
      const promoCode = discountInfoTariff?.code;
      // если в addsub-режиме (через :add bypass), помечаем платёж
      // как «купить как доп. подписку» — backend поставит metadata.isAdditionalSubscription
      // и на webhook'е activateTariffByPaymentId создаст secondary вместо main.
      const asAdditionalPlatega = addsubPending.get(userId) === tariff.id;
      // T7b: если в режиме продления конкретной secondary — прокидываем её id.
      const extPairPlatega = extendingSecondaryPending.get(userId);
      const extendsSecondarySubIdPlatega = extPairPlatega && extPairPlatega.tariffId === tariff.id ? extPairPlatega.secondaryId : undefined;
      // юзер выбрал «продлить без устройств».
      // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
      // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
      const removeExtrasOnActivatePlatega = !!(extendsSecondarySubIdPlatega && pendingDropExtras.get(userId) === extendsSecondarySubIdPlatega) || (!extendsSecondarySubIdPlatega && convDropExtras.has(userId));
      const replaceTrialSubIdPlatega = !extendsSecondarySubIdPlatega ? trialReplaceChoice.get(userId) : undefined;
      let subExtrasForPeriodPlatega = 0;
      if (extendsSecondarySubIdPlatega && !removeExtrasOnActivatePlatega) {
        try {
          const allSubs = await api.getAllSubscriptions(token);
          const target = allSubs.items?.find((it) => it.id === extendsSecondarySubIdPlatega);
          const monthly = target?.extraDevicesMonthlyPrice ?? 0;
          if (monthly > 0 && effectiveDays > 0) {
            subExtrasForPeriodPlatega = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
          }
        } catch { /* ignore */ }
      }
      const totalPricePlatega = effectivePrice + subExtrasForPeriodPlatega;
      const payment = await api.createPlategaPayment(token, {
        amount: totalPricePlatega,
        currency: tariff.currency,
        paymentMethod: methodIdFromBtn,
        description: `Тариф: ${tariff.name}`,
        tariffId: tariff.id,
        tariffPriceOptionId: eff?.id,
        deviceCount: extraDevices,
        promoCode,
        asAdditional: asAdditionalPlatega || undefined,
        extendsSecondarySubId: extendsSecondarySubIdPlatega,
        removeExtrasOnActivate: removeExtrasOnActivatePlatega,
        replaceTrialSubId: replaceTrialSubIdPlatega,
      });
      if (promoCode) activeDiscountCode.delete(userId);
      selectedTariffOption.delete(userId);
      if (asAdditionalPlatega) addsubPending.delete(userId);
      if (extendsSecondarySubIdPlatega && removeExtrasOnActivatePlatega) extendingSecondaryPending.delete(userId);
      if (removeExtrasOnActivatePlatega) pendingDropExtras.delete(userId);
      convDropExtras.delete(userId);
      trialReplaceChoice.delete(userId);
      const discountArgTariffUpdated = discountInfoTariff ? {
        originalPrice: formatMoney(totalPricePlatega, tariff.currency),
        discountedPrice: formatMoney(getDiscountedPrice(totalPricePlatega, discountInfoTariff), tariff.currency),
      } : undefined;
      const msg = buildPaymentMessage(config, {
        name: nameWithDays,
        price: formatMoney(totalPricePlatega, tariff.currency),
        amount: String(totalPricePlatega),
        currency: tariff.currency,
        action: "Нажмите кнопку ниже для оплаты:",
      }, discountArgTariffUpdated);
      await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      return;
    }

    if (data === "menu:topup") {
      clearUserState(userId);
      const lang = getUserLang(userId);
      const client = await api.getMe(token);
      if (client?.preferredLang) setUserLang(userId, client.preferredLang);
      const methods = config?.plategaMethods ?? [];
      const yooEnabled = !!config?.yoomoneyEnabled;
      const yookassaEnabledTopup = !!config?.yookassaEnabled;
      if (!methods.length && !yooEnabled && !yookassaEnabledTopup && !config?.telegramStarsEnabled) {
        await editMessageContent(ctx, _t("topup.unavailable", lang), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      // текст редактируется в админке («Тексты бота» → bot_topup_text).
      const topupBody = (config?.botTopupText ?? "").trim() || "Пополнить баланс\n\nВыберите сумму или введите свою (числом):";
      const topupTitle = titleWithEmoji("CARD", topupBody, config?.botEmojis);
      await editMessageContent(ctx, topupTitle.text, topUpPresets(client.preferredCurrency, config?.botBackLabel ?? null, innerStyles, innerEmojiIds), topupTitle.entities);
      return;
    }

    if (data.startsWith("topup_yoomoney:")) {
      const amountStr = data.slice("topup_yoomoney:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createYoomoneyPayment(token, {
          amount,
          paymentType: "AC",
        });
        const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, yooTopup.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), yooTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup_yookassa:")) {
      const amountStr = data.slice("topup_yookassa:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        // 54-ФЗ-чек prompt.
        const savedEmailTp = client?.email ?? null;
        const tokRcptTp = storePendingReceipt({
          userId,
          savedEmail: savedEmailTp,
          builder: (receiptEmail) => api.createYookassaPayment(token, { amount, currency: "RUB", receiptEmail }),
          finalize: async (payment, { receiptSentTo }) => {
            const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
            const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
            if (receiptSentTo) {
              await ctx.reply(`${yooTopup.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
            } else {
              await ctx.reply(yooTopup.text, { entities: yooTopup.entities, reply_markup: markup });
            }
          },
        });
        await editMessageContent(ctx, receiptPromptText(savedEmailTp), receiptPromptKeyboard(tokRcptTp, savedEmailTp));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup_cryptopay:") || data.startsWith("topup_stars:")) {
      const amountStr = data.slice(data.indexOf(":") + 1);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await (data.startsWith("topup_stars:") ? api.createStarsPayment : api.createCryptopayPayment)(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        const cpTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, cpTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), cpTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа Crypto Bot";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup_lava:")) {
      const amountStr = data.slice("topup_lava:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createLavaPayment(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        const lvTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, lvTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), lvTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа Lava";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup_lavatop:")) {
      const amountStr = data.slice("topup_lavatop:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createLavatopPayment(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        const lvTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, lvTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), lvTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа Lava.top";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup_heleket:")) {
      const amountStr = data.slice("topup_heleket:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createHeleketPayment(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        const hkTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, hkTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), hkTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа Heleket";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }
if (data.startsWith("topup_rollypay:")) {
      const amountStr = data.slice("topup_rollypay:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createRollypayPayment(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        const rpTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, rpTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), rpTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа RollyPay";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }
if (data.startsWith("topup_cloudpayments:")) {
      const amountStr = data.slice("topup_cloudpayments:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createCloudpaymentsPayment(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        await showCloudCheckout(ctx, token, payment, config?.cloudpaymentsBotDirect === true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа CloudPayments";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }
if (data.startsWith("topup_paritypay:")) {
      const amountStr = data.slice("topup_paritypay:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createParitypayPayment(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        const rpTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, rpTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), rpTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ParityPay";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup:")) {
      const rest = data.slice("topup:".length);
      // «Ввести свою сумму» — переход в conversation flow.
      // Бот ждёт следующее сообщение от юзера как сумму, затем создаёт payment.
      if (rest === "custom") {
        awaitingCustomTopup.add(userId);
        await editMessageContent(
          ctx,
          "✏️ Введите сумму пополнения числом (например: 250, 750, 1500). Минимум 50 ₽.",
          { inline_keyboard: [[{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:topup" }]] },
        );
        return;
      }
      const parts = rest.split(":");
      const amountStr = parts[0];
      const amount = Number(amountStr);
      const methodIdFromBtn = parts.length >= 2 ? Number(parts[1]) : null;
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      const methods = config?.plategaMethods ?? [];
      if (methodIdFromBtn != null && Number.isFinite(methodIdFromBtn)) {
        const payment = await api.createPlategaPayment(token, {
          amount,
          currency: client.preferredCurrency,
          paymentMethod: methodIdFromBtn,
          description: "Пополнение баланса",
        });
        const topupPay1 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, topupPay1.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), topupPay1.entities);
        return;
      }
      const yooEnabled = !!config?.yoomoneyEnabled;
      const yookassaEnabled = !!config?.yookassaEnabled;
      const cryptopayEnabled = !!config?.cryptopayEnabled;
      const heleketEnabled = !!config?.heleketEnabled;
      const rollypayEnabled = !!config?.rollypayEnabled;
      const paritypayEnabled = !!config?.paritypayEnabled;
      const lavaEnabled = !!config?.lavaEnabled;
      // Если есть >1 способа любого типа — показываем выбор
      const anyOnline = config?.telegramStarsEnabled || yooEnabled || yookassaEnabled || cryptopayEnabled || heleketEnabled || rollypayEnabled || paritypayEnabled || config?.cloudpaymentsEnabled || lavaEnabled;
      if (methods.length > 1 || anyOnline) {
        const topupPay2 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nВыберите способ оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, topupPay2.text, topupPaymentMethodButtons(amountStr, methods, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds, { currency: client.preferredCurrency, yoomoneyEnabled: yooEnabled, yookassaEnabled, cryptopayEnabled, heleketEnabled, rollypayEnabled, paritypayEnabled, cloudpaymentsEnabled: !!config?.cloudpaymentsEnabled, lavaEnabled }), topupPay2.entities);
        return;
      }
      if (methods.length === 0 && !anyOnline) {
        await editMessageContent(ctx, "Пополнение временно недоступно.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      // Если ЮMoney единственный способ (нет platega, нет ЮKassa) — сразу создаём платёж ЮMoney
      if (methods.length === 0 && yooEnabled && !yookassaEnabled) {
        try {
          const payment = await api.createYoomoneyPayment(token, { amount, paymentType: "AC" });
          const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
          await editMessageContent(ctx, yooTopup.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), yooTopup.entities);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
        }
        return;
      }
      // Если только ЮKassa — сразу создаём платёж ЮKassa
      if (methods.length === 0 && yookassaEnabled) {
        try {
          // 54-ФЗ-чек prompt.
          const savedEmailTp2 = client?.email ?? null;
          const tokRcptTp2 = storePendingReceipt({
            userId,
            savedEmail: savedEmailTp2,
            builder: (receiptEmail) => api.createYookassaPayment(token, { amount, currency: "RUB", receiptEmail }),
            finalize: async (payment, { receiptSentTo }) => {
              const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
              const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
              if (receiptSentTo) {
                await ctx.reply(`${yooTopup.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
              } else {
                await ctx.reply(yooTopup.text, { entities: yooTopup.entities, reply_markup: markup });
              }
            },
          });
          await editMessageContent(ctx, receiptPromptText(savedEmailTp2), receiptPromptKeyboard(tokRcptTp2, savedEmailTp2));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
        }
        return;
      }
      const methodId = methods[0]?.id ?? 2;
      const payment = await api.createPlategaPayment(token, {
        amount,
        currency: client.preferredCurrency,
        paymentMethod: methodId,
        description: "Пополнение баланса",
      });
      const topupPay3 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
      await editMessageContent(ctx, topupPay3.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), topupPay3.entities);
      return;
    }

    if (data === "menu:cloudtrial") {
      if (!config?.cloudpaymentsEnabled || !config.cloudpaymentsTrialTariffId || !config.cloudpaymentsTrialDays) return;
      try {
        const payment = await api.createCloudpaymentsPayment(token, { tariffId: config.cloudpaymentsTrialTariffId, paidTrial: true });
        await showCloudCheckout(ctx, token, payment, config?.cloudpaymentsBotDirect === true);
      } catch (e) { await editMessageContent(ctx, e instanceof Error ? e.message : "Не удалось создать счёт", backToMenu()); }
      return;
    }
    if (data === "menu:trial") {
      try {
        const { items, hasAnyEnabled } = await api.getAvailableTrials(token);
        if (!hasAnyEnabled && config?.trialEnabled) {
          const current = await api.getMe(token);
          if (!current.trialUsed) {
            await editMessageContent(ctx, (config.botTrialText ?? "").trim() || "Активировать бесплатный пробный доступ?", { inline_keyboard: [[{ text: "Активировать пробный доступ", callback_data: "trial:confirm" }], [{ text: config.botBackLabel || "В меню", callback_data: "menu:main" }]] });
            return;
          }
        }
        if (items.length === 0) {
          // текст редактируется в админке («Тексты бота» → bot_trial_used_text).
          await editMessageContent(
            ctx,
            (config?.botTrialUsedText ?? "").trim() || "🎁 Пробные подписки\n\nВсе доступные пробные подписки уже использованы.",
            backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds),
          );
          return;
        }
        // убрана авто-активация при 1 триале —
        // юзер всегда явно выбирает триал кнопкой (даже если он один).
        // Старая логика if (items.length === 1) → activateTrialById удалена.
        if (false as boolean) {
          return;
        }
        // 2+ триалов → выбор.
        // новый текст по эталону клиента — заголовок + описание
        // каждого триала из поля description в БД (rich-text), вместо короткой строки «• N дн. (Тариф)».
        // заголовок редактируется в админке («Тексты бота» → bot_trial_text).
        const trialHeader = (config?.botTrialText ?? "").trim() || "🎁 Получить пробную подписку\n\n📱 Выберите тип подписки";
        const lines: string[] = [trialHeader, ""];
        for (const t of items) {
          const desc = (t.description ?? "").trim();
          if (desc) {
            lines.push(desc);
          } else {
            // Fallback на старый формат, если description не заполнен.
            const tariffStr = t.tariffName ? ` (${t.tariffName})` : "";
            lines.push(`• ${t.name} — ${t.durationDays} дн.${tariffStr}`);
          }
          lines.push("");
        }
        lines.push("Выберите тип подписки:");
        const rows: { text: string; callback_data: string }[][] = items.map((t) => [
          { text: `${t.name} — ${(t.price ?? 0) > 0 ? `${t.price} ₽` : "бесплатно"}`.slice(0, 64), callback_data: `trial:activate:${t.id}` },
        ]);
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        await editMessageContent(ctx, lines.join("\n"), { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки триалов";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("trial:activate:") || data.startsWith("trial:buy:")) {
      const buying = data.startsWith("trial:buy:");
      const raw = data.slice(buying ? "trial:buy:".length : "trial:activate:".length);
      const [trialId, amountRaw] = raw.split(":");
      try {
        const available = await api.getAvailableTrials(token);
        const trial = available.items.find(item => item.id === trialId);
        if (!trial) throw new Error("Триал уже использован или недоступен");
        if ((trial.price ?? 0) > 0 && !buying) {
          await editMessageContent(ctx, `Пробная подписка «${trial.name}» на ${trial.durationDays} дн.\nЦена: ${trial.price} ₽. Сумма спишется с баланса.`, { inline_keyboard: [
            [{ text: `Купить за ${trial.price} ₽`, callback_data: `trial:buy:${trialId}:${trial.price}` }],
            [{ text: "Пополнить баланс", callback_data: "menu:topup" }],
            [{ text: "Назад", callback_data: "menu:trial" }],
          ] });
          return;
        }
        const result = await api.activateTrialById(token, trialId, buying ? Number(amountRaw) : 0);
        // новый UX после активации триала по запросу клиента.
        // Кнопки: 📲 Инструкции по установке (URL) / 🌐 Локации / 📋 Мои подписки / 🏠 Главное меню.
        // Текст: «✅ Пробная подписка ... активирована.\n\n🔗 Ссылка подписки: ...\n\nДля подключения нажмите «📲 Подключиться»».
        type Row = ({ text: string; callback_data: string } | { text: string; url: string })[];
        const rows: Row[] = [];
        if (result.subscriptionUrl && result.subscriptionUrl.trim()) {
          rows.push([{ text: "📲 Инструкции по установке", url: result.subscriptionUrl.trim() }]);
        }
        if (result.tariffHasLocations && result.tariffId) {
          rows.push([{ text: "🌐 Локации", callback_data: `menu:locations:${result.tariffId}` }]);
        }
        rows.push([{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }]);
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        // подсказка «если инструкция не открылась».
        const fallback = instructionFallbackText(config);
        const linkBlock = result.subscriptionUrl && result.subscriptionUrl.trim()
          ? `\n\n🔗 Ссылка подписки:\n${result.subscriptionUrl.trim()}\n\nДля подключения нажмите кнопку «📲 Инструкции по установке»:\n\n${fallback}`
          : "";
        await editMessageContent(
          ctx,
          `✅ ${result.message}${linkBlock}`,
          { inline_keyboard: rows },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка активации";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "trial:confirm") {
      try {
        const result = await api.activateTrial(token);
        // после активации запрашиваем /subscription/all,
        // берём URL первой активной подписки клиента — рендерим тот же красивый UX
        // что после нового trial:activate (📲 Инструкции / 🔗 Ссылка подписки / Подключиться).
        let subscriptionUrl: string | null = null;
        try {
          const all = await api.getAllSubscriptions(token);
          const first = (all.items ?? []).find((it) => it.remnawaveUuid && it.subscription);
          if (first) {
            const sub = first.subscription as { subscriptionUrl?: string; response?: { subscriptionUrl?: string }; data?: { subscriptionUrl?: string } } | null;
            subscriptionUrl = sub?.subscriptionUrl ?? sub?.response?.subscriptionUrl ?? sub?.data?.subscriptionUrl ?? null;
          }
        } catch { /* ignore */ }

        type Row = ({ text: string; callback_data: string } | { text: string; url: string })[];
        const rows: Row[] = [];
        if (subscriptionUrl) rows.push([{ text: "📲 Инструкции по установке", url: subscriptionUrl }]);
        rows.push([{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }]);
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        const fallbackLegacy = instructionFallbackText(config);
        const linkBlock = subscriptionUrl
          ? `\n\n🔗 Ссылка подписки:\n${subscriptionUrl}\n\nДля подключения нажмите кнопку «📲 Инструкции по установке»:\n\n${fallbackLegacy}`
          : "";
        await editMessageContent(ctx, `✅ ${result.message}${linkBlock}`, { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка активации";
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

export function createPaymentEmailHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

  composer.on("message:text", async (ctx, next) => {
    const userId = textInputUserId(ctx);
    if (!userId) return;
    if (!hasPendingEmailInput(userId)) return next();

  if (hasPendingEmailInput(userId)) {
    const raw = ctx.message.text?.trim() ?? "";
    if (!isValidEmail(raw)) {
      await ctx.reply("⚠️ Это не похоже на email. Введите валидный адрес (например, example@mail.com), или нажмите /start для отмены.");
      return;
    }
    const tok = takePendingEmailInput(userId)!;
    const p = takePendingReceipt(tok);
    if (!p) {
      await ctx.reply("⏰ Сессия истекла. Откройте «Оплатить» ещё раз.");
      return;
    }
    try {
      const payment = await p.builder(raw);
      await p.finalize(payment, { receiptSentTo: raw });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
      await ctx.reply(`❌ ${msg}`);
    }
    return;
  }

    return next();
  });

  return composer;
}

export function createPaymentCustomTopupHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

  composer.on("message:text", async (ctx, next) => {
    const userId = textInputUserId(ctx);
    if (!userId) return;
    if (!awaitingCustomTopup.has(userId)) return next();

    const token = await getOrRestoreToken(userId, ctx.from?.username);
    if (!token) return;
    const publicConfig = await api.getPublicConfig().catch(() => null);
    if (await enforceSubscription(ctx, publicConfig)) return;

    const raw = ctx.message.text.trim().replace(/[,\s]/g, ".").replace(/[^\d.]/g, "");
    const amount = parseFloat(raw);
    awaitingCustomTopup.delete(userId);
    if (!Number.isFinite(amount) || amount < 50) {
      await ctx.reply("❌ Минимальная сумма — 50 ₽. Попробуйте снова через «💳 Пополнить баланс».", { reply_markup: { inline_keyboard: [[{ text: "💳 Пополнить баланс", callback_data: "menu:topup" }]] } });
      return;
    }
    // Эмулируем callback topup:<amount> чтобы отрисовался стандартный пикер методов.
    const client = await api.getMe(token);
    const cfgT = await api.getPublicConfig().catch(() => null);
    const topupTitle = titleWithEmoji("CARD", `Пополнить баланс на ${formatMoney(amount, client.preferredCurrency)}\n\nВыберите способ оплаты:`, cfgT?.botEmojis);
    await ctx.reply(topupTitle.text, {
      entities: topupTitle.entities?.length ? topupTitle.entities : undefined,
      reply_markup: topupPaymentMethodButtons(
        String(amount),
        cfgT?.plategaMethods ?? [],
        cfgT?.botBackLabel ?? null,
        undefined,
        undefined,
        {
          currency: client.preferredCurrency,
          yoomoneyEnabled: !!cfgT?.yoomoneyEnabled,
          yookassaEnabled: !!cfgT?.yookassaEnabled,
          cryptopayEnabled: !!cfgT?.cryptopayEnabled,
          heleketEnabled: !!cfgT?.heleketEnabled,
          rollypayEnabled: !!cfgT?.rollypayEnabled,
          paritypayEnabled: !!cfgT?.paritypayEnabled,
          cloudpaymentsEnabled: !!cfgT?.cloudpaymentsEnabled,
          lavaEnabled: !!cfgT?.lavaEnabled,
        },
      ),
    });
    return;

    return next();
  });

  return composer;
}

export function createPaymentNumericHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

  composer.on("message:text", async (ctx, next) => {
    const userId = textInputUserId(ctx);
    if (!userId) return;

    const token = await getOrRestoreToken(userId, ctx.from?.username);
    if (!token) return;
    const publicConfig = await api.getPublicConfig().catch(() => null);
    if (await enforceSubscription(ctx, publicConfig)) return;

  const num = Number(ctx.message.text.replace(/,/, "."));
  if (!Number.isFinite(num) || num < 1 || num > 1000000) {
    // Юзер прислал произвольный текст, который не команда / не активный ввод / не сумма пополнения.
    // Если включён auto-delete — удаляем чтобы чат оставался чистым.
    await tryAutoDeleteUnknown(ctx);
    return;
  }

  try {
    const config = publicConfig ?? await api.getPublicConfig();
    const methods = config?.plategaMethods ?? [];
    const yooEnabled = !!config?.yoomoneyEnabled;
    const yookassaEnabledMsg = !!config?.yookassaEnabled;
    const cryptopayEnabledMsg = !!config?.cryptopayEnabled;
    const heleketEnabledMsg = !!config?.heleketEnabled;
    const rollypayEnabledMsg = !!config?.rollypayEnabled;
    const paritypayEnabledMsg = !!config?.paritypayEnabled;
    const lavaEnabledMsg = !!config?.lavaEnabled;
    if (!methods.length && !yooEnabled && !yookassaEnabledMsg && !cryptopayEnabledMsg && !heleketEnabledMsg && !rollypayEnabledMsg && !paritypayEnabledMsg && !config?.cloudpaymentsEnabled && !lavaEnabledMsg && !config?.telegramStarsEnabled) {
      await ctx.reply("Пополнение временно недоступно.");
      return;
    }
    const client = await api.getMe(token);
    const rawStyles = config?.botInnerButtonStyles;
    const backStyle = rawStyles?.back !== undefined ? rawStyles.back : "danger";
    const botEmojis = config?.botEmojis;
    const msgEmojiIds: InnerEmojiIds | undefined = botEmojis
      ? {
          back: botEmojis.BACK?.tgEmojiId,
          card: botEmojis.CARD?.tgEmojiId,
          tariff: botEmojis.PACKAGE?.tgEmojiId || botEmojis.TARIFFS?.tgEmojiId,
          trial: botEmojis.TRIAL?.tgEmojiId,
          profile: botEmojis.PROFILE?.tgEmojiId || botEmojis.PUZZLE?.tgEmojiId,
          connect: botEmojis.SERVERS?.tgEmojiId || botEmojis.CONNECT?.tgEmojiId,
        }
      : undefined;
    const enabledOnlineMsg = [config?.telegramStarsEnabled, yooEnabled, yookassaEnabledMsg, cryptopayEnabledMsg, heleketEnabledMsg, rollypayEnabledMsg, paritypayEnabledMsg, lavaEnabledMsg].filter(Boolean).length;
    const anyOnlineMsg = enabledOnlineMsg > 0;
    if (methods.length > 1 || anyOnlineMsg) {
      const topupMsg1 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(num, client.preferredCurrency)}\n\nВыберите способ оплаты:`, config?.botEmojis);
      await ctx.reply(topupMsg1.text, {
        entities: topupMsg1.entities.length ? topupMsg1.entities : undefined,
        reply_markup: topupPaymentMethodButtons(String(num), methods, config?.botBackLabel ?? null, backStyle, msgEmojiIds, { currency: client.preferredCurrency, yoomoneyEnabled: yooEnabled, yookassaEnabled: yookassaEnabledMsg, cryptopayEnabled: cryptopayEnabledMsg, heleketEnabled: heleketEnabledMsg, rollypayEnabled: rollypayEnabledMsg, paritypayEnabled: paritypayEnabledMsg, cloudpaymentsEnabled: !!config?.cloudpaymentsEnabled, lavaEnabled: lavaEnabledMsg }),
      });
      return;
    }
    // Если только ЮMoney (нет platega, нет ЮKassa) — сразу создаём
    if (methods.length === 0 && yooEnabled) {
      const payment = await api.createYoomoneyPayment(token, { amount: num, paymentType: "AC" });
      const topupMsgYoo = titleWithEmoji("CARD", `Пополнение на ${formatMoney(num, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
      await ctx.reply(topupMsgYoo.text, {
        entities: topupMsgYoo.entities.length ? topupMsgYoo.entities : undefined,
        reply_markup: payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, backStyle, msgEmojiIds),
      });
      return;
    }
    // Если только ЮKassa
    if (methods.length === 0 && yookassaEnabledMsg) {
      const payment = await api.createYookassaPayment(token, { amount: num, currency: "RUB" });
      const topupMsgYoo = titleWithEmoji("CARD", `Пополнение на ${formatMoney(num, "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
      await ctx.reply(topupMsgYoo.text, {
        entities: topupMsgYoo.entities.length ? topupMsgYoo.entities : undefined,
        reply_markup: payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, backStyle, msgEmojiIds),
      });
      return;
    }
    // Если только Crypto Pay
    if (methods.length === 0 && cryptopayEnabledMsg) {
      const payment = await api.createCryptopayPayment(token, { amount: num, currency: client.preferredCurrency });
      const topupMsgCp = titleWithEmoji("CARD", `Пополнение на ${formatMoney(num, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
      await ctx.reply(topupMsgCp.text, {
        entities: topupMsgCp.entities.length ? topupMsgCp.entities : undefined,
        reply_markup: payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, backStyle, msgEmojiIds),
      });
      return;
    }
    const payment = await api.createPlategaPayment(token, {
      amount: num,
      currency: client.preferredCurrency,
      paymentMethod: methods[0].id,
      description: "Пополнение баланса",
    });
    const topupMsg2 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(num, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
    await ctx.reply(topupMsg2.text, {
      entities: topupMsg2.entities.length ? topupMsg2.entities : undefined,
      reply_markup: payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, backStyle, msgEmojiIds),
    });
  } catch {
    // не число или ошибка — игнорируем
  }

    return next();
  });

  return composer;
}
