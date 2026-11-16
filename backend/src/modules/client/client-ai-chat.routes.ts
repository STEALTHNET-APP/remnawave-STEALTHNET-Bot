import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getSystemConfig, getPublicConfig } from "./client.service.js";
import { remnaGetUser } from "../remna/remna.client.js";
import { extractCurrentExpireAt } from "./client-trials-promo.routes.js";
import { AiProviderError, resolveAiConfig, sendAiChatRequest, type AiChatMessage } from "../ai/ai-provider.service.js";

export const clientAiChatRouter = Router();

const aiChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string()
  })).max(50),
});

clientAiChatRouter.post("/ai/chat", async (req, res) => {
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

    const aiConfig = resolveAiConfig(config);
    if (!aiConfig.apiKey || (aiConfig.provider === "custom" && !aiConfig.baseUrl)) {
      // Заглушка, если AI-провайдер не настроен
      return res.json({
        reply: "Извините, AI-ассистент пока не настроен. Пожалуйста, обратитесь в поддержку или настройте AI-провайдера в админ-панели."
      });
    }

    const modelsToTry = [aiConfig.model, ...aiConfig.fallbackModels];

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

    const messages: AiChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...parsed.data.messages
    ];

    const { getProxyUrl } = await import("../proxy-util/get-proxy-url.js");
    const aiProxy = await getProxyUrl("ai");

    try {
      const result = await sendAiChatRequest({
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        baseUrl: aiConfig.baseUrl,
        modelsToTry,
        messages,
        aiProxy,
      });
      return res.json({ reply: result.reply });
    } catch (err) {
      if (err instanceof AiProviderError) {
        console.error(`[ai/chat] ${aiConfig.provider} failed:`, err.status);
        return res.status(502).json({ message: err.message });
      }
      throw err;
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai/chat]", message, err);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});
