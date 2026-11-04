import { Composer } from "grammy";
import type { Context } from "grammy";
import * as api from "../api.js";
import { clearUserState, startThrottle, tokenStore } from "../state-store.js";
import { RICH_BUTTONS_MAX, TELEGRAM_CAPTION_MAX, _t, backButton, backToMenu, blockUnsubscribedCallback, botLogoUrl, buildMainMenuRichBlocks, buildMainMenuRichMarkdown, buildMainMenuText, callbackUi, checkUserSubscription, clearCloudEmail, connectableSubscriptions, directConnectionTarget, documentsSubMenu, editMessageContent, enforceSubscription, flattenMenuButtons, getOrRestoreToken, getSubscriptionUrl, getToken, getUserLang, instructionFallbackText, logoToMediaSource, mainMenu, rememberMediaFileId, renewableSubscriptions, sendRichBlocks, sendRichMarkdown, setToken, setTranslations, setUserLang, subscribeKeyboard, t } from "./shared.js";
import type { RichInlineKeyboard, TariffCategory, TariffItem } from "./shared.js";
import { resolveCallbackDomain } from "./routing.js";

function parseStartPayload(payload: string): {
  refCode?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
} {
  const out: ReturnType<typeof parseStartPayload> = {};

  if (payload.includes("__")) {
    const segments = payload.split("__");
    for (const seg of segments) {
      if (seg.startsWith("ref_")) out.refCode = seg.slice(4);
      else if (seg.startsWith("s_")) out.utm_source = seg.slice(2);
      else if (seg.startsWith("m_")) out.utm_medium = seg.slice(2);
      else if (seg.startsWith("k_")) out.utm_campaign = seg.slice(2);
      else if (seg.startsWith("n_")) out.utm_content = seg.slice(2);
      else if (seg.startsWith("t_")) out.utm_term = seg.slice(2);
    }
    return out;
  }

  const parseCampaignPart = (campaignPart: string): void => {
    const parts = campaignPart.split("_").filter(Boolean);
    if (parts.length >= 2) {
      out.utm_source = parts[0];
      out.utm_campaign = parts.length === 2 ? parts[1] : parts[parts.length - 1];
      if (parts.length >= 3) out.utm_medium = parts.slice(1, -1).join("_");
    } else if (parts.length === 1) {
      out.utm_source = parts[0];
    }
  };

  // Кампания без рефкода: payload начинается сразу с `c_`.
  // этот формат раньше не парсился вовсе — поиск `_c_` находит
  // подчёркивание ПЕРЕД `c`, а в "c_vk_winter" его нет. UTM терялись, а fallback
  // в обработчике /start записывал весь payload клиенту как refCode.
  if (/^c_/i.test(payload)) {
    parseCampaignPart(payload.slice(2));
    return out;
  }

  const cIdx = payload.indexOf("_c_");
  const refPart = cIdx >= 0 ? payload.slice(0, cIdx) : payload;
  const campaignPart = cIdx >= 0 ? payload.slice(cIdx + 3) : "";
  if (refPart && /^ref_?/i.test(refPart)) {
    const code = refPart.replace(/^ref_?/i, "").trim();
    if (code) out.refCode = code;
  }
  if (campaignPart) parseCampaignPart(campaignPart);
  return out;
}

// ——— /start с реферальным кодом (например /start ref_ABC123) или промо (/start promo_XXXX) или кампания (/start c_facebook_summer)
// per-user throttle для /start. При массовой рассылке (30k+
// мигрированных юзеров) или если юзер нервно жмёт «Старт» несколько раз — каждый
// повтор от одного и того же tgid в течение 2 сек тихо игнорируется. Защищает
// DB/Remna от лишних запросов и Telegram-API от спама ответов.

export async function handleStart(ctx: Context, payload: string) {
  if (ctx.from) clearCloudEmail(ctx.from.id);
  const from = ctx.from;
  if (!from) return;
  const now = Date.now();
  const last = startThrottle.get(from.id) ?? 0;
  if (now - last < 2000) return; // повтор < 2 сек — тихо дропаем
  clearUserState(from.id);
  startThrottle.set(from.id, now);
  const telegramId = String(from.id);
  const telegramUsername = from.username ?? undefined;

  // Deep-link активации подарка: /start gift_<code>
  // Юзер получил ссылку `t.me/<bot>?start=gift_<code>` от того кто подарил.
  // Активируем подарок мгновенно — без диалога подтверждения.
  if (/^gift_/i.test(payload)) {
    const lang = getUserLang(from.id);
    const code = payload.replace(/^gift_/i, "").trim();
    if (!code) {
      await ctx.reply("❌ Неверная ссылка подарка.");
      return;
    }
    try {
      // Сначала убедимся что юзер зарегистрирован — если нет, регнём по telegramId.
      let token = getToken(from.id);
      if (!token) {
        const reg = await api.registerByTelegram({
          telegramId,
          telegramUsername,
          preferredLang: from.language_code ?? "ru",
        });
        token = reg.token;
        if (token) tokenStore.set(from.id, token);
      }
      if (!token) {
        await ctx.reply("❌ Не удалось получить доступ. Попробуйте позже.");
        return;
      }
      // Активируем подарочный код.
      const result = await api.redeemGiftCode(token, code);
      // config тут не в scope — грузим отдельно.
      const giftCfg = await api.getPublicConfig().catch(() => null);
      // новые тексты получателю по ТЗ клиента.
      // Стандартная (без трафика) — короткий красивый текст.
      // Unblock (с трафиком) — полное описание Unblock с лимитом.
      const hasTrafficLimit = result.trafficLimitBytes != null && result.trafficLimitBytes > 0;
      const days = result.durationDays ?? 0;
      const tariffName = result.tariffName ?? "Подписка";
      const supportLink = giftCfg?.supportLink || "";
      // подсказка «если инструкция не открылась» (подарочная подписка).
      // приписка редактируется в админке («Тексты бота» →
      // bot_gift_url_note); раньше «до 4 устройств» было захардкожено.
      const giftUrlNote = (giftCfg?.botGiftUrlNote ?? "").trim()
        || "💡 Подписка обновляется автоматически\n1️⃣ подписка - до 4️⃣ устройств одновременно";
      const urlBlock = result.subscriptionUrl
        ? `Ссылка подписки:\n${result.subscriptionUrl}\n\n${giftUrlNote}\n\n${instructionFallbackText(giftCfg)}`
        : "";
      let receiverText: string;
      if (hasTrafficLimit) {
        const trafficGb = Math.round((result.trafficLimitBytes ?? 0) / 1024 ** 3);
        // добавляем «💰 Стоимость: X ₽» для Unblock по ТЗ клиента.
        const priceBlock = result.tariffPrice != null && result.tariffPrice > 0
          ? `💰 Стоимость: ${Math.round(result.tariffPrice)} ${(result.tariffCurrency ?? "RUB").toUpperCase() === "RUB" ? "₽" : (result.tariffCurrency ?? "")}\n\n`
          : "";
        receiverText =
          `💝 Вам подарили ${tariffName} на ${days} дней!\n\n` +
          `💡 Это Unblock подписка\nОна позволяет оставаться на связи даже при ограничениях интернета в регионе.\n\n` +
          `📅 Срок действия: ${days} дней\n📊 Лимит трафика: ${trafficGb} GB\n${priceBlock}` +
          `Unblock Internet🔓 — позволяет оставаться на связи в любых ситуациях.\n\n` +
          `⚡️ Unblock поможет, если:\n      🛜 у вас в регионе периодически действуют ограничения мобильного интернета (отключают интернет)\n      🤜 локации из обычной подписки уже не спасают\n      ⛔️ ключи из обычной подписки сами перестают работать через несколько минут после включения\n\n` +
          `💡 Во всех остальных случаях вам поможет стандартная подписка: Главное меню → 💳 Купить доступ\n\n` +
          `🎥 Нет рекламы на YouTube.\n\n` +
          `❗️Если у вас НЕ работают даже сайты из Белого списка (Яндекс, VK, Госуслуги и т.д.) – данная подписка не поможет.\n\n` +
          `💡 Чтобы скопировать подписку, нажмите на неё один раз\n\n` +
          `${urlBlock}\n\n` +
          `💬 По любым вопросам вам поможет наша поддержка - ${supportLink}`;
      } else {
        receiverText =
          `💝 Вам подарили подписку на ${days} день!\n\n` +
          `💡 Чтобы скопировать подписку, нажмите на неё один раз\n\n` +
          `${urlBlock}\n\n` +
          `💬 По любым вопросам вам поможет наша поддержка - ${supportLink}`;
      }
      // Кнопки как при покупке/триале.
      type Row = ({ text: string; callback_data: string } | { text: string; url: string })[];
      const giftRows: Row[] = [];
      if (result.subscriptionUrl) giftRows.push([{ text: "📲 Инструкции по установке", url: result.subscriptionUrl }]);
      giftRows.push([{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }]);
      giftRows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
      await ctx.reply(receiverText, { reply_markup: { inline_keyboard: giftRows } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка активации подарка";
      await ctx.reply(`❌ ${msg}`);
    }
    return;
  }

  // deep-link «продлить конкретную подписку».
  // Используется из авторассылки `subscription_expired` — кнопка «🔄 Продлить» в сообщении
  // содержит url `https://t.me/<bot>?start=renew_<subscriptionId>`. По нажатию открываем
  // оплату того же тарифа подписки (как кнопка «💰 Продлить» в детали).
  if (/^renew_/i.test(payload)) {
    const subId = payload.replace(/^renew_/i, "").trim();
    if (!subId) {
      await ctx.reply("❌ Неверная ссылка продления.");
      return;
    }
    const token = await getOrRestoreToken(from.id, from.username);
    if (!token) {
      await ctx.reply("🔐 Сначала запустите бота через /start");
      return;
    }
    try {
      const all = await api.getAllSubscriptions(token);
      const item = (all.items ?? []).find((it) => it.id === subId);
      if (!item) {
        await ctx.reply("❌ Подписка не найдена или истекла. Зайдите в «📋 Мои подписки».", {
          reply_markup: { inline_keyboard: [[{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }]] },
        });
        return;
      }
      if (!item.tariffId) {
        await ctx.reply("⚠️ К подписке не привязан тариф. Выберите вручную из меню тарифов.", {
          reply_markup: { inline_keyboard: [[{ text: "💳 Купить доступ", callback_data: "menu:tariffs" }]] },
        });
        return;
      }
      // Открываем оплату того же тарифа (использует продление через pay_tariff_ext).
      await ctx.reply(
        `🔄 Продление подписки #${item.subscriptionIndex ?? 0} — ${item.tariffDisplayName ?? "Тариф"}\n\nВыберите способ оплаты:`,
        { reply_markup: { inline_keyboard: [[{ text: "💰 Продлить эту подписку", callback_data: `pay_tariff_ext:${item.id}` }], [{ text: "🏠 Главное меню", callback_data: "menu:main" }]] } },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка";
      await ctx.reply(`❌ ${msg}`);
    }
    return;
  }

  // Deep-link авторизация на сайте: /start auth_TOKEN
  if (/^auth_/i.test(payload)) {
    const lang = getUserLang(from.id);
    const authToken = payload.replace(/^auth_/i, "");
    if (!authToken) {
      await ctx.reply(_t("auth.invalid_link", lang));
      return;
    }
    try {
      await api.confirmTelegramAuth(authToken, from.id, telegramUsername);
      await ctx.reply(_t("auth.confirmed", lang));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : _t("unknown_error", lang);
      console.error("[/start auth_] confirm error:", msg);
      if (msg.includes("expired") || msg.includes("410")) {
        await ctx.reply(_t("auth.expired", lang));
      } else if (msg.includes("already confirmed") || msg.includes("409")) {
        await ctx.reply(_t("auth.already_used", lang));
      } else {
        await ctx.reply(_t("auth_error_start", lang));
      }
    }
    return;
  }

  // Deep-link привязки Telegram к аккаунту с сайта: /start link_CODE
  // Пользователь в кабинете нажал «Привязать Telegram» → открылась ссылка
  // t.me/<bot>?start=link_<code>, которая мгновенно связывает аккаунты
  // (и при необходимости объединяет их — см. mergeClients на бэкенде).
  if (/^link_/i.test(payload)) {
    const lang = getUserLang(from.id);
    const code = payload.replace(/^link_/i, "").trim();
    if (!code) {
      await ctx.reply(_t("link.prompt", lang));
      return;
    }
    try {
      await api.linkTelegramFromBot(code, from.id, from.username ?? undefined);
      await ctx.reply(_t("link.success", lang));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : _t("error_generic", lang);
      await ctx.reply(`❌ ${msg}`);
    }
    return;
  }

  // Определяем тип deeplink
  const isPromo = /^promo_/i.test(payload);
  const promoCode = isPromo ? payload.replace(/^promo_/i, "") : undefined;
  const parsed = parseStartPayload(payload);
  // Fallback «голый payload = рефкод» — только если payload реально похож на
  // рефкод (без префиксов c_/ref_). Раньше `payload.replace(/^ref_?/i, "")`
  // при отсутствии префикса возвращал строку как есть, и кампанийные ссылки
  // вида `c_vk_winter` записывались клиенту как referralCode.
  const isCampaignOnly = /^c_/i.test(payload);
  const bareRefFallback = !isCampaignOnly && !/^ref_?/i.test(payload) ? payload.trim() || undefined : undefined;
  const refCode = !isPromo ? (parsed.refCode ?? bareRefFallback) : undefined;

  try {
    const __T0 = Date.now();
    const __lap = (m: string) => console.log(`[/start timing] ${m}: ${Date.now() - __T0}ms`);
    const config = await api.getPublicConfig();
    __lap("getPublicConfig");
    if (config?.translations) setTranslations(config.translations);
    const name = config?.serviceName?.trim() || "Кабинет";

    const auth = await api.registerByTelegram({
      telegramId,
      telegramUsername,
      preferredLang: config?.defaultLanguage ?? "ru",
      preferredCurrency: config?.defaultCurrency ?? "usd",
      referralCode: refCode,
      utm_source: parsed.utm_source,
      utm_medium: parsed.utm_medium,
      utm_campaign: parsed.utm_campaign,
      utm_content: parsed.utm_content,
      utm_term: parsed.utm_term,
    });
    __lap("registerByTelegram");

    setToken(from.id, auth.token);
    const client = auth.client;
    if (client?.preferredLang) setUserLang(from.id, client.preferredLang);

    // event-driven welcome (after_registration)
    // запускаем сразу после регистрации НОВОГО клиента — не ждём крон. Бэкенд сам
    // дедупит по (rule_id, client_id), так что повторный вызов безопасен.
    // Удалил учётку → новый client_id → дедуп пройдёт → юзер опять получит приветствие.
    if (auth.isNewClient) {
      api.fireOnRegistration(auth.token).catch((e) => {
        console.error("[fireOnRegistration] failed:", e);
      });
    }

    // Если это промо-ссылка — активируем промокод
    if (promoCode) {
      try {
        const result = await api.activatePromo(auth.token, promoCode);
        await ctx.reply(`✅ ${result.message}\n\nНажмите /start чтобы открыть меню.`);
        return;
      } catch (promoErr: unknown) {
        const promoMsg = promoErr instanceof Error ? promoErr.message : "Ошибка активации промокода";
        await ctx.reply(`❌ ${promoMsg}\n\nНажмите /start чтобы открыть меню.`);
        return;
      }
    }

    // Проверка подписки на канал
    if (await enforceSubscription(ctx, config)) return;

    // ─── Приветственное сообщение (если включено в админке) ───
    // Показываем картинку + текст с кнопкой «Войти», которая ведёт в главное меню.
    // Если showOnce=true — только при первом /start (когда client.onboardingCompleted=false).
    const welcomeEnabled = Boolean((config as { botWelcomeEnabled?: boolean })?.botWelcomeEnabled);
    if (welcomeEnabled) {
      const showOnce = Boolean((config as { botWelcomeShowOnce?: boolean })?.botWelcomeShowOnce);
      const alreadySeen = showOnce && client?.onboardingCompleted === true;
      if (!alreadySeen) {
        const welcomeText = ((config as { botWelcomeText?: string | null })?.botWelcomeText ?? "").trim();
        const welcomeImage = ((config as { botWelcomeImage?: string | null })?.botWelcomeImage ?? "").trim();
        if (welcomeText || welcomeImage) {
          const continueMarkup = { inline_keyboard: [[{ text: "✨ Войти в кабинет", callback_data: "welcome:continue" }]] };
          try {
            const media = welcomeImage ? logoToMediaSource(welcomeImage) : null;
            const captionMax = TELEGRAM_CAPTION_MAX;
            const safeText = welcomeText.length > captionMax ? welcomeText.slice(0, captionMax - 3) + "..." : welcomeText;
            if (media) {
              const sentMsg = media.isGif
                ? await ctx.replyWithAnimation(media.source, { caption: safeText || undefined, reply_markup: continueMarkup })
                : await ctx.replyWithPhoto(media.source, { caption: safeText || undefined, reply_markup: continueMarkup });
              rememberMediaFileId(welcomeImage, sentMsg);
            } else {
              await ctx.reply(welcomeText, { reply_markup: continueMarkup });
            }
            // Если showOnce — отметим что приветствие показано (сохранится после первого «Войти»)
            return;
          } catch (e) {
            console.error("[/start welcome] failed:", e instanceof Error ? e.message : e);
            // продолжаем как обычно — fallback на главное меню
          }
        }
      }
    }

    const [bootstrap, proxyRes, singboxRes] = await Promise.all([
      api.getBotBootstrap(auth.token),
      api.getPublicProxyTariffs().catch(() => ({ items: [] })),
      api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
    ]);
    __lap("bootstrap+proxy+singbox");
    const subRes = bootstrap?.subscription ?? { subscription: null };
    const allSubsRes = bootstrap?.allSubscriptions ?? { items: [] };
    const trialAvail = bootstrap?.availableTrials ?? { items: [], hasAnyEnabled: false };
    const vpnUrl = getSubscriptionUrl(subRes.subscription);
    const showTrial = trialAvail.hasAnyEnabled
      ? trialAvail.items.length > 0
      : Boolean(config?.trialEnabled && !(bootstrap?.client.trialUsed ?? client?.trialUsed));
    const showProxy = proxyRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
    const showSingbox = singboxRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
    const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;

    const { text, entities } = buildMainMenuText({
      serviceName: name,
      telegramId: from.id,
      balance: client?.balance ?? 0,
      currency: client?.preferredCurrency ?? config?.defaultCurrency ?? "usd",
      subscription: subRes.subscription,
      tariffDisplayName: (subRes as { tariffDisplayName?: string | null }).tariffDisplayName ?? null,
      menuTexts: config?.botMenuTexts ?? config?.resolvedBotMenuTexts ?? null,
      menuLineVisibility: config?.botMenuLineVisibility ?? null,
      menuTextCustomEmojiIds: config?.menuTextCustomEmojiIds ?? null,
      botEmojis: config?.botEmojis ?? null,
      infoBlock: config?.botInfoBlock ?? null,
      multiSubscriptionsEnabled: config?.multiSubscriptionsEnabled === true,
      allSubs: allSubsRes,
    });
    const caption = text.length > TELEGRAM_CAPTION_MAX ? text.slice(0, TELEGRAM_CAPTION_MAX - 3) + "..." : text;
    const captionEntities = text.length > TELEGRAM_CAPTION_MAX && entities.length ? entities.filter((e) => e.offset + e.length <= TELEGRAM_CAPTION_MAX - 3) : entities;
    const hasVideoInstructions = config?.videoInstructionsEnabled && (config?.videoInstructions?.length ?? 0) > 0;
    const hasSupportLinks = !!(config?.supportLink || config?.agreementLink || config?.offerLink || config?.instructionsLink || hasVideoInstructions);
    const markup = mainMenu({
      liteMode: config?.liteMode === true,
      showTrial,
      paidTrial: bootstrap?.cloudTrialAvailable === true && config?.cloudpaymentsEnabled && config.cloudpaymentsTrialTariffId && (config.cloudpaymentsTrialDays ?? 0) > 0 ? { amount: config.cloudpaymentsTrialAmount ?? 1, days: config.cloudpaymentsTrialDays! } : null,
      showVpn: connectableSubscriptions(allSubsRes.items ?? []).length > 0,
      showRenew: renewableSubscriptions(allSubsRes.items ?? []).length > 0,
      connectTarget: directConnectionTarget(allSubsRes.items ?? [], config?.publicAppUrl, config?.useRemnaSubscriptionPage === true),
      showProxy,
      showSingbox,
      showGift: config?.giftSubscriptionsEnabled === true,
      appUrl,
      botButtons: config?.botButtons ?? null,
      botBackLabel: config?.botBackLabel ?? null,
      hasSupportLinks,
      showTickets: config?.ticketsEnabled === true,
      showExtraOptions: config?.sellOptionsEnabled === true && (config?.sellOptions?.length ?? 0) > 0,
      menuMode: config?.botMenuMode ?? "classic",
      groupCabinet: config?.botGroupCabinet === true,
      buttonsPerRow: config?.botButtonsPerRow ?? 1,
      remnaSubscriptionUrl: config?.useRemnaSubscriptionPage ? vpnUrl : null,
    });
    const isBotAdmin = config?.botAdminTelegramIds?.includes(String(from.id)) ?? false;
    if (isBotAdmin) {
      markup.inline_keyboard.push([{ text: "⚙️ Панель админа", callback_data: "admin:menu" }]);
    }

    // 🎨 Rich-меню (Bot API 10.1) — ВЫКЛЮЧЕНО до следующей обновы (флаг env BOT_RICH_MENU=on).
    let richMenuSent = false;
    if (process.env.BOT_RICH_MENU === "on") {
      try {
        // Кнопки помещаются внутрь сообщения только если их не больше
        // RICH_BUTTONS_MAX И всё сообщение собрано блоками (markdown с blocks
        // несовместим — разметка молча отбрасывается). Иначе — прежний путь:
        // разметка + цветная клавиатура снизу.
        if (true) {
          const __allBtns = flattenMenuButtons(markup as unknown as RichInlineKeyboard);
          const blocks = buildMainMenuRichBlocks({
            serviceName: name,
            balance: client?.balance ?? 0,
            currency: client?.preferredCurrency ?? config?.defaultCurrency ?? "usd",
            logoUrl: botLogoUrl(config),
            allSubs: allSubsRes,
            infoBlock: config?.botInfoBlock ?? null,
            menuTexts: config?.botMenuTexts ?? config?.resolvedBotMenuTexts ?? null,
            buttons: __allBtns,
          });
          await sendRichBlocks(ctx, blocks, undefined);
        } else {
          const richMd = buildMainMenuRichMarkdown({
            serviceName: name,
            balance: client?.balance ?? 0,
            currency: client?.preferredCurrency ?? config?.defaultCurrency ?? "usd",
            logoUrl: botLogoUrl(config),
            allSubs: allSubsRes,
            infoBlock: config?.botInfoBlock ?? null,
            menuTexts: config?.botMenuTexts ?? config?.resolvedBotMenuTexts ?? null,
          });
          await sendRichMarkdown(ctx, richMd, markup as unknown as RichInlineKeyboard);
        }
        richMenuSent = true;
      } catch (richErr) {
        console.error("[/start rich] failed, fallback to plain:", richErr instanceof Error ? richErr.message : richErr);
      }
    }
    __lap("before send");
    if (!richMenuSent) {
      const media = logoToMediaSource(config?.logoBot);
      if (media) {
        const opts = { caption, caption_entities: captionEntities.length ? captionEntities : undefined, reply_markup: markup };
        const sentMsg = media.isGif
          ? await ctx.replyWithAnimation(media.source, opts)
          : await ctx.replyWithPhoto(media.source, opts);
        rememberMediaFileId(config?.logoBot, sentMsg);
      } else {
        await ctx.reply(text, { entities: entities.length ? entities : undefined, reply_markup: markup });
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка входа";
    await ctx.reply(`❌ ${msg}`);
  }
}

export function createStartHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

  composer.command("start", (ctx) => handleStart(ctx, ctx.match?.trim() || ""));

// ——— /link КОД — привязка Telegram к аккаунту (код из кабинета на сайте)
composer.command("link", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  const lang = getUserLang(from.id);
  const code = (ctx.match?.trim() || "").replace(/\s+/g, " ");
  if (!code) {
    await ctx.reply(_t("link.prompt", lang));
    return;
  }
  try {
    await api.linkTelegramFromBot(code, from.id, from.username ?? undefined);
    await ctx.reply(_t("link.success", lang));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : _t("error_generic", lang);
    await ctx.reply(`❌ ${msg}`);
  }
});

  composer.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from?.id;
    if (!userId) return;
    if (resolveCallbackDomain(data) !== "start") return next();
    if (data === "welcome:continue") {
  if (data === "welcome:continue") {
    const token = getToken(userId);
    if (!token) {
      await ctx.reply("Сессия истекла. Отправьте /start ещё раз.");
      return;
    }
    try {
      // Помечаем что онбординг пройден (чтобы при showOnce=true приветствие больше не показывалось)
      await api.completeOnboarding(token).catch(() => {});
      const config = await api.getPublicConfig();
      if (config?.translations) setTranslations(config.translations);
      const [bootstrap, proxyRes, singboxRes] = await Promise.all([
        api.getBotBootstrap(token),
        api.getPublicProxyTariffs().catch(() => ({ items: [] })),
        api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
      ]);
      const me = bootstrap?.client ?? (await api.getMe(token));
      const subRes = bootstrap?.subscription ?? { subscription: null };
      const allSubsRes = bootstrap?.allSubscriptions ?? { items: [] };
      const trialAvail = bootstrap?.availableTrials ?? { items: [], hasAnyEnabled: false };
      const vpnUrl = getSubscriptionUrl(subRes.subscription);
      // T15: новый/legacy flow.
      const showTrial = trialAvail.hasAnyEnabled
        ? trialAvail.items.length > 0
        : Boolean(config?.trialEnabled && !(bootstrap?.client.trialUsed ?? me.trialUsed));
      const showProxy = proxyRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
      const showSingbox = singboxRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
      const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;
      const { text, entities } = buildMainMenuText({
        serviceName: config?.serviceName?.trim() || "Кабинет",
        telegramId: userId,
        balance: me.balance ?? 0,
        currency: me.preferredCurrency ?? config?.defaultCurrency ?? "usd",
        subscription: subRes.subscription,
        tariffDisplayName: (subRes as { tariffDisplayName?: string | null }).tariffDisplayName ?? null,
        menuTexts: config?.botMenuTexts ?? config?.resolvedBotMenuTexts ?? null,
        menuLineVisibility: config?.botMenuLineVisibility ?? null,
        menuTextCustomEmojiIds: config?.menuTextCustomEmojiIds ?? null,
        botEmojis: config?.botEmojis ?? null,
        infoBlock: config?.botInfoBlock ?? null,
        multiSubscriptionsEnabled: config?.multiSubscriptionsEnabled === true,
        allSubs: allSubsRes,
      });
      const hasVideoInstructions = config?.videoInstructionsEnabled && (config?.videoInstructions?.length ?? 0) > 0;
      const hasSupportLinks = !!(config?.supportLink || config?.agreementLink || config?.offerLink || config?.instructionsLink || hasVideoInstructions);
      const markup = mainMenu({
      liteMode: config?.liteMode === true,
        showTrial,
      paidTrial: bootstrap?.cloudTrialAvailable === true && config?.cloudpaymentsEnabled && config.cloudpaymentsTrialTariffId && (config.cloudpaymentsTrialDays ?? 0) > 0 ? { amount: config.cloudpaymentsTrialAmount ?? 1, days: config.cloudpaymentsTrialDays! } : null,
        showVpn: connectableSubscriptions(allSubsRes.items ?? []).length > 0,
        showRenew: renewableSubscriptions(allSubsRes.items ?? []).length > 0,
        connectTarget: directConnectionTarget(allSubsRes.items ?? [], config?.publicAppUrl, config?.useRemnaSubscriptionPage === true),
        showProxy,
        showSingbox,
        showGift: config?.giftSubscriptionsEnabled === true,
        appUrl,
        botButtons: config?.botButtons ?? null,
        botBackLabel: config?.botBackLabel ?? null,
        hasSupportLinks,
        showTickets: config?.ticketsEnabled === true,
        showExtraOptions: config?.sellOptionsEnabled === true && (config?.sellOptions?.length ?? 0) > 0,
        menuMode: config?.botMenuMode ?? "classic",
      groupCabinet: config?.botGroupCabinet === true,
        buttonsPerRow: config?.botButtonsPerRow ?? 1,
        remnaSubscriptionUrl: config?.useRemnaSubscriptionPage ? vpnUrl : null,
      });
      const isBotAdmin = config?.botAdminTelegramIds?.includes(String(userId)) ?? false;
      if (isBotAdmin) markup.inline_keyboard.push([{ text: "⚙️ Панель админа", callback_data: "admin:menu" }]);
      // Нельзя editMessageContent у photo — отправляем новое сообщение и удаляем старое
      const cbMsg = ctx.callbackQuery?.message;
      const media = logoToMediaSource(config?.logoBot);
      if (media) {
        const caption = text.length > TELEGRAM_CAPTION_MAX ? text.slice(0, TELEGRAM_CAPTION_MAX - 3) + "..." : text;
        const captionEntities = text.length > TELEGRAM_CAPTION_MAX && entities.length ? entities.filter((e) => e.offset + e.length <= TELEGRAM_CAPTION_MAX - 3) : entities;
        const opts = { caption, caption_entities: captionEntities.length ? captionEntities : undefined, reply_markup: markup };
        const sentMsg = media.isGif
          ? await ctx.replyWithAnimation(media.source, opts)
          : await ctx.replyWithPhoto(media.source, opts);
        rememberMediaFileId(config?.logoBot, sentMsg);
      } else {
        await ctx.reply(text, { entities: entities.length ? entities : undefined, reply_markup: markup });
      }
      if (cbMsg?.message_id) {
        await ctx.api.deleteMessage(cbMsg.chat.id, cbMsg.message_id).catch(() => {});
      }
    } catch (e) {
      console.error("[welcome:continue]", e instanceof Error ? e.message : e);
      await ctx.reply("Не удалось открыть меню. Попробуйте /start.");
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
      if (data === "check_subscribe") {
    if (data === "check_subscribe") {
      const lang = getUserLang(userId);
      const channelId = config?.forceSubscribeChannelId?.trim();
      if (channelId && config?.forceSubscribeEnabled) {
        const result = await checkUserSubscription(ctx.api, userId, channelId);
        if (result.state === "cannot_verify") {
          await ctx.answerCallbackQuery({
            text: _t("subscribe.cannot_verify", lang).slice(0, 200),
            show_alert: true,
          }).catch(() => {});
          await editMessageContent(
            ctx,
            `⚠️ ${_t("subscribe.cannot_verify", lang)}`,
            subscribeKeyboard(channelId, lang)
          );
          return;
        }
        if (result.state !== "subscribed") {
          await ctx.answerCallbackQuery({ text: _t("subscribe.not_subscribed", lang), show_alert: true }).catch(() => {});
          return;
        }
      }
      await ctx.answerCallbackQuery({ text: _t("subscribe.confirmed", lang) }).catch(() => {});
      await ctx.reply(_t("subscribe.send_start", lang));
      return;
    }
      }
      if (await blockUnsubscribedCallback(ctx, userId, config)) return;
      const { appUrl, innerStyles, botEmojis, innerEmojiIds } = callbackUi(config);

    if (data === "menu:main") {
      clearUserState(userId);
      const [bootstrap, proxyRes, singboxRes] = await Promise.all([
        api.getBotBootstrap(token),
        api.getPublicProxyTariffs().catch(() => ({ items: [] })),
        api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
      ]);
      const client = bootstrap?.client;
      const subRes = bootstrap?.subscription ?? { subscription: null };
      const allSubsRes = bootstrap?.allSubscriptions ?? { items: [] };
      const trialAvail = bootstrap?.availableTrials ?? { items: [], hasAnyEnabled: false };
      if (client?.preferredLang) setUserLang(userId, client.preferredLang);
      const vpnUrl = getSubscriptionUrl(subRes.subscription);
      // если в админке настроены trials → используем их (скрываем
      // кнопку когда юзер всё взял); иначе fallback на legacy single-trial.
      const showTrial = trialAvail.hasAnyEnabled
        ? trialAvail.items.length > 0
        : Boolean(config?.trialEnabled && !(bootstrap?.client.trialUsed ?? client?.trialUsed));
      const showProxy = proxyRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
      const showSingbox = singboxRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
      const name = config?.serviceName?.trim() || "Кабинет";
      const { text, entities } = buildMainMenuText({
        serviceName: name,
        telegramId: userId,
        balance: client?.balance ?? 0,
        currency: client?.preferredCurrency ?? config?.defaultCurrency ?? "usd",
        subscription: subRes.subscription,
        tariffDisplayName: (subRes as { tariffDisplayName?: string | null }).tariffDisplayName ?? null,
        menuTexts: config?.botMenuTexts ?? config?.resolvedBotMenuTexts ?? null,
        menuLineVisibility: config?.botMenuLineVisibility ?? null,
        menuTextCustomEmojiIds: config?.menuTextCustomEmojiIds ?? null,
        botEmojis: config?.botEmojis ?? null,
        infoBlock: config?.botInfoBlock ?? null,
        multiSubscriptionsEnabled: config?.multiSubscriptionsEnabled === true,
        allSubs: allSubsRes,
      });
      const hasVideoInstructionsCb = config?.videoInstructionsEnabled && (config?.videoInstructions?.length ?? 0) > 0;
      const hasSupportLinks = !!(config?.supportLink || config?.agreementLink || config?.offerLink || config?.instructionsLink || hasVideoInstructionsCb);
      const backMarkup = mainMenu({
      liteMode: config?.liteMode === true,
        showTrial,
      paidTrial: bootstrap?.cloudTrialAvailable === true && config?.cloudpaymentsEnabled && config.cloudpaymentsTrialTariffId && (config.cloudpaymentsTrialDays ?? 0) > 0 ? { amount: config.cloudpaymentsTrialAmount ?? 1, days: config.cloudpaymentsTrialDays! } : null,
        showVpn: connectableSubscriptions(allSubsRes.items ?? []).length > 0,
        showRenew: renewableSubscriptions(allSubsRes.items ?? []).length > 0,
        connectTarget: directConnectionTarget(allSubsRes.items ?? [], config?.publicAppUrl, config?.useRemnaSubscriptionPage === true),
        showProxy,
        showSingbox,
        showGift: config?.giftSubscriptionsEnabled === true,
        appUrl,
        botButtons: config?.botButtons ?? null,
        botBackLabel: config?.botBackLabel ?? null,
        hasSupportLinks,
        showTickets: config?.ticketsEnabled === true,
        showExtraOptions: config?.sellOptionsEnabled === true && (config?.sellOptions?.length ?? 0) > 0,
        menuMode: config?.botMenuMode ?? "classic",
      groupCabinet: config?.botGroupCabinet === true,
        buttonsPerRow: config?.botButtonsPerRow ?? 1,
        remnaSubscriptionUrl: config?.useRemnaSubscriptionPage ? vpnUrl : null,
      });
      if (config?.botAdminTelegramIds?.includes(String(userId))) {
        backMarkup.inline_keyboard.push([{ text: "⚙️ Панель админа", callback_data: "admin:menu" }]);
      }

      // If current message is text-only (no photo/animation) but logo is configured,
      // delete the text message and re-send the main menu with the logo image.
      const cbMsg = ctx.callbackQuery?.message;
      const cbHasPhoto = cbMsg && typeof cbMsg === "object" && "photo" in cbMsg && Array.isArray((cbMsg as { photo: unknown[] }).photo) && (cbMsg as { photo: unknown[] }).photo.length > 0;
      const cbHasAnimation = cbMsg && typeof cbMsg === "object" && "animation" in cbMsg && (cbMsg as { animation: unknown }).animation != null;
      const media = logoToMediaSource(config?.logoBot);
      if (!cbHasPhoto && !cbHasAnimation && media && ctx.chat?.id) {
        await ctx.deleteMessage().catch(() => {});
        const caption = text.length > TELEGRAM_CAPTION_MAX ? text.slice(0, TELEGRAM_CAPTION_MAX - 3) + "..." : text;
        const captionEntities = text.length > TELEGRAM_CAPTION_MAX && entities ? entities.filter((e) => e.offset + e.length <= TELEGRAM_CAPTION_MAX - 3) : entities;
        const opts = { caption, caption_entities: captionEntities?.length ? captionEntities : undefined, reply_markup: backMarkup };
        const sentMsg = media.isGif
          ? await ctx.api.sendAnimation(ctx.chat.id, media.source, opts)
          : await ctx.api.sendPhoto(ctx.chat.id, media.source, opts);
        rememberMediaFileId(config?.logoBot, sentMsg);
        return;
      }

      await editMessageContent(ctx, text, backMarkup, entities);
      return;
    }

    if (data === "menu:docs") {
      const lang = getUserLang(userId);
      await editMessageContent(
        ctx,
        "📄 Документы",
        documentsSubMenu(
          {
            agreement: config?.agreementLink,
            offer: config?.offerLink,
            refund: config?.refundLink,
          },
          config?.botBackLabel ?? null,
          innerStyles?.back,
          innerEmojiIds,
          lang,
        ),
      );
      return;
    }

    if (data.startsWith("loc:") || data.startsWith("menu:locations:")) {
      const isCompact = data.startsWith("loc:");
      const tail = data.slice(isCompact ? "loc:".length : "menu:locations:".length);
      const parts = tail.split(":");
      const tariffId = parts[0] ?? "";
      const compactT = isCompact ? parts[1] : null;
      const backSubType: "root" | "secondary" | null =
        compactT === "r" ? "root" : compactT === "s" ? "secondary" : null;
      const backSubId = isCompact ? (parts[2] ?? null) : null;
      try {
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
        const text = ((tariff as TariffItem & { locations?: string | null } | undefined)?.locations ?? "").trim()
          || "🌐 Локации\n\nДля этого тарифа локации пока не настроены. Обратитесь в поддержку.";
        // Текст «Назад» из настроек админки (config.botBackLabel) — пользователь видит
        // тот же смайлик что и везде в боте. Fallback на «⬅️ Назад».
        const backText = (config?.botBackLabel && config.botBackLabel.trim()) || "⬅️ Назад";
        const homeText = "🏠 Главное меню";
        const inline_keyboard: { text: string; callback_data: string }[][] = [];
        if (backSubType && backSubId) {
          inline_keyboard.push([{ text: backText, callback_data: `sub:detail:${backSubType}:${backSubId}` }]);
        }
        inline_keyboard.push([{ text: homeText, callback_data: "menu:main" }]);
        await editMessageContent(ctx, text, { inline_keyboard });
      } catch {
        await editMessageContent(ctx, "🌐 Локации\n\n❌ Ошибка загрузки.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "menu:tg_proxy") {
      const text = (config?.tgProxyText ?? "").trim() || "🛡 Бесплатный прокси для Telegram\n\nНастройки прокси пока не заданы. Обратитесь в поддержку.";
      const servers = (config?.tgProxyServers ?? []) as { flag?: string; name?: string; url?: string }[];
      const rows: { text: string; url?: string; callback_data?: string }[][] = [];
      if (servers.length > 0) {
        for (const s of servers) {
          const url = (s.url ?? "").trim();
          if (!url) continue;
          const label = `${(s.flag ?? "").trim()} ${(s.name ?? "").trim()}`.trim() || "Прокси";
          rows.push([{ text: label, url }]);
        }
      } else {
        // Fallback на legacy-поля primary/backup.
        const primaryUrl = (config?.tgProxyUrlPrimary ?? "").trim();
        const backupUrl = (config?.tgProxyUrlBackup ?? "").trim();
        if (primaryUrl) rows.push([{ text: "🇳🇱 Нидерланды", url: primaryUrl }]);
        if (backupUrl) rows.push([{ text: "🇩🇪 Германия", url: backupUrl }]);
      }
      // «menu:back» не зарегистрирован → кнопка ломалась.
      // Используем «menu:main» и переименуем в «🏠 Главное меню».
      rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await editMessageContent(ctx, text, { inline_keyboard: rows as any });
      return;
    }

    if (data === "menu:video_instructions") {
      const vItems = config?.videoInstructions ?? [];
      if (!vItems.length) {
        await editMessageContent(ctx, "Инструкции пока не добавлены.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const backLabel = (config?.botBackLabel && config.botBackLabel.trim()) || "« Назад";
      const rows: { text: string; callback_data: string }[][] = vItems
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v) => [{ text: `📹 ${v.title}`, callback_data: `vinstr:${v.id}` }]);
      rows.push([{ text: backLabel, callback_data: "menu:support" }]);
      await editMessageContent(ctx, "📹 Видео-инструкции\n\nВыберите инструкцию:", { inline_keyboard: rows });
      return;
    }

    if (data.startsWith("vinstr:")) {
      const instrId = data.slice(7);
      const vItems = config?.videoInstructions ?? [];
      const instr = vItems.find((v) => v.id === instrId);
      if (!instr) {
        await editMessageContent(ctx, "Инструкция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const backLabel = (config?.botBackLabel && config.botBackLabel.trim()) || "« Назад";
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      try {
        await ctx.deleteMessage().catch(() => {});
      } catch { /* ignore */ }
      try {
        await ctx.api.sendVideo(chatId, instr.telegramFileId, {
          caption: `📹 ${instr.title}`,
          reply_markup: {
            inline_keyboard: [
              [{ text: "« Назад к инструкциям", callback_data: "menu:video_instructions_fresh" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        });
      } catch (e) {
        await ctx.api.sendMessage(chatId, "Не удалось отправить видео. Попробуйте позже.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "« Назад к инструкциям", callback_data: "menu:video_instructions_fresh" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        });
      }
      return;
    }

    if (data === "menu:video_instructions_fresh") {
      const vItems = config?.videoInstructions ?? [];
      if (!vItems.length) {
        await ctx.api.sendMessage(ctx.chat!.id, "Инструкции пока не добавлены.", {
          reply_markup: backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds),
        });
        return;
      }
      const backLabel = (config?.botBackLabel && config.botBackLabel.trim()) || "« Назад";
      const rows: { text: string; callback_data: string }[][] = vItems
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v) => [{ text: `📹 ${v.title}`, callback_data: `vinstr:${v.id}` }]);
      rows.push([{ text: backLabel, callback_data: "menu:support" }]);
      try {
        await ctx.deleteMessage().catch(() => {});
      } catch { /* ignore */ }
      await ctx.api.sendMessage(ctx.chat!.id, "📹 Видео-инструкции\n\nВыберите инструкцию:", {
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    if (data === "menu:roulette") {
      const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;
      const rouletteUrl = appUrl ? `${appUrl}/cabinet/roulette` : null;
      if (!rouletteUrl) {
        await editMessageContent(ctx, "Рулетка временно недоступна.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      await editMessageContent(
        ctx,
        `🎰 Колесо Фортуны

Испытайте свою удачу! Крутите рулетку каждый день и выигрывайте дни подписки, рубли на баланс или приятные скидки 🎁`,
        {
          inline_keyboard: [
            [{ text: "🎰 Крутить рулетку", web_app: { url: rouletteUrl } }],
            [{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:main" }],
          ],
        }
      );
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
