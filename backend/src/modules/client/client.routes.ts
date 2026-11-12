import { cloudClientRouter } from "../cloudpayments/cloudpayments.routes.js";
import { webClientRouter } from "../amnezia-web/client.routes.js";
import { isWebPanel, WEB_PROTOCOLS } from "../amnezia-web/api.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import {
  getSystemConfig,
  getPublicConfig,
} from "./client.service.js";
import { requireClientAuth, requireRemnaOnline, requireRemnaPaymentOnline } from "./client.middleware.js";
export { requireRemnaOnline };
export { requireRemnaPaymentOnline };
import { remnaGetUser } from "../remna/remna.client.js";

import { buildSingboxSlotSubscriptionLink } from "../singbox/singbox-link.js";
import { clientAuthRouter } from "./client-auth.routes.js";
import { clientProfileRouter } from "./client-profile.routes.js";
import { clientReferralsRouter } from "./client-referrals.routes.js";
import { clientTrialsPromoRouter, extractCurrentExpireAt } from "./client-trials-promo.routes.js";
import { clientSubscriptionsRouter } from "./client-subscriptions.routes.js";
import { clientPaymentsBalanceRouter } from "./client-payments-balance.routes.js";
import { clientPaymentsFiatRouter, handleYoomoneyCallback } from "./client-payments-fiat.routes.js";
import { clientPaymentsCryptoRouter } from "./client-payments-crypto.routes.js";
import { clientTicketsRouter } from "./client-tickets.routes.js";
export { fetchAvailableTrialsForClient } from "./client-trials-promo.routes.js";

// Единый роутер /api/client: /auth (логин, регистрация, me) + кабинет (подписка, платежи)
export const clientRouter = Router();
clientRouter.use("/auth", clientAuthRouter);

// ЮMoney OAuth callback — без авторизации клиента (редирект с ЮMoney)
clientRouter.get("/yoomoney/callback", handleYoomoneyCallback);

// ——— Tour Steps (публичные, без авторизации — ПЕРЕД requireClientAuth!) ———
clientRouter.get("/tour-steps", async (_req, res) => {
  try {
    const steps = await prisma.tourStep.findMany({
      where: { isActive: true },
      include: { mascot: { include: { emotions: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return res.json({
      items: steps.map(s => ({
        id: s.id,
        target: s.target,
        targetLabel: s.targetLabel,
        title: s.title,
        content: s.content,
        videoUrl: s.videoUrl,
        placement: s.placement,
        route: s.route,
        mascotId: s.mascotId,
        mood: s.mood,
        sortOrder: s.sortOrder,
        mascot: s.mascot ? {
          id: s.mascot.id, name: s.mascot.name, imageUrl: s.mascot.imageUrl,
          emotions: (s.mascot.emotions ?? []).map((e: { id: string; mood: string; imageUrl: string }) => ({
            id: e.id, mood: e.mood, imageUrl: e.imageUrl,
          })),
        } : null,
      })),
    });
  } catch (e) {
    console.error("GET /tour-steps error:", e);
    return res.status(500).json({ message: "Ошибка загрузки шагов тура" });
  }
});

clientRouter.use(requireClientAuth);
clientRouter.use("/cloudpayments", cloudClientRouter);
clientRouter.use(clientProfileRouter);

clientRouter.use(clientReferralsRouter);
clientRouter.use(clientTrialsPromoRouter);

clientRouter.get("/proxy-slots", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const now = new Date();
  const slots = await prisma.proxySlot.findMany({
    where: { clientId: client.id, status: "ACTIVE", expiresAt: { gt: now } },
    select: {
      id: true,
      login: true,
      password: true,
      expiresAt: true,
      trafficLimitBytes: true,
      trafficUsedBytes: true,
      connectionLimit: true,
      node: { select: { publicHost: true, socksPort: true, httpPort: true } },
    },
    orderBy: { expiresAt: "asc" },
  });
  return res.json({
    slots: slots.map((s) => ({
      id: s.id,
      login: s.login,
      password: s.password,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      connectionLimit: s.connectionLimit,
      host: s.node.publicHost ?? "host",
      socksPort: s.node.socksPort,
      httpPort: s.node.httpPort,
    })),
  });
});

clientRouter.use(webClientRouter);

clientRouter.get("/singbox-slots", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const client = (req as unknown as { client: { id: string } }).client;
  const now = new Date();
  const slots = await prisma.singboxSlot.findMany({
    where: { clientId: client.id, OR: [{ status: "ACTIVE", expiresAt: { gt: now } }, ...(req.query.includeInactive === "true" ? [{ node: { protocol: { in: [...WEB_PROTOCOLS] } }, status: { in: ["ACTIVE", "PROVISIONING"] } }] : [])] },
    select: {
      id: true,
      status: true,
      syncPending: true,
      sourcePaymentId: true,
      singboxTariff: { select: { enabled: true } },
      userIdentifier: true,
      secret: true,
      expiresAt: true,
      trafficLimitBytes: true,
      trafficUsedBytes: true,
      node: { select: { status: true, publicHost: true, port: true, protocol: true, tlsEnabled: true, customConfigJson: true } },
    },
    orderBy: { expiresAt: "asc" },
  });
  const payments = await prisma.payment.findMany({ where: { id: { in: slots.map(s => s.sourcePaymentId).filter((id): id is string => !!id) } }, select: { id: true, status: true } });
  const paid = new Set(payments.filter(p => p.status === "PAID").map(p => p.id));
  return res.json({
    slots: slots.filter(s => !isWebPanel(s.node.protocol) || (s.sourcePaymentId && paid.has(s.sourcePaymentId))).map((s) => {
      const link = s.status === "ACTIVE" && s.expiresAt > now ? buildSingboxSlotSubscriptionLink(
        {
          publicHost: s.node.publicHost ?? "",
          port: s.node.port ?? 443,
          protocol: s.node.protocol ?? "VLESS",
          tlsEnabled: s.node.tlsEnabled,
          customConfigJson: s.node.customConfigJson,
        },
        { userIdentifier: s.userIdentifier, secret: s.secret },
        `slot-${s.id.slice(-8)}`
      ) : "";
      return {
        id: s.id,
        status: s.syncPending || s.status === "PROVISIONING" ? "PENDING" : s.expiresAt <= now ? "EXPIRED" : s.trafficLimitBytes && s.trafficUsedBytes >= s.trafficLimitBytes ? "TRAFFIC_LIMIT" : s.node.status === "DISABLED" ? "DISABLED" : "ACTIVE",
        nodeOnline: s.node.status === "ONLINE",
        canRenew: isWebPanel(s.node.protocol) && s.status === "ACTIVE" && s.node.status !== "DISABLED" && !!s.singboxTariff?.enabled && !s.syncPending,
        subscriptionLink: link,
        expiresAt: s.expiresAt.toISOString(),
        trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
        trafficUsedBytes: s.trafficUsedBytes.toString(),
        protocol: s.node.protocol ?? "VLESS",
      };
    }),
  });
});

clientRouter.use(clientSubscriptionsRouter);
clientRouter.use(clientPaymentsBalanceRouter);
clientRouter.use(clientPaymentsFiatRouter);
clientRouter.use(clientPaymentsCryptoRouter);

const aiChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string()
  })).max(50),
});

clientRouter.post("/ai/chat", async (req, res) => {
  try {
    const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;

    const parsed = aiChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Неверный формат сообщений", errors: parsed.error.flatten() });
    }

    const config = await getSystemConfig();
    const publicConfig = await getPublicConfig();
    if ((publicConfig as { aiChatEnabled?: boolean }).aiChatEnabled === false) {
      return res.status(403).json({ message: "AI-чат отключён" });
    }

    const apiKey = (config as { groqApiKey?: string | null }).groqApiKey?.trim();
    if (!apiKey) {
      // Заглушка, если API ключ не настроен
      return res.json({
        reply: "Извините, AI-ассистент пока не настроен. Пожалуйста, обратитесь в поддержку или настройте Groq API Key в админ-панели."
      });
    }

    const primaryModel = (config as { groqModel?: string | null }).groqModel?.trim() || "llama3-8b-8192";
    const fallback1 = (config as { groqFallback1?: string | null }).groqFallback1?.trim();
    const fallback2 = (config as { groqFallback2?: string | null }).groqFallback2?.trim();
    const fallback3 = (config as { groqFallback3?: string | null }).groqFallback3?.trim();
    
    const modelsToTry = [primaryModel];
    if (fallback1) modelsToTry.push(fallback1);
    if (fallback2) modelsToTry.push(fallback2);
    if (fallback3) modelsToTry.push(fallback3);

    const systemPromptText = (config as { aiSystemPrompt?: string | null }).aiSystemPrompt?.trim() || "Ты — лучший менеджер техподдержки VPN-сервиса. Твоя цель — вежливо, быстро и точно помогать пользователям с настройкой VPN, тарифами и решением технических проблем. Отвечай кратко и по делу.";

    const vpnTariffs = await prisma.tariff.findMany({ orderBy: { price: 'asc' } });
    const proxyTariffs = await prisma.proxyTariff.findMany({ where: { enabled: true }, orderBy: { price: 'asc' } });
    const singboxTariffs = await prisma.singboxTariff.findMany({ where: { enabled: true }, orderBy: { price: 'asc' } });

    let tariffsContext = "\n\nАКТУАЛЬНАЯ ИНФОРМАЦИЯ О ТАРИФАХ ДЛЯ ПОЛЬЗОВАТЕЛЯ:\nОбязательно используй только эти тарифы, если пользователь спрашивает про цены.\n";
    if (vpnTariffs.length > 0) tariffsContext += "VPN Тарифы: " + vpnTariffs.map(t => `${t.name} (${t.price} ${t.currency.toUpperCase()} на ${t.durationDays} дней)`).join(", ") + ".\n";
    if (proxyTariffs.length > 0) tariffsContext += "Прокси: " + proxyTariffs.map(t => `${t.name} (${t.price} ${t.currency.toUpperCase()} на ${t.durationDays} дней)`).join(", ") + ".\n";
    if (singboxTariffs.length > 0) tariffsContext += "Sing-box: " + singboxTariffs.map(t => `${t.name} (${t.price} ${t.currency.toUpperCase()} на ${t.durationDays} дней)`).join(", ") + ".\n";

    const paymentMethods = [];
    if (publicConfig.yookassaEnabled) paymentMethods.push("YooKassa (Банковские карты, СБП и др.)");
    if (publicConfig.yoomoneyEnabled) paymentMethods.push("YooMoney (Кошелек, Карты)");
    if (publicConfig.cryptopayEnabled) paymentMethods.push("Crypto Pay (Криптовалюта в Telegram)");
    if (publicConfig.heleketEnabled) paymentMethods.push("Heleket (Криптовалюта)");
    if ((publicConfig as { rollypayEnabled?: boolean }).rollypayEnabled) paymentMethods.push("RollyPay (СБП, карты, крипта)");
    if (publicConfig.plategaMethods && publicConfig.plategaMethods.length > 0) {
      paymentMethods.push("Platega (" + publicConfig.plategaMethods.map(m => m.label).join(", ") + ")");
    }

    let paymentContext = "\n\nДОСТУПНЫЕ СПОСОБЫ ОПЛАТЫ НА САЙТЕ:\n";
    if (paymentMethods.length > 0) {
      paymentContext += "Пользователь может оплатить следующими способами:\n- " + paymentMethods.join("\n- ") + "\nЕсли спрашивают как оплатить, перечисли ТОЛЬКО эти способы. Не выдумывай Сбербанк Онлайн, QIWI, WebMoney, PayPal и т.д., если их нет в списке.\n";
    } else {
      paymentContext += "В данный момент на сайте не настроено автоматических способов оплаты.\n";
    }

    const instructionsContext = `\n\nИНСТРУКЦИЯ ПО ПОДКЛЮЧЕНИЮ:
Если пользователь спрашивает, как подключиться или настроить VPN, отвечай СТРОГО по следующему алгоритму (не придумывай свои методы):
1. В личном кабинете на сайте нажать кнопку "Подключить VPN".
2. Выбрать свою платформу и скачать предложенное приложение.
3. Вернуться на сайт и нажать кнопку "Добавить подписку" (оная автоматически добавит конфигурацию в приложение) либо отсканировать QR-код.

ПРАВИЛА ОТВЕТА О ЛИМИТАХ И ТАРИФАХ:
Если пользователь спрашивает "какой у меня тариф", "сколько осталось дней", "какой лимит трафика", "сколько устройств", "какой у меня баланс" и т.д., ВСЕГДА используй данные из блока "ИНФОРМАЦИЯ О ТЕКУЩЕМ ПОЛЬЗОВАТЕЛЕ" ниже. НИКОГДА не говори, что ты не можешь найти информацию. Просто прочитай её из блока и ответь пользователю.\n`;

    let userInfoContext = "\n\nИНФОРМАЦИЯ О ТЕКУЩЕМ ПОЛЬЗОВАТЕЛЕ:\nИспользуй эти данные, если пользователь спрашивает про свои текущие подписки или лимиты. Если написано, что чего-то нет, прямо скажи пользователю, что у него этого нет.\n";
    try {
      const dbClient = await prisma.client.findUnique({
        where: { id: client.id },
        include: {
          proxySlots: { where: { status: 'ACTIVE' }, include: { proxyTariff: true } },
          singboxSlots: { where: { status: 'ACTIVE' }, include: { singboxTariff: true } }
        }
      });
      
      userInfoContext += `- Баланс: ${dbClient?.balance || 0} ${(dbClient?.preferredCurrency || 'usd').toUpperCase()}\n`;

      let vpnInfo = "У пользователя НЕТ активной подписки VPN";
      if (client.remnawaveUuid) {
        const u = await remnaGetUser(client.remnawaveUuid);
        if (u && !u.error && u.data) {
          const exp = extractCurrentExpireAt(u.data);
          if (exp && exp > new Date()) {
             const resp = ((u.data as any).response ?? (u.data as any).data ?? u.data) as any;
             const tLimitRaw = resp?.trafficLimitBytes ?? resp?.trafficLimit;
             const tLimit = (tLimitRaw != null && tLimitRaw > 0) ? (Number(tLimitRaw) / 1024**3).toFixed(2) + " GB" : "Безлимит";
             const tUsedRaw = resp?.trafficUsedBytes ?? resp?.trafficUsed;
             const tUsed = tUsedRaw != null ? (Number(tUsedRaw) / 1024**3).toFixed(2) + " GB" : "0 GB";
             const dLimitRaw = resp?.hwidDeviceLimit ?? resp?.deviceLimit;
             const dLimit = (dLimitRaw != null && dLimitRaw > 0) ? dLimitRaw : "Безлимит";
             vpnInfo = `Активна до ${exp.toISOString().split('T')[0]}, Трафик: ${tUsed} / ${tLimit}, Лимит устройств: ${dLimit}`;
          }
        }
      }
      userInfoContext += `- VPN: ${vpnInfo}\n`;
      
      if (dbClient?.proxySlots?.length) {
        userInfoContext += `- Прокси: ${dbClient.proxySlots.map((s: any) => `${s.proxyTariff?.name || 'Слот'} (до ${s.expiresAt.toISOString().split('T')[0]})`).join(', ')}\n`;
      } else {
        userInfoContext += `- Прокси: У пользователя НЕТ прокси\n`;
      }
      
      if (dbClient?.singboxSlots?.length) {
        userInfoContext += `- Sing-box: ${dbClient.singboxSlots.map((s: any) => `${s.singboxTariff?.name || 'Слот'} (до ${s.expiresAt.toISOString().split('T')[0]})`).join(', ')}\n`;
      } else {
        userInfoContext += `- Sing-box: У пользователя НЕТ подписок Sing-box\n`;
      }
    } catch (e) {
      console.error("[ai/chat] Error fetching user info:", e);
    }

    const systemPrompt = systemPromptText + tariffsContext + paymentContext + instructionsContext + userInfoContext;

    const messages = [
      { role: "system", content: systemPrompt },
      ...parsed.data.messages
    ];

    let lastErrorDetails = "";
    let lastStatus = 500;

    const { proxyFetch } = await import("../proxy-util/proxy-fetch.js");
    const { getProxyUrl } = await import("../proxy-util/get-proxy-url.js");
    const aiProxy = await getProxyUrl("ai");

    for (const model of modelsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const groqRes = await proxyFetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.5,
            max_tokens: 1024,
          }),
          signal: controller.signal,
        }, aiProxy);
        
        clearTimeout(timeoutId);

        if (groqRes.ok) {
          const data = await groqRes.json() as any;
          const reply = data.choices?.[0]?.message?.content || "Не удалось получить ответ.";
          return res.json({ reply });
        }

        // Если ошибка (например, 429 Rate Limit), пробуем следующую модель
        const errText = await groqRes.text().catch(() => "");
        console.error(`[ai/chat] Groq error (model: ${model}):`, groqRes.status, errText);
        lastStatus = groqRes.status;
        lastErrorDetails = errText;
        
        // Если это не 429 Rate Limit или 5xx, возможно стоит прервать, но лучше попробовать следующую
      } catch (err) {
        console.error(`[ai/chat] Network/Abort error with model ${model}:`, err);
        lastErrorDetails = err instanceof Error ? err.message : String(err);
      }
    }

    // Если все модели не сработали
    return res.status(502).json({ message: "Ошибка сервиса AI или превышены лимиты", details: lastErrorDetails });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai/chat]", message, err);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

clientRouter.use(clientTicketsRouter);

export { publicConfigRouter } from "./client-public.routes.js";
