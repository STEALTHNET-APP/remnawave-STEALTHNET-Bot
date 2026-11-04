import "dotenv/config";
import { Bot, Composer, Context } from "grammy";
import { run, sequentialize } from "@grammyjs/runner";
import { ProxyAgent as UndiciProxyAgent } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import * as api from "./api.js";
import { createCommandSync } from "./bot-commands.js";
import { registerCloudPaymentsFlow } from "./cloudpayments-flow.js";
import { createTermsGate } from "./terms.js";
import { registerStarsPayments } from "./stars.js";
import { ignoreNotModified } from "./ignore-not-modified.js";
import { createModeController, createBotServer, createUpdateProcessor, internalBotCredential } from "./webhook-runtime.js";
import { handleStart, createStartHandlers } from "./handlers/start.js";
import { createAdminHandlers } from "./handlers/admin.js";
import { createTariffHandlers } from "./handlers/tariffs.js";
import { createSubscriptionHandlers } from "./handlers/subscriptions.js";
import { createProfileHandlers } from "./handlers/profile.js";
import { createGiftHandlers } from "./handlers/gifts.js";
import { createPaymentCustomTopupHandlers, createPaymentEmailHandlers, createPaymentHandlers, createPaymentNumericHandlers } from "./handlers/payments.js";
import { createSupportHandlers } from "./handlers/support.js";
import { getOrRestoreToken, tryAutoDeleteUnknown } from "./handlers/shared.js";
import { setTranslations } from "./i18n.js";
import { startThrottle } from "./state-store.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Set BOT_TOKEN in .env");
  process.exit(1);
}

async function waitForApi(maxRetries = 10, delayMs = 3000): Promise<Awaited<ReturnType<typeof api.getPublicConfig>>> {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      return await api.getPublicConfig();
    } catch {
      if (i < maxRetries) {
        console.log(`[Bot] API недоступен, повтор через ${delayMs / 1000}с (${i}/${maxRetries})…`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  return null;
}

async function createBotWithProxy(token: string): Promise<Bot> {
  try {
    const cfg = await waitForApi();
    if (cfg?.proxyEnabled && cfg?.proxyTelegram && cfg?.proxyUrl?.trim()) {
      const url = cfg.proxyUrl.trim();
      const lower = url.toLowerCase();
      if (lower.startsWith("http://") || lower.startsWith("https://")) {
        console.log("[Proxy] Telegram Bot API через HTTP прокси");
        return new Bot(token, {
          client: { timeoutSeconds: 15, baseFetchConfig: { dispatcher: new UndiciProxyAgent(url) } as any },
        });
      }
      if (lower.startsWith("socks5://") || lower.startsWith("socks4://") || lower.startsWith("socks://")) {
        console.log("[Proxy] Telegram Bot API через SOCKS прокси");
        const agent = new SocksProxyAgent(url);
        return new Bot(token, {
          client: { timeoutSeconds: 15, baseFetchConfig: { agent } as any },
        });
      }
      console.warn(`[Proxy] Неизвестный протокол прокси: ${url}, запуск без прокси`);
    }
  } catch {
    console.warn("[Bot] Не удалось получить конфиг, запуск без прокси");
  }
  return new Bot(token, { client: { timeoutSeconds: 15 } });
}

const composer = new Composer<Context>();

registerStarsPayments(composer);
registerCloudPaymentsFlow(composer, getOrRestoreToken);

composer.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    void ctx.answerCallbackQuery().catch(() => {});
    const config = await api.getPublicConfig().catch(() => null);
    if (!config?.maintenanceEnabled) return next();
    const message = config.maintenanceMessage || "Обновляем сервис. Пожалуйста, зайдите немного позже.";
    if (ctx.chat) await ctx.reply(message).catch(() => {});
    return;
  }
  if (ctx.message?.successful_payment || ctx.preCheckoutQuery || !ctx.message) return next();
  const config = await api.getPublicConfig().catch(() => null);
  if (!config?.maintenanceEnabled) return next();
  const message = config.maintenanceMessage || "Обновляем сервис. Пожалуйста, зайдите немного позже.";
  if (ctx.chat) await ctx.reply(message);
});

composer.use(createTermsGate(api, async (ctx, payload) => {
  if (ctx.from) startThrottle.delete(ctx.from.id);
  await handleStart(ctx, payload);
}));

composer.use(createPaymentEmailHandlers());
composer.use(createAdminHandlers());
composer.use(createStartHandlers());
composer.use(createTariffHandlers());
composer.use(createSubscriptionHandlers());
composer.use(createGiftHandlers());
composer.use(createPaymentCustomTopupHandlers());
composer.use(createProfileHandlers());
composer.use(createPaymentHandlers());
composer.use(createSupportHandlers());
composer.use(createPaymentNumericHandlers());

composer.on("callback_query:data", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Неизвестное действие" }).catch(() => {});
});

composer.on("message", async (ctx) => {
  await tryAutoDeleteUnknown(ctx);
});

await waitForApi();

const token = BOT_TOKEN.trim();
if (!token) {
  throw new Error("BOT_TOKEN не задан в env");
}

const b = await createBotWithProxy(token);
b.api.config.use(ignoreNotModified);
b.use(sequentialize((ctx) => [ctx.from?.id ? `user:${ctx.from.id}` : undefined, ctx.chat?.id ? `chat:${ctx.chat.id}` : undefined].filter((key): key is string => !!key)));
b.use(composer);
b.catch((err) => {
  const updateId = err.ctx?.update.update_id;
  const cause = err.error;
  console.error(`[Bot] Update ${updateId ?? "unknown"} processing failed`, cause instanceof Error ? cause.stack ?? cause.message : cause);
  if (err.ctx?.chat) {
    void err.ctx.reply("⚠️ Не удалось обработать запрос. Попробуйте ещё раз позже.").catch(() => {});
  }
});

await b.init();
console.log(`Bot @${b.botInfo.username ?? "?"} initialized`);

try {
  const cfg = await api.getPublicConfig();
  if (cfg?.translations) setTranslations(cfg.translations);
} catch {}

const syncCommands = createCommandSync((commands, options) => b.api.setMyCommands(commands, options));
const refreshCommands = async () => { const config = await api.getPublicConfig(true); if (config) await syncCommands(config.botCommands); };
await refreshCommands().catch(() => console.error("[Bot] Command menu update failed; retrying"));

const modeController = createModeController({
  config: () => api.getBotRuntimeConfig(),
  setWebhook: (url, secret) => b.api.setWebhook(url, {
    secret_token: secret,
    allowed_updates: ["message", "callback_query", "pre_checkout_query", "my_chat_member"],
    drop_pending_updates: false,
  }),
  deleteWebhook: () => b.api.deleteWebhook({ drop_pending_updates: false }),
  startPolling: () => {
    const runner = run(b, {
      runner: { fetch: { allowed_updates: ["message", "callback_query", "pre_checkout_query", "my_chat_member"] } },
      sink: { concurrency: 50 },
    });
    runner.task()?.catch(() => console.error("[Bot] Polling stopped; retrying on next reconciliation"));
    return runner;
  },
});

const internalServer = createBotServer({
  credential: internalBotCredential(token),
  mode: modeController.mode,
  reload: () => modeController.reload(),
  process: createUpdateProcessor(update => b.handleUpdate(update)),
});
const internalPort = Number(process.env.BOT_INTERNAL_PORT) || 8080;
internalServer.listen(internalPort, "0.0.0.0");
await modeController.reload().catch(() => console.error("[Bot] Delivery mode not confirmed; retrying"));
const modeTimer = setInterval(() => {
  void refreshCommands().catch(() => console.error("[Bot] Command menu update failed"));
  void modeController.reload().catch(() => console.error("[Bot] Delivery mode reconciliation failed"));
}, 30_000);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  clearInterval(modeTimer);
  const deadline = setTimeout(() => process.exit(1), 30_000);
  deadline.unref();
  internalServer.close(() => { void modeController.stop().finally(() => process.exit(0)); });
});
