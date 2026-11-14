import { Composer } from "grammy";
import { InputFile } from "grammy";
import type { Context } from "grammy";
import * as api from "../api.js";
import { addsubPending, extendingSecondaryPending, pendingDropExtras, selectedTariffOption, tariffOptionsCache, trialConvertPickCache } from "../state-store.js";
import { _t, applyMarkdownAndEmoji, backButton, backToMenu, backToSubLabel, backToSubsListLabel, bestPricePerDayOptionId, blockUnsubscribedCallback, bytesToGb, callbackUi, connectableSubscriptions, deviceFlow, deviceFlowButtons, editMessageContent, formatDaysRu, formatDeviceCount, formatRuDays, getMenuEmojiKey, getOrRestoreToken, getSubscriptionUrl, getUserLang, instructionFallbackText, isCabinetGrouped, mySubsListButtons, navRowWithProfileBack, parseSubInfo, renewableSubscriptions, sectionBackToMenu, setTranslations, showPaymentMethodsForTariff, sortedPriceOptions, subDetailButtons, subscriptionDeviceLimit, t, tariffErrMarkup, tariffOptionPickerButtons, titleWithOptionalEmoji } from "./shared.js";
import type { ConfigSnapshot, InnerButtonStyles, InnerEmojiIds, TariffCategory, TariffItem } from "./shared.js";
import { resolveCallbackDomain } from "./routing.js";

export async function startSubscriptionRenewal(ctx: Context, token: string, userId: number, config: ConfigSnapshot | null, innerStyles: InnerButtonStyles | undefined, innerEmojiIds: InnerEmojiIds | undefined, sid: string): Promise<void> {
  try {
    await api.verifyTelegramSubscriptions(userId, ctx.from?.username);
    const subs = await api.getAllSubscriptions(token);
    // Раньше: фильтр type === "secondary". Теперь — любая подписка с этим id (root тоже).
    const sec = subs.items?.find((it) => it.id === sid);
    if (!sec || renewableSubscriptions([sec]).length === 0) {
      await editMessageContent(ctx, "❌ Подписка или тариф не найдены.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      return;
    }
    // pre-check кулдауна ДО показа экрана выбора провайдера.
    // Если подписка в кулдауне — сразу выводим сообщение и кнопку «Назад».
    try {
      const cd = await api.checkSubscriptionCooldown(token, sid);
      if (cd.blocked) {
        // сообщение уже содержит свой эмодзи ⏳ — не дублируем 🚫.
        await editMessageContent(ctx, cd.message, {
          inline_keyboard: [
            [{ text: backButton(config?.botEmojis ?? null).text, callback_data: `sub:detail:${sec.type}:${sid}` }],
            [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
          ],
        });
        return;
      }
    } catch { /* ignore — пропустим check если эндпоинт упал */ }

    // конвертация триала: запрещена тогглом → отказ; разрешена
    // в любой тариф (convertAllTariffs) или в список convertTariffIds — даём
    // выбрать, на какой тариф переходить (дни и остаток трафика сохранятся).
    if (sec.trialId && sec.trialConvertEnabled === false) {
      await editMessageContent(ctx, "Этот пробный период нельзя конвертировать или продлить.", {
        inline_keyboard: [[{ text: "← Назад", callback_data: `sub:detail:${sec.type}:${sid}` }]],
      });
      return;
    }
    const trialConvertIds = (sec.convertTariffIds ?? []).filter((id) => id && id !== sec.tariffId);
    if (sec.trialId && (sec.trialConvertAllTariffs === true || trialConvertIds.length > 0)) {
      const { items: catItems } = await api.getPublicTariffs();
      const allTariffs = catItems?.flatMap((c: TariffCategory) => c.tariffs) ?? [];
      const own = allTariffs.find((t: TariffItem) => t.id === sec.tariffId);
      const targets = sec.trialConvertAllTariffs === true
        ? allTariffs.filter((t: TariffItem) => t.id !== sec.tariffId)
        : trialConvertIds
            .map((id) => allTariffs.find((t: TariffItem) => t.id === id))
            .filter((t): t is TariffItem => Boolean(t));
      if (targets.length > 0) {
        const options = [
          ...(own ? [{ id: own.id, name: own.name }] : []),
          ...targets.map((t) => ({ id: t.id, name: t.name })),
        ];
        trialConvertPickCache.set(userId, { sid, options });
        const rows = options.map((o, i) => ([{
          text: own && i === 0 ? `💎 ${o.name}` : `➡️ ${o.name}`,
          callback_data: `pay_ext_pickt:${i}`,
        }]));
        rows.push([{ text: "← Назад", callback_data: `sub:detail:${sec.type}:${sid}` }]);
        await editMessageContent(
          ctx,
          "🔄 Переход на платный тариф\n\nВыберите тариф — дни и остаток трафика пробного периода сохранятся:",
          { inline_keyboard: rows },
        );
        return;
      }
    }

    if (!sec.tariffId && !sec.trialId && sec.remnawaveUuid) {
      const { items } = await api.getPublicTariffs();
      const options = (items ?? []).flatMap(category => category.tariffs).map(tariff => ({ id: tariff.id, name: tariff.name }));
      if (!options.length) {
        await editMessageContent(ctx, "Тарифы для продления пока не настроены. Обратитесь в поддержку.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      trialConvertPickCache.set(userId, { sid, options });
      addsubPending.delete(userId);
      await editMessageContent(ctx, "Найдена существующая подписка. Выберите тариф для её продления — ссылка для подключения сохранится.", {
        inline_keyboard: [...options.map((option, i) => [{ text: option.name, callback_data: `pay_ext_pickt:${i}` }]),
          [{ text: "Назад", callback_data: "menu:tariffs" }]],
      });
      return;
    }

    const { items } = await api.getPublicTariffs();
    const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === sec.tariffId);
    if (!tariff) {
      await editMessageContent(ctx, "❌ Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      return;
    }
    // Помечаем что эта оплата — продление именно этой secondary.
    extendingSecondaryPending.set(userId, { tariffId: tariff.id, secondaryId: sid });
    // Сбрасываем addsub-флаг (если был от прошлой сессии) — это не создание новой.
    addsubPending.delete(userId);

    const opts = sortedPriceOptions(tariff.priceOptions);
    const desc = ((tariff as TariffItem & { description?: string | null }).description ?? "").trim();
    // Если опций > 1 — picker длительности.
    if (opts.length > 1) {
      tariffOptionsCache.set(userId, { tariffId: tariff.id, options: opts });
      const bestId = bestPricePerDayOptionId(opts);
      // T-fix (11.05.2026): не дублируем `${tariff.name}` если desc уже содержит заголовок.
      const text = desc
        ? `🔄 Продление подписки\n\n${desc}\n\nВыберите тариф для продления:`
        : `🔄 Продление подписки\n\n${tariff.name}\n\nВыберите длительность:`;
      await editMessageContent(ctx, text, tariffOptionPickerButtons(opts, tariff.currency, bestId, null, innerStyles, innerEmojiIds, null, config?.botEmojis ?? null));
      return;
    }
    // Одна опция — сразу к оплате (без picker'а доп. устройств для простоты продления).
    const onlyOpt = opts[0] ?? null;
    if (onlyOpt) {
      selectedTariffOption.set(userId, { tariffId: tariff.id, option: onlyOpt, extraDevices: 0 });
    }
    // если у подписки есть extraDevices —
    // показываем промежуточный экран ВСЕГДА (даже когда у тарифа одна опция длительности).
    // Бывшее поведение «сразу к оплате» проглатывало кнопку «Убрать устройства».
    if (onlyOpt) {
      try {
        const allSubs = await api.getAllSubscriptions(token);
        const targetSub = allSubs.items?.find((it) => it.id === sid);
        const extraDevices = targetSub?.extraDevices ?? 0;
        const monthlyPrice = targetSub?.extraDevicesMonthlyPrice ?? 0;
        if (extraDevices > 0 && monthlyPrice > 0) {
          // Копия логики промежуточного экрана из `topt:` handler.
          const extrasForPeriod = Math.floor(monthlyPrice * (onlyOpt.durationDays / 30));
          const totalWith = onlyOpt.price + extrasForPeriod;
          const coef = onlyOpt.durationDays / 30;
          const coefStr = onlyOpt.durationDays % 30 === 0 ? `${coef}` : coef.toFixed(1);
          const lines = [
            "🔄 Продление подписки",
            "",
            `📦 Тариф: ${tariff.name}`,
            `⏰ Длительность: ${formatRuDays(onlyOpt.durationDays)}`,
            `💰 Базовая цена тарифа: ${onlyOpt.price} ₽`,
            "",
            `📱 На этой подписке у вас докуплено: ${extraDevices} ${(() => { const n = extraDevices % 100; const n1 = n % 10; if (n > 10 && n < 20) return "доп. устройств"; if (n1 > 1 && n1 < 5) return "доп. устройства"; if (n1 === 1) return "доп. устройство"; return "доп. устройств"; })()}`,
            `💵 Цена устройств: ${monthlyPrice} ₽ за 30 дней × ${coefStr} = ${extrasForPeriod} ₽`,
            "",
            `━━━━━━━━━━━━━━`,
            `💵 Итого со всеми устройствами: ${totalWith} ₽`,
            `💵 Без доп. устройств: ${onlyOpt.price} ₽`,
            "",
            `💡 По умолчанию в подписку входит ${tariff.includedDevices ?? 4} устройства, но у вас куплены дополнительные устройства.`,
          "⚠️ Если продлить подписку без доп. устройств и при этом продолжить использовать прежнее количество устройств, сервис может перестать работать на некоторых из них.",
          ];
          await editMessageContent(ctx, lines.join("\n"), {
            inline_keyboard: [
              [{ text: `✅ Со всеми устройствами (${totalWith} ₽)`, callback_data: `pay_ext_keep:0` }],
              [{ text: `🗑 Убрать устройства, продлить за ${onlyOpt.price} ₽`, callback_data: `pay_ext_drop:0` }],
              [{ text: "← Назад", callback_data: `sub:detail:${targetSub?.type ?? "secondary"}:${sid}` }],
            ],
          });
          // Кэшируем option для последующих pay_ext_keep/drop:0
          tariffOptionsCache.set(userId, { tariffId: tariff.id, options: [onlyOpt] });
          return;
        }
      } catch (e) {
        console.warn("[pay_tariff_ext] intermediate screen failed:", e);
      }
    }
    await showPaymentMethodsForTariff(ctx, userId, tariff, onlyOpt, 0, config, innerStyles, innerEmojiIds, token);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка загрузки";
    await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
  }
}

export async function showRenewalChoice(ctx: Context, token: string, userId: number, config: ConfigSnapshot | null, innerStyles: InnerButtonStyles | undefined, innerEmojiIds: InnerEmojiIds | undefined, tariffId?: string): Promise<void> {
  try {
    await api.verifyTelegramSubscriptions(userId, ctx.from?.username);
    const all = await api.getAllSubscriptions(token);
    const matching = renewableSubscriptions(all.items ?? [], tariffId);
    if (matching.length === 0) {
      await editMessageContent(ctx, "У вас нет подписок, доступных для продления.", {
        inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "menu:main" }]],
      });
      return;
    }
    if (matching.length === 1) {
      await startSubscriptionRenewal(ctx, token, userId, config, innerStyles, innerEmojiIds, matching[0].id);
      return;
    }
    // сортируем по subscriptionIndex —
    // primary (idx=0) идёт первой автоматически. Тип больше не нужен для роутинга.
    const sorted = [...matching].sort((a, b) => (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0));

    // batch-проверка кулдауна для всех подписок этого тарифа.
    // Заблокированные → бейдж 🚫 в кнопке. При клике handler `pay_tariff_ext` сам покажет сообщение.
    const blockedSet = new Set<string>();
    try {
      const cdBatch = await api.checkSubscriptionsCooldownBatch(token, sorted.map((s) => s.id));
      for (const it of (cdBatch.items ?? [])) {
        if (it.blocked) blockedSet.add(it.subscriptionId);
      }
    } catch { /* ignore — без бейджей */ }

    const bodyLines: string[] = ["🔌 Выберите подписку для продления:", ""];
    const rows: { text: string; callback_data: string }[][] = [];
    for (const s of sorted) {
      const info = parseSubInfo(s);
      const idx = s.subscriptionIndex ?? 0;
      // primary slot = «Главная», остальные = «#N»
      const typeText = idx === 0 ? "🌟 Главная" : `Подписка #${idx}`;
      const isBlocked = blockedSet.has(s.id);
      const blockedPrefix = isBlocked ? "🚫 " : "";
      bodyLines.push(`${blockedPrefix}${info.statusEmojiSmall} ${typeText} · ${s.tariffDisplayName} — ${info.daysStr} до ${info.dateStr}${info.trafficSuffix}`);
      // ВСЕ подписки идут через pay_tariff_ext:<id> — единый flow продления.
      // Заблокированные тоже ведут в pay_tariff_ext — там pre-check покажет сообщение.
      const callback = `pay_tariff_ext:${s.id}`;
      const btnLabel = `${blockedPrefix}${idx === 0 ? "🌟 Главная" : "#" + idx} · ${s.tariffDisplayName} · ${info.daysStr}`;
      rows.push([{ text: btnLabel.slice(0, 60), callback_data: callback.slice(0, 64) }]);
    }
    { const bk = backButton(config?.botEmojis ?? null); rows.push([{ text: bk.text, callback_data: tariffId ? "menu:tariffs" : "menu:main" }]); }
    await editMessageContent(ctx, bodyLines.join("\n"), { inline_keyboard: rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
  }
}

export function createSubscriptionHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

composer.command("subscriptions", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const token = await getOrRestoreToken(userId, ctx.from?.username);
  if (!token) {
    await ctx.reply("🔐 Сначала запустите бота через /start");
    return;
  }
  try {
    const result = await api.getAllSubscriptions(token);
    const cfg = await api.getPublicConfig().catch(() => null);
    if (!result.items?.length) {
      await ctx.reply("📋 Мои подписки\n\nУ вас пока нет активных подписок.", {
        reply_markup: { inline_keyboard: [navRowWithProfileBack([{ text: "🏠 Главное меню", callback_data: "menu:main" }], "my_subs", cfg)] },
      });
      return;
    }
    const sorted = [...result.items].sort((a, b) => {
      if (a.type !== b.type) return a.type === "root" ? -1 : 1;
      return (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0);
    });
    const bodyLines = [`📋 Мои подписки (**${sorted.length}**)`, ""];
    const buttonItems = sorted.map((it) => {
      const info = parseSubInfo(it);
      const trialBodyMark = it.trialId ? " 🎁" : "";
      // без названия тарифа в текстовой строке —
      // для истёкших «❌ истекла», для активных «N дн. до DD.MM.YYYY [+трафик]».
      if (info.isExpired) {
        bodyLines.push(`${info.typeEmoji} #${info.idx}${trialBodyMark} — ❌ истекла`);
      } else {
        bodyLines.push(`${info.typeEmoji} #${info.idx}${trialBodyMark} — **${info.daysStr}** до ${info.dateStr}${info.trafficSuffix}`);
      }
      // В кнопке: «✅/❌ #N <tariff> (N дн./истекла)». tariffDisplayName уже с эмодзи.
      const tariff = (it.tariffDisplayName || "—").slice(0, 38);
      const trialBtnMark = it.trialId ? " 🎁" : "";
      const lifetimeStr = info.isExpired ? "истекла" : info.daysStr;
      const label = `${info.statusEmojiSmall} #${info.idx} ${tariff} (${lifetimeStr})${trialBtnMark}`;
      return { type: it.type, id: it.id, label };
    });
    const { text, entities } = applyMarkdownAndEmoji(bodyLines.join("\n"), cfg?.botEmojis ?? null);
    await ctx.reply(text, {
      entities: entities?.length ? entities : undefined,
      reply_markup: mySubsListButtons(buttonItems, cfg?.botBackLabel ?? null, undefined, undefined),
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
    if (resolveCallbackDomain(data) !== "subscriptions") return next();
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

    if (data.startsWith("singbox:conf:")) {
      const slotId = data.slice("singbox:conf:".length);
      const { slots } = await api.getSingboxSlots(token);
      const slot = slots.find(s => s.id === slotId && ["AMNEZIAWG", "AWP_AWG", "AWP_WIREGUARD"].includes(s.protocol));
      if (!slot) {
        await ctx.reply("Доступ не найден или истёк.");
        return;
      }
      await ctx.replyWithDocument(new InputFile(Buffer.from(slot.subscriptionLink), `amnezia-${slot.id.slice(-8)}.conf`), { caption: "Импортируйте файл в AmneziaVPN. Конфигурация содержит ваш приватный ключ — не передавайте её другим." });
      return;
    }

    if (data === "menu:vpn") {
      const lang = getUserLang(userId);
      // «🔌 Подключиться» из главного меню.
      // Старое поведение: показывал ссылку ТОЛЬКО для основной подписки → юзеры с
      // дополнительными подписками не могли через эту кнопку получить нужный URL.
      // Новое поведение:
      //   • 0 подписок (включая secondary) → "у вас нет подписок"
      //   • 1 подписка (любая)            → форвардим на sub:connect:<type>:<id> (выдача URL)
      //   • 2+ подписок                   → picker подписок → каждая ведёт на sub:connect:
      try {
        const all = await api.getAllSubscriptions(token);
        const items = connectableSubscriptions(all.items ?? []);
        if (items.length === 0) {
          await editMessageContent(ctx, _t("vpn.link_unavailable", lang), sectionBackToMenu("vpn", config, innerStyles, innerEmojiIds, lang));
          return;
        }
        if (items.length === 1) {
          // Один сабклик — одна ссылка. Эмулируем sub:connect: чтобы не дублировать flow.
          const only = items[0]!;
          const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;
          const useRemna = config?.useRemnaSubscriptionPage === true;
          let url: string | null = null;
          let webAppPath: string | null = null;
          if (only.type === "root") {
            url = getSubscriptionUrl(only.subscription);
            webAppPath = appUrl ? `${appUrl}/cabinet/subscribe` : null;
          } else {
            // T17: secondary в menu:vpn уже отфильтрована (purchasedAsGift=false), активация не нужна.
            const giftRes = await api.getGiftSubscriptionUrl(token, only.id);
            if (useRemna) {
              const byUuid = await api.getSubscriptionByUuid(token, giftRes.uuid);
              url = getSubscriptionUrl(byUuid.subscription);
            }
            webAppPath = appUrl ? `${appUrl}/cabinet/subscribe?uuid=${encodeURIComponent(giftRes.uuid)}` : null;
          }
          if (useRemna && url) {
            await editMessageContent(ctx, `📲 Ссылка на подписку:\n\n${url}`, {
              inline_keyboard: [
                [{ text: "📲 Открыть страницу подключения", url }],
                // T16-fix (11.05.2026): «menu:back» нигде не зарегистрирован → кнопка ломалась.
                // Используем «menu:main» который рендерит главное меню. Текст — «🏠 Главное меню».
                navRowWithProfileBack([{ text: "🏠 Главное меню", callback_data: "menu:main" }], "vpn", config, innerStyles, innerEmojiIds, lang),
              ],
            });
          } else if (webAppPath) {
            await editMessageContent(ctx, "📲 Подключитесь через мини-приложение:", {
              inline_keyboard: [
                [{ text: "📲 Открыть страницу подключения", web_app: { url: webAppPath } }],
                navRowWithProfileBack([{ text: "🏠 Главное меню", callback_data: "menu:main" }], "vpn", config, innerStyles, innerEmojiIds, lang),
              ],
            });
          } else if (url) {
            await editMessageContent(ctx, `📲 Ссылка на подписку:\n\n${url}\n\nОткройте её в приложении VPN.`, sectionBackToMenu("vpn", config, innerStyles, innerEmojiIds, lang));
          } else {
            await editMessageContent(ctx, _t("vpn.link_unavailable", lang), sectionBackToMenu("vpn", config, innerStyles, innerEmojiIds, lang));
          }
          return;
        }
        // 2+ подписок → picker. Кнопка ведёт на sub:connect:<type>:<id> (готовый handler).
        // T16-fix (11.05.2026): добавляем наглядную инфу о каждой подписке (срок + трафик)
        // — как в menu:my_subs. parseSubInfo даёт {idx, daysStr, dateStr, trafficSuffix, statusEmojiSmall}.
        const sorted = [...items].sort((a, b) => {
          if (a.type !== b.type) return a.type === "root" ? -1 : 1;
          return (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0);
        });
        const bodyLines: string[] = [
          "📲 К какой подписке хотите подключиться?",
          "",
          "Выберите её ниже — выдадим ссылку для приложения.",
          "",
        ];
        const rows: { text: string; callback_data: string }[][] = [];
        for (const s of sorted) {
          const info = parseSubInfo(s);
          const idx = s.subscriptionIndex ?? 0;
          const tariff = (s.tariffDisplayName || "—").slice(0, 30);
          const trialMark = s.trialId ? " 🎁" : "";
          // везде единый формат «Подписка #N» (включая root).
          // Body: «Подписка #0 (🌐 Стандартная) — 120 дн. до 07.09.2026»
          //       «Подписка #2 (🔒 Unblock) — 30 дн. до 09.06.2026 | 0/90 ГБ»
          const typeText = `Подписка #${idx}`;
          bodyLines.push(`${info.statusEmojiSmall} ${typeText}${trialMark} ${tariff}`);
          bodyLines.push(`    📅 ${info.daysStr} до ${info.dateStr}${info.trafficSuffix}`);
          bodyLines.push("");
          // Button label остаётся коротким — иначе не влезает в 64 байта callback.
          const btnLabel = `#${idx}${trialMark} ${tariff}`;
          rows.push([{ text: btnLabel.slice(0, 60), callback_data: `sub:connect:${s.type}:${s.id}`.slice(0, 64) }]);
        }
        rows.push(navRowWithProfileBack([{ text: "🏠 Главное меню", callback_data: "menu:main" }], "vpn", config, innerStyles, innerEmojiIds, lang));
        await editMessageContent(ctx, bodyLines.join("\n").trim(), { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "menu:my_subs") {
      try {
        const result = await api.getAllSubscriptions(token);
        if (!result.items?.length) {
          await editMessageContent(
            ctx,
            "📋 Мои подписки\n\nУ вас пока нет активных подписок.",
            sectionBackToMenu("my_subs", config, innerStyles, innerEmojiIds, getUserLang(userId)),
          );
          return;
        }
        // Sort: root первая, затем secondary по subscriptionIndex.
        const sorted = [...result.items].sort((a, b) => {
          if (a.type !== b.type) return a.type === "root" ? -1 : 1;
          return (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0);
        });
        // Формат тела: «🌐 #N — N дн. до DD.MM.YYYY [| used/limit ГБ]» (по строке на подписку).
        // Формат кнопки: «✅ #N <typeEmoji> <tariff> (N дн.)».
        // Дни жирные (через **markdown** + applyMarkdownAndEmoji).
        const bodyLines = [`📋 Мои подписки (**${sorted.length}**)`, ""];
        const buttonItems = sorted.map((it) => {
          const info = parseSubInfo(it);
          // T15.4: маркер 🎁 для триал-подписок в текстовой строке (под лимит callback_data
          // в кнопках уже не влезает, поэтому только в body).
          const trialBodyMark = it.trialId ? " 🎁" : "";
          // без названия тарифа в текстовой строке —
          // для истёкших «❌ истекла», для активных «N дн. до DD.MM.YYYY [+трафик]».
          if (info.isExpired) {
            bodyLines.push(`${info.typeEmoji} #${info.idx}${trialBodyMark} — ❌ истекла`);
          } else {
            bodyLines.push(`${info.typeEmoji} #${info.idx}${trialBodyMark} — **${info.daysStr}** до ${info.dateStr}${info.trafficSuffix}`);
          }
          // tariffDisplayName уже содержит эмодзи категории (🌐/🔒) в начале — не дублируем
          // typeEmoji в лейбле кнопки. Slice 38 → запас под Telegram-лимит 64 байта.
          const tariff = (it.tariffDisplayName || "—").slice(0, 38);
          // T15.4: для trial — компактный маркер 🎁 в конце лейбла кнопки.
          const trialBtnMark = it.trialId ? " 🎁" : "";
          const lifetimeStr = info.isExpired ? "истекла" : info.daysStr;
          const label = `${info.statusEmojiSmall} #${info.idx} ${tariff} (${lifetimeStr})${trialBtnMark}`;
          return { type: it.type, id: it.id, label };
        });
        if (result.items?.some((it) => it.isOfflineSnapshot)) {
          bodyLines.push("");
          bodyLines.push("ℹ️ _Панель VPN временно недоступна. Показаны последние сохранённые данные; они могут быть устаревшими._");
        }
        const { text, entities } = applyMarkdownAndEmoji(bodyLines.join("\n"), config?.botEmojis ?? null);
        await editMessageContent(
          ctx,
          text,
          mySubsListButtons(buttonItems, config?.botBackLabel ?? null, innerStyles, innerEmojiIds, isCabinetGrouped("my_subs", config)),
          entities,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("sub:detail:")) {
      // Формат callback_data: sub:detail:<root|secondary>:<id>
      const rest = data.slice("sub:detail:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      // очистка маркера если юзер вернулся в детали подписки
      pendingDropExtras.delete(userId);
      try {
        const result = await api.getAllSubscriptions(token);
        const item = result.items.find((it) => it.type === subType && it.id === subId);
        if (!item) {
          await editMessageContent(
            ctx,
            "❌ Подписка не найдена",
            { inline_keyboard: [[{ text: "← К списку", callback_data: "menu:my_subs" }]] },
          );
          return;
        }
        const idx = item.subscriptionIndex ?? 0;
        const tariff = item.tariffDisplayName || "—";
        // Извлекаем все нужные поля из сырого Remnawave user (через .response/.data wrapper).
        const subData = item.subscription as Record<string, unknown> | null;
        const inner = subData
          ? ((subData.response ?? subData.data ?? subData) as Record<string, unknown>)
          : null;

        // Статус
        const status = (inner?.status ?? inner?.userStatus ?? "ACTIVE") as string;
        const statusLabel =
          status === "ACTIVE" ? "🟢 Активна" :
          status === "EXPIRED" ? "🔴 Истекла" :
          status === "LIMITED" ? "🟡 Ограничена" :
          status === "DISABLED" ? "🔴 Отключена" :
          `🟡 ${status}`;

        // Дата + время + дни
        const expireAtRaw = inner?.expireAt ?? inner?.expire_at;
        let expireDateTimeStr = "";
        let daysLeftStr = "";
        if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
          const expireAt = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
          if (!isNaN(expireAt.getTime())) {
            expireDateTimeStr = expireAt.toLocaleString("ru-RU", {
              day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
            });
            const days = Math.max(0, Math.ceil((expireAt.getTime() - Date.now()) / 86_400_000));
            daysLeftStr = `${days} ${formatDaysRu(days)}`;
          }
        }

        // Count registered HWIDs from the selected subscription, never a legacy client field.
        const deviceLimit = subscriptionDeviceLimit(item.subscription);
        let devicesUsed: number | null = null;
        try {
          devicesUsed = (await api.getSubscriptionDevices(token, item.id)).total;
        } catch {
          // Keep the subscription card available while honestly showing an unavailable count.
        }
        const devicesLine = formatDeviceCount(devicesUsed, deviceLimit);

        // Трафик: используется/лимит. Если без лимита — «X.XX GB / ♾».
        const tlimit = inner?.trafficLimitBytes ?? inner?.traffic_limit_bytes;
        const tused = (inner?.userTraffic as { usedTrafficBytes?: number } | undefined)?.usedTrafficBytes
          ?? inner?.trafficUsedBytes ?? inner?.usedTrafficBytes ?? inner?.traffic_used_bytes;
        const limitNum = typeof tlimit === "string" ? parseFloat(tlimit) : Number(tlimit);
        const usedNum = typeof tused === "string" ? parseFloat(tused) : Number(tused);
        const usedGb = bytesToGb(Number.isFinite(usedNum) ? usedNum : 0);
        let trafficLine = `📈 Трафик —  ${usedGb} GB`;
        if (Number.isFinite(limitNum) && limitNum > 0) {
          trafficLine = `📈 Трафик —  ${usedGb} / ${bytesToGb(limitNum)} GB`;
        } else {
          trafficLine = `📈 Трафик —  ${usedGb} GB / ♾`;
        }

        // Ссылка для подключения
        const subUrl = getSubscriptionUrl(item.subscription);

        // T15.4 (11.05.2026): пометка «🎁 Пробная» для подписок, созданных через trial.
        // убрали разделение «Основная/Дополнительная» — после унификации
        // все подписки равные. Триал-метка остаётся (это отдельная семантика, не root/secondary).
        const isTrialSub = !!item.trialId;
        const trialMark = isTrialSub ? "🎁 Пробная" : "";
        const isBanned = item.isBanned === true;
        let banLine = "";
        if (isBanned) {
          let untilStr = "";
          if (item.bannedUntil) {
            const bannedUntil = new Date(item.bannedUntil);
            if (!isNaN(bannedUntil.getTime())) {
              untilStr = bannedUntil.toLocaleString("ru-RU", {
                day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
              });
            }
          }
          banLine = `🚫 Подписка заблокирована за превышение трафика${untilStr ? ` до ${untilStr}` : ""}.\nПодключение отключено, действия недоступны до разблокировки.`;
        }
        const lines = [
          `📲 Подписка #${idx}`,
          "",
        ];
        if (trialMark) lines.push(trialMark);
        lines.push(`💎 Тариф: ${tariff}`);
        lines.push(`📊 Статус подписки — ${isBanned ? "🚫 Заблокирована" : statusLabel}`);
        if (banLine) lines.push(banLine);
        if (expireDateTimeStr) lines.push(`📅 до ${expireDateTimeStr}`);
        if (daysLeftStr) lines.push(`⏰ осталось ${daysLeftStr}`);
        if (devicesLine) lines.push(devicesLine);
        lines.push(trafficLine);
        if (subUrl && !isBanned) {
          lines.push("");
          lines.push("🔗 Ссылка для подключения:");
          lines.push(subUrl);
          // подсказка «если инструкции не открываются»
          // прямо в карточке деталей подписки (sub:detail) — здесь юзер видит ссылку чаще всего.
          lines.push("");
          lines.push(instructionFallbackText(config));
        }
        const text = lines.join("\n");

        // подгружаем tariff.locations чтобы решить —
        // показывать ли кнопку «🌐 Локации» в детали подписки.
        let tariffHasLocations = false;
        if (item.tariffId) {
          try {
            const { items: tariffsByCat } = await api.getPublicTariffs();
            const tariffFull = tariffsByCat?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === item.tariffId);
            tariffHasLocations = !!((tariffFull as TariffItem & { locations?: string | null } | undefined)?.locations?.trim());
          } catch {
            /* ignore — без кнопки локаций */
          }
        }
        await editMessageContent(
          ctx,
          text,
          // пробрасываем tariffId — кнопка «Продлить» откроет оплату
          // СРАЗУ для этого тарифа (без выбора в menu:tariffs).
          // T15.4: пробрасываем isTrialSub → CTA «Конвертировать в платную» вместо «Продлить».
          // пробрасываем subUrl — кнопка «📲 Инструкции по установке»
          // открывает его напрямую (без промежуточного экрана со ссылкой).
          subDetailButtons(subType, subId, backToSubsListLabel(config?.botEmojis ?? null), innerStyles, innerEmojiIds, item.tariffId, tariffHasLocations, isTrialSub, item.autoRenewEnabled === true, subUrl, item.extraDevices ?? 0, item.trialConvertEnabled, isBanned, config),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("sub:remove_extras:")) {
      const rest = data.slice("sub:remove_extras:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      await editMessageContent(
        ctx,
        "🗑 Убрать все доп. устройства?\n\n" +
        "• С подписки уберутся все докупленные устройства\n" +
        "• Лимит устройств вернётся к базовому (по тарифу)\n" +
        "• Активные «лишние» устройства будут отключены\n" +
        "• Возврата денег НЕТ — устройства отработали свой срок\n\n" +
        "Подтвердить?",
        {
          inline_keyboard: [
            [{ text: "✅ Да, убрать", callback_data: `sub:remove_extras_confirm:${subType}:${subId}` }],
            [{ text: "❌ Отмена", callback_data: `sub:detail:${subType}:${subId}` }],
          ],
        },
      );
      return;
    }

    if (data.startsWith("sub:remove_extras_confirm:")) {
      const rest = data.slice("sub:remove_extras_confirm:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      try {
        const result = await api.removeExtraDevices(token, subType, subId);
        const msg = result.hwidKicked > 0
          ? `🗑 Готово!\n\n• Убрано: ${result.extraDevicesRemoved} устройств\n• Отключено активных: ${result.hwidKicked}\n• Новый лимит: ${result.newDeviceLimit}\n\nПри следующем продлении цена будет без надбавки за устройства.`
          : `🗑 Готово!\n\n• Убрано: ${result.extraDevicesRemoved} устройств\n• Новый лимит: ${result.newDeviceLimit}\n\nПри следующем продлении цена будет без надбавки за устройства.`;
        await editMessageContent(
          ctx,
          msg,
          {
            inline_keyboard: [
              [{ text: "← К подписке", callback_data: `sub:detail:${subType}:${subId}` }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${errMsg}`, {
          inline_keyboard: [[{ text: "← К подписке", callback_data: `sub:detail:${subType}:${subId}` }]],
        });
      }
      return;
    }

    if (data.startsWith("sub:autorenew:")) {
      const rest = data.slice("sub:autorenew:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      try {
        // Определяем текущее состояние через /subscription/all → autoRenewEnabled
        const all = await api.getAllSubscriptions(token);
        const item = all.items.find((it) => it.type === subType && it.id === subId);
        const wasEnabled = item?.autoRenewEnabled === true;
        if (wasEnabled) {
          // Просто выключаем без подтверждения.
          await api.toggleSubAutoRenew(token, subType, subId, false);
          await editMessageContent(
            ctx,
            "🛑 Автосписание выключено.\n\nПодписка больше не будет продлеваться автоматически.",
            {
              inline_keyboard: [
                [{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: `sub:detail:${subType}:${subId}` }],
                [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
              ],
            },
          );
        } else {
          // Включаем — диалог подтверждения. Текст зависит от наличия YooKassa-recurring.
          const me = await api.getMe(token).catch(() => null);
          const ykCardTitle = me?.yookassaPaymentMethodTitle?.trim();
          const ykRecurringOn = (config as { yookassaRecurringEnabled?: boolean } | null)?.yookassaRecurringEnabled === true;
          const hasYkFallback = ykRecurringOn && !!ykCardTitle;

          // если у клиента есть сохранённая карта YooKassa
          // и в админке включены рекуррентные платежи → предупреждаем что списание может идти с карты.
          let dialogText: string;
          if (hasYkFallback) {
            dialogText = [
              "♻️ Автосписание подписки",
              "",
              "Когда срок этой подписки подойдёт к концу — мы автоматически продлим её. Порядок списания:",
              "",
              "1️⃣ Сначала спишем с **баланса**.",
              `2️⃣ Если на балансе не хватит — недостающую сумму **спишем с вашей сохранённой карты ЮKassa** (${ykCardTitle}).`,
              "",
              "💡 Сохранённая карта была привязана при предыдущей оплате через ЮKassa. Если хотите её отвязать — обратитесь в поддержку.",
              "",
              "❗ Включая автосписание, вы соглашаетесь на регулярные списания с указанной карты согласно условиям оферты.",
              "",
              "Подтвердить включение?",
            ].join("\n");
          } else {
            dialogText = [
              "♻️ Автосписание с баланса",
              "",
              "Когда срок этой подписки подойдёт к концу — мы автоматически продлим её с вашего баланса.",
              "",
              "💡 Если на балансе не будет хватать средств — продление пропустится, мы уведомим вас.",
              "",
              "Подтвердить включение?",
            ].join("\n");
          }

          const { text: msgText, entities: msgEntities } = applyMarkdownAndEmoji(dialogText, config?.botEmojis ?? null);
          await editMessageContent(
            ctx,
            msgText,
            {
              inline_keyboard: [
                [{ text: "✅ Включить", callback_data: `sub:autorenew_confirm:${subType}:${subId}` }],
                [{ text: "❌ Отмена", callback_data: `sub:detail:${subType}:${subId}` }],
              ],
            },
            msgEntities,
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("sub:autorenew_confirm:")) {
      const rest = data.slice("sub:autorenew_confirm:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      try {
        await api.toggleSubAutoRenew(token, subType, subId, true);
        await editMessageContent(
          ctx,
          "✅ Автосписание включено!\n\nПодписка будет автоматически продлеваться с баланса при приближении срока истечения.",
          {
            inline_keyboard: [
              [{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: `sub:detail:${subType}:${subId}` }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        // Если backend вернул EMPTY_BALANCE — показываем предложение пополнить.
        const errMsg = e instanceof Error ? e.message : "Ошибка";
        if (errMsg.includes("EMPTY_BALANCE") || errMsg.includes("Баланс пустой")) {
          await editMessageContent(
            ctx,
            "❌ Баланс пустой\n\nЧтобы включить автосписание — сначала пополните баланс или получите реферальные начисления.",
            {
              inline_keyboard: [
                [{ text: "💳 Пополнить баланс", callback_data: "menu:topup" }],
                [{ text: "👥 Реферальная программа", callback_data: "menu:referral" }],
                [{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: `sub:detail:${subType}:${subId}` }],
              ],
            },
          );
        } else {
          await editMessageContent(ctx, `❌ ${errMsg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        }
      }
      return;
    }

    if (data.startsWith("sub:reissue:")) {
      const rest = data.slice("sub:reissue:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      const text = ((config as { reissueWarningText?: string | null })?.reissueWarningText ?? "").trim()
        || "⚠️ Обновление подписки\n\nБот выдаст вам новую подписку с аналогичным сроком действия. Старая перестанет работать.\n\nВы действительно обновить подписку?";
      await editMessageContent(ctx, text, {
        inline_keyboard: [[
          { text: "✅ Да", callback_data: `sub:reissue_confirm:${subType}:${subId}` },
          { text: "❌ Нет", callback_data: `sub:detail:${subType}:${subId}` },
        ]],
      });
      return;
    }

    if (data.startsWith("sub:reissue_confirm:")) {
      const rest = data.slice("sub:reissue_confirm:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      try {
        const result = await api.reissueSubscription(token, subType, subId);
        const newUrl = result.subscriptionUrl ?? "—";
        // подсказка «если инструкция не открылась».
        await editMessageContent(ctx, `✅ Подписка обновлена!\n\n🔗 Новая ссылка для подключения:\n${newUrl}\n\nСтарая ссылка больше не работает. Не забудьте заново добавить подписку в приложение.\n\n${instructionFallbackText(config)}`, {
          inline_keyboard: [[{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: `sub:detail:${subType}:${subId}` }]],
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка обновления подписки";
        await editMessageContent(ctx, `❌ ${msg}`, {
          inline_keyboard: [[{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: `sub:detail:${subType}:${subId}` }]],
        });
      }
      return;
    }

    if (data.startsWith("sub:connect:")) {
      // Формат: sub:connect:<root|secondary>:<id>
      // Для root — берём URL основной подписки (как menu:vpn).
      // Для secondary — переиспользуем gift activation+url flow.
      const rest = data.slice("sub:connect:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;
      const useRemna = config?.useRemnaSubscriptionPage === true;
      // кнопка «К подписке» на экране ссылки подключения
      // ведёт ОБРАТНО в picker «🔌 Подключиться автоматически» (menu:vpn), а не в детали
      // конкретной подписки. Так юзер может быстро выбрать другую подписку для подключения.
      const backCallback = "menu:vpn";
      try {
        let url: string | null = null;
        let webAppPath: string | null = null;
        if (subType === "root") {
          const subRes = await api.getSubscription(token);
          url = getSubscriptionUrl(subRes.subscription);
          webAppPath = appUrl ? `${appUrl}/cabinet/subscribe` : null;
        } else {
          // T17: secondary в Мои подписки уже отфильтрована (purchasedAsGift=false), активация не нужна.
          const giftRes = await api.getGiftSubscriptionUrl(token, subId);
          if (useRemna) {
            const byUuid = await api.getSubscriptionByUuid(token, giftRes.uuid);
            url = getSubscriptionUrl(byUuid.subscription);
          }
          webAppPath = appUrl ? `${appUrl}/cabinet/subscribe?uuid=${encodeURIComponent(giftRes.uuid)}` : null;
        }

        // подсказка «если инструкция не открылась».
        const fallbackSub = instructionFallbackText(config);
        if (useRemna && url) {
          // Remna sub-page включена → отдаём прямую ссылку на неё (URL-кнопкой).
          await editMessageContent(
            ctx,
            `📲 Ссылка на подписку:\n\n${url}\n\n${fallbackSub}`,
            {
              inline_keyboard: [
                [{ text: "📲 Открыть страницу подключения", url }],
                [{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: backCallback }],
              ],
            },
          );
        } else if (webAppPath) {
          await editMessageContent(
            ctx,
            `📲 Подключитесь через мини-приложение:\n\n${fallbackSub}`,
            {
              inline_keyboard: [
                [{ text: "📲 Открыть страницу подключения", web_app: { url: webAppPath } }],
                [{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: backCallback }],
              ],
            },
          );
        } else if (url) {
          // Нет publicAppUrl и нет Remna sub-page — показываем сырую ссылку.
          await editMessageContent(
            ctx,
            `📲 Ссылка на подписку:\n\n${url}\n\nОткройте её в приложении VPN.\n\n${fallbackSub}`,
            { inline_keyboard: [[{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: backCallback }]] },
          );
        } else {
          await editMessageContent(
            ctx,
            "❌ Не удалось получить ссылку на подписку",
            { inline_keyboard: [[{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: backCallback }]] },
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка получения ссылки";
        await editMessageContent(
          ctx,
          `❌ ${msg}`,
          { inline_keyboard: [[{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: backCallback }]] },
        );
      }
      return;
    }

    if (data === "menu:devices" || data.startsWith("dev:") || data.startsWith("devices:delete:")) {
      const screen = await deviceFlow.handle(`${userId}:${ctx.chat?.id ?? userId}`, data, {
        subscriptions: async () => (await api.getAllSubscriptions(token)).items,
        devices: (id) => api.getSubscriptionDevices(token, id),
        remove: (subscription, hwid) => api.postClientDeviceDelete(token, hwid, subscription),
      });
      const deviceConfig = config?.botButtons?.find(b => b.id === "devices");
      const titleKey = deviceConfig ? deviceConfig.emojiKey : getMenuEmojiKey(config, "devices");
      const title = titleWithOptionalEmoji(titleKey, screen.text.split("\n", 1)[0], botEmojis);
      const text = title.text + screen.text.slice(screen.text.indexOf("\n"));
      await editMessageContent(ctx, text, deviceFlowButtons(screen, config, isCabinetGrouped("devices", config)), title.entities);
      return;
    }

    if (data.startsWith("pay_tariff_ext:")) {
      await startSubscriptionRenewal(ctx, token, userId, config, innerStyles, innerEmojiIds, data.slice("pay_tariff_ext:".length));
      return;
    }

    if (data === "menu:renew" || data.startsWith("renew_pick:")) {
      await showRenewalChoice(ctx, token, userId, config, innerStyles, innerEmojiIds, data === "menu:renew" ? undefined : data.slice("renew_pick:".length));
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
