import { Composer } from "grammy";
import type { Context } from "grammy";
import * as api from "../api.js";
import { escapeHtml } from "../html.js";
import { BroadcastPayload, awaitingAdminBalance, awaitingAdminSearch, awaitingBroadcastMessage, clearUserState, lastAdminSearch, lastBroadcastMessage, lastSquadsForAdd, lastSquadsForRemove } from "../state-store.js";
import { editMessageContent, formatMoney, textInputUserId } from "./shared.js";
import type { InlineMarkup } from "./shared.js";
import { resolveCallbackDomain } from "./routing.js";

export function createAdminHandlers(): Composer<Context> {
  const composer = new Composer<Context>();

  composer.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from?.id;
    if (!userId) return;
    if (resolveCallbackDomain(data) !== "admin") return next();
    try {
  if (data.startsWith("admin:")) {
    const config = await api.getPublicConfig();
    if (!config?.botAdminTelegramIds?.includes(String(userId))) {
      await ctx.answerCallbackQuery({ text: "Доступ запрещён", show_alert: true }).catch(() => {});
      return;
    }
    if (data === "admin:menu") {
      clearUserState(userId);
      const markup: InlineMarkup = {
        inline_keyboard: [
          [{ text: "📊 Статистика", callback_data: "admin:stats" }],
          [{ text: "🔔 Уведомления", callback_data: "admin:notifications" }],
          [{ text: "👥 Клиенты", callback_data: "admin:clients:1" }],
          [{ text: "🔍 Поиск пользователя", callback_data: "admin:search" }],
          [
            { text: "💳 Ожидают оплаты", callback_data: "admin:payments:pending:1" },
            { text: "💰 Последние платежи", callback_data: "admin:payments:paid:1" },
          ],
          [{ text: "📢 Рассылка", callback_data: "admin:broadcast" }],
          [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
        ],
      };
      await editMessageContent(ctx, "⚙️ Панель админа\n\nВыберите раздел:", markup);
      return;
    }
    if (data === "admin:notifications") {
      const settings = await api.getBotAdminNotificationSettings(userId);
      const s = settings;
      const yesNo = (v: boolean) => (v ? "Вкл" : "Выкл");
      const text =
        "🔔 Настройки уведомлений\n\n" +
        `Пополнение баланса: ${yesNo(s.notifyBalanceTopup)}\n` +
        `Оплата тарифов: ${yesNo(s.notifyTariffPayment)}\n` +
        `Новые клиенты: ${yesNo(s.notifyNewClient)}\n` +
        `Новые тикеты: ${yesNo(s.notifyNewTicket)}\n\n` +
        "Нажмите на пункт ниже, чтобы переключить.";
      const markup: InlineMarkup = {
        inline_keyboard: [
          [{ text: `💰 Пополнение баланса: ${yesNo(s.notifyBalanceTopup)}`, callback_data: "admin:notif:balance" }],
          [{ text: `📦 Оплата тарифов: ${yesNo(s.notifyTariffPayment)}`, callback_data: "admin:notif:tariff" }],
          [{ text: `👤 Новые клиенты: ${yesNo(s.notifyNewClient)}`, callback_data: "admin:notif:newclient" }],
          [{ text: `🎫 Новые тикеты: ${yesNo(s.notifyNewTicket)}`, callback_data: "admin:notif:newticket" }],
          [{ text: "◀️ В админку", callback_data: "admin:menu" }],
        ],
      };
      await editMessageContent(ctx, text, markup);
      return;
    }
    if (data.startsWith("admin:notif:")) {
      const kind = data.slice("admin:notif:".length);
      const current = await api.getBotAdminNotificationSettings(userId);
      const payload: Partial<api.BotAdminNotificationSettings> = {};
      if (kind === "balance") {
        payload.notifyBalanceTopup = !current.notifyBalanceTopup;
      } else if (kind === "tariff") {
        payload.notifyTariffPayment = !current.notifyTariffPayment;
      } else if (kind === "newclient") {
        payload.notifyNewClient = !current.notifyNewClient;
      } else if (kind === "newticket") {
        payload.notifyNewTicket = !current.notifyNewTicket;
      }
      const updated = await api.patchBotAdminNotificationSettings(userId, payload);
      const s = updated;
      const yesNo = (v: boolean) => (v ? "Вкл" : "Выкл");
      const text =
        "🔔 Настройки уведомлений\n\n" +
        `Пополнение баланса: ${yesNo(s.notifyBalanceTopup)}\n` +
        `Оплата тарифов: ${yesNo(s.notifyTariffPayment)}\n` +
        `Новые клиенты: ${yesNo(s.notifyNewClient)}\n` +
        `Новые тикеты: ${yesNo(s.notifyNewTicket)}\n\n` +
        "Нажмите на пункт ниже, чтобы переключить.";
      const markup: InlineMarkup = {
        inline_keyboard: [
          [{ text: `💰 Пополнение баланса: ${yesNo(s.notifyBalanceTopup)}`, callback_data: "admin:notif:balance" }],
          [{ text: `📦 Оплата тарифов: ${yesNo(s.notifyTariffPayment)}`, callback_data: "admin:notif:tariff" }],
          [{ text: `👤 Новые клиенты: ${yesNo(s.notifyNewClient)}`, callback_data: "admin:notif:newclient" }],
          [{ text: `🎫 Новые тикеты: ${yesNo(s.notifyNewTicket)}`, callback_data: "admin:notif:newticket" }],
          [{ text: "◀️ В админку", callback_data: "admin:menu" }],
        ],
      };
      await editMessageContent(ctx, text, markup);
      return;
    }
    if (data === "admin:search") {
      awaitingAdminSearch.add(userId);
      await editMessageContent(
        ctx,
        "🔍 Поиск пользователя\n\nВведите Telegram ID, @username или email:",
        { inline_keyboard: [[{ text: "◀️ Отмена", callback_data: "admin:menu" }]] }
      );
      return;
    }
    if (data === "admin:stats") {
      const stats = await api.getBotAdminStats(userId);
      const u = stats.users;
      const s = stats.sales;
      const text =
        `📊 Статистика\n\n👥 Пользователи: ${u.total}\nС Remna: ${u.withRemna}\nНовых за 7 дн.: ${u.newLast7Days}\nНовых за 30 дн.: ${u.newLast30Days}\n\n` +
        `💰 Продажи (всего): ${s.totalAmount} ₽ (${s.totalCount})\nЗа 7 дн.: ${s.last7DaysAmount} ₽ (${s.last7DaysCount})\nЗа 30 дн.: ${s.last30DaysAmount} ₽ (${s.last30DaysCount})`;
      const back: InlineMarkup = { inline_keyboard: [[{ text: "◀️ В админку", callback_data: "admin:menu" }]] };
      await editMessageContent(ctx, text, back);
      return;
    }
    if (data.startsWith("admin:clients:")) {
      const suffix = data.slice("admin:clients:".length);
      if (suffix === "clear") {
        lastAdminSearch.delete(userId);
        // Показать первую страницу без поиска
        const { items, total, limit } = await api.getBotAdminClients(userId, 1);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        let msg = `👥 Клиенты (${total})\n\n`;
        items.forEach((c, i) => {
          const label = c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8);
          msg += `${i + 1}. ${label} ${c.isBlocked ? "🚫" : ""}\n`;
        });
        msg += `\nСтр. 1/${totalPages}`;
        const rows: InlineMarkup["inline_keyboard"] = [];
        items.forEach((c) => {
          rows.push([
            {
              text: `${c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8)} ${c.isBlocked ? "🚫" : ""}`,
              callback_data: `admin:client:${c.id}`,
            },
          ]);
        });
        const nav: InlineMarkup["inline_keyboard"][0] = [];
        nav.push({ text: "◀️ В админку", callback_data: "admin:menu" });
        if (totalPages > 1) nav.push({ text: "Вперёд ▶", callback_data: "admin:clients:2" });
        rows.push(nav);
        await editMessageContent(ctx, msg, { inline_keyboard: rows });
        return;
      }
      const page = parseInt(suffix, 10) || 1;
      const search = lastAdminSearch.get(userId);
      const { items, total, limit } = await api.getBotAdminClients(userId, page, search);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      let msg = search ? `👥 Поиск «${search}» (${total})\n\n` : `👥 Клиенты (${total})\n\n`;
      items.forEach((c, i) => {
        const label = c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8);
        msg += `${(page - 1) * limit + i + 1}. ${label} ${c.isBlocked ? "🚫" : ""}\n`;
      });
      msg += `\nСтр. ${page}/${totalPages}`;
      const rows: InlineMarkup["inline_keyboard"] = [];
      items.forEach((c) => {
        rows.push([
          {
            text: `${c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8)} ${c.isBlocked ? "🚫" : ""}`,
            callback_data: `admin:client:${c.id}`,
          },
        ]);
      });
      const nav: InlineMarkup["inline_keyboard"][0] = [];
      if (page > 1) nav.push({ text: "◀ Назад", callback_data: `admin:clients:${page - 1}` });
      nav.push({ text: "◀️ В админку", callback_data: "admin:menu" });
      if (search) nav.push({ text: "✖ Сбросить поиск", callback_data: "admin:clients:clear" });
      if (page < totalPages) nav.push({ text: "Вперёд ▶", callback_data: `admin:clients:${page + 1}` });
      rows.push(nav);
      await editMessageContent(ctx, msg, { inline_keyboard: rows });
      return;
    }
    if (data.startsWith("admin:client:")) {
      const clientId = data.slice("admin:client:".length);
      if (!clientId) return;
      const client = await api.getBotAdminClient(userId, clientId);
      const created = client.createdAt ? new Date(client.createdAt).toLocaleString("ru-RU") : "—";
      let text = `👤 ${client.email || client.telegramUsername || client.telegramId || client.id}\n\n`;
      text += `ID: ${client.id}\nБаланс: ${formatMoney(client.balance ?? 0, client.preferredCurrency ?? "RUB")}\nРефералов: ${client._count?.referrals ?? 0}\nСоздан: ${created}\n`;
      if (client.isBlocked) text += `\n🚫 Заблокирован${client.blockReason ? `: ${client.blockReason}` : ""}`;
      const kb: InlineMarkup["inline_keyboard"] = [];
      if (client.isBlocked) {
        kb.push([{ text: "✅ Разблокировать", callback_data: `admin:unblock:${client.id}` }]);
      } else {
        kb.push([{ text: "🚫 Заблокировать", callback_data: `admin:block:${client.id}` }]);
      }
      kb.push([{ text: "💵 Пополнить баланс", callback_data: `admin:balance:${client.id}` }]);
      if (client.remnawaveUuid) {
        kb.push(
          [
            { text: "🔄 Отозвать подписку", callback_data: `admin:remna:revoke:${client.id}` },
            { text: "⏸ Отключить Remna", callback_data: `admin:remna:disable:${client.id}` },
          ],
          [
            { text: "▶ Включить Remna", callback_data: `admin:remna:enable:${client.id}` },
            { text: "📊 Сбросить трафик", callback_data: `admin:remna:reset:${client.id}` },
          ],
          [
            { text: "➕ Добавить сквад", callback_data: `admin:squad:add:${client.id}` },
            { text: "➖ Убрать сквад", callback_data: `admin:squad:remove:${client.id}` },
          ]
        );
      }
      kb.push([{ text: "◀️ К списку", callback_data: "admin:clients:1" }]);
      await editMessageContent(ctx, text, { inline_keyboard: kb });
      return;
    }
    if (data.startsWith("admin:balance:")) {
      const clientId = data.slice("admin:balance:".length);
      if (!clientId) return;
      awaitingAdminBalance.set(userId, clientId);
      await editMessageContent(
        ctx,
        "💵 Пополнение баланса\n\nВведите сумму (число):",
        { inline_keyboard: [[{ text: "◀️ Отмена", callback_data: "admin:menu" }]] }
      );
      return;
    }
    if (data.startsWith("admin:remna:revoke:")) {
      const clientId = data.slice("admin:remna:revoke:".length);
      if (!clientId) return;
      try {
        await api.postBotAdminClientRemnaRevoke(userId, clientId);
        await editMessageContent(ctx, `✅ Подписка Remna отозвана для клиента.`, {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:remna:disable:")) {
      const clientId = data.slice("admin:remna:disable:".length);
      if (!clientId) return;
      try {
        await api.postBotAdminClientRemnaDisable(userId, clientId);
        await editMessageContent(ctx, "✅ Пользователь отключён в Remna.", {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:remna:enable:")) {
      const clientId = data.slice("admin:remna:enable:".length);
      if (!clientId) return;
      try {
        await api.postBotAdminClientRemnaEnable(userId, clientId);
        await editMessageContent(ctx, "✅ Пользователь включён в Remna.", {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:remna:reset:")) {
      const clientId = data.slice("admin:remna:reset:".length);
      if (!clientId) return;
      try {
        await api.postBotAdminClientRemnaResetTraffic(userId, clientId);
        await editMessageContent(ctx, "✅ Трафик сброшен.", {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:squad:add:")) {
      const rest = data.slice("admin:squad:add:".length);
      const parts = rest.split(":");
      const clientId = parts[0];
      const indexStr = parts[1];
      if (!clientId) return;
      if (indexStr !== undefined) {
        const index = parseInt(indexStr, 10);
        const stored = lastSquadsForAdd.get(userId);
        if (!stored || index < 0 || index >= stored.items.length) {
          await editMessageContent(ctx, "Сессия истекла или сквад не найден. Вернитесь к клиенту.", {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
          return;
        }
        const squadUuid = stored.items[index]!.uuid;
        try {
          await api.postBotAdminClientRemnaSquadAdd(userId, clientId, squadUuid);
          lastSquadsForAdd.delete(userId);
          await editMessageContent(ctx, `✅ Сквад «${stored.items[index]!.name}» добавлен.`, {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
        } catch (e: unknown) {
          await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
            inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:squad:add:${clientId}` }]],
          });
        }
        return;
      }
      try {
        const { items } = await api.getBotAdminRemnaSquadsInternal(userId);
        if (!items.length) {
          await editMessageContent(ctx, "Нет доступных сквадов в Remna.", {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
          return;
        }
        lastSquadsForAdd.set(userId, { clientId, items });
        const rows: InlineMarkup["inline_keyboard"] = items.slice(0, 15).map((s, i) => [
          { text: `➕ ${s.name || s.uuid.slice(0, 8)}`, callback_data: `admin:squad:add:${clientId}:${i}` },
        ]);
        rows.push([{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]);
        await editMessageContent(ctx, "Выберите сквад для добавления:", { inline_keyboard: rows });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:squad:remove:")) {
      const rest = data.slice("admin:squad:remove:".length);
      const parts = rest.split(":");
      const clientId = parts[0];
      const indexStr = parts[1];
      if (!clientId) return;
      if (indexStr !== undefined) {
        const index = parseInt(indexStr, 10);
        const stored = lastSquadsForRemove.get(userId);
        if (!stored || index < 0 || index >= stored.items.length) {
          await editMessageContent(ctx, "Сессия истекла или сквад не найден. Вернитесь к клиенту.", {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
          return;
        }
        const squadUuid = stored.items[index]!.uuid;
        try {
          await api.postBotAdminClientRemnaSquadRemove(userId, clientId, squadUuid);
          lastSquadsForRemove.delete(userId);
          await editMessageContent(ctx, `✅ Сквад «${stored.items[index]!.name}» убран.`, {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
        } catch (e: unknown) {
          await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
            inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:squad:remove:${clientId}` }]],
          });
        }
        return;
      }
      try {
        const remna = await api.getBotAdminClientRemna(userId, clientId);
        const allSquads = await api.getBotAdminRemnaSquadsInternal(userId);
        const uuidToName = new Map(allSquads.items.map((s) => [s.uuid, s.name || s.uuid.slice(0, 8)]));
        const current = remna.activeInternalSquads.map((uuid) => ({ uuid, name: uuidToName.get(uuid) ?? uuid.slice(0, 8) }));
        if (!current.length) {
          await editMessageContent(ctx, "У пользователя нет сквадов.", {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
          return;
        }
        lastSquadsForRemove.set(userId, { clientId, items: current });
        const rows: InlineMarkup["inline_keyboard"] = current.slice(0, 15).map((s, i) => [
          { text: `➖ ${s.name}`, callback_data: `admin:squad:remove:${clientId}:${i}` },
        ]);
        rows.push([{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]);
        await editMessageContent(ctx, "Выберите сквад для удаления у пользователя:", { inline_keyboard: rows });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:payments:")) {
      const rest = data.slice("admin:payments:".length);
      const [status, pageStr] = rest.split(":");
      const page = parseInt(pageStr ?? "1", 10) || 1;
      const isPending = status === "pending";
      const { items, total, limit } = await api.getBotAdminPayments(userId, isPending ? "PENDING" : "PAID", page);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const title = isPending ? `💳 Ожидают оплаты (${total})` : `💰 Последние платежи (${total})`;
      let msg = `${title}\n\n`;
      const rows: InlineMarkup["inline_keyboard"] = [];
      items.forEach((p, i) => {
        const label = `${p.amount} ${p.currency} — ${p.clientTelegramUsername || p.clientEmail || p.clientTelegramId || "—"}`;
        msg += `${(page - 1) * limit + i + 1}. ${label}\n`;
        if (isPending) {
          rows.push([{ text: `✅ ${p.amount} ${p.currency} — отметить оплаченным`, callback_data: `admin:pay:${p.id}` }]);
        }
      });
      msg += `\nСтр. ${page}/${totalPages}`;
      const nav: InlineMarkup["inline_keyboard"][0] = [];
      if (page > 1) nav.push({ text: "◀ Назад", callback_data: `admin:payments:${status}:${page - 1}` });
      nav.push({ text: "◀️ В админку", callback_data: "admin:menu" });
      if (page < totalPages) nav.push({ text: "Вперёд ▶", callback_data: `admin:payments:${status}:${page + 1}` });
      rows.push(nav);
      await editMessageContent(ctx, msg, { inline_keyboard: rows });
      return;
    }
    if (data.startsWith("admin:pay:")) {
      const paymentId = data.slice("admin:pay:".length);
      if (!paymentId) return;
      try {
        await api.patchBotAdminPaymentMarkPaid(userId, paymentId);
        await editMessageContent(ctx, "✅ Платёж отмечен как оплаченный.", {
          inline_keyboard: [[{ text: "◀️ К платежам", callback_data: "admin:payments:pending:1" }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ Назад", callback_data: "admin:payments:pending:1" }]],
        });
      }
      return;
    }
    if (data === "admin:broadcast") {
      const counts = await api.getBotAdminBroadcastCount(userId);
      awaitingBroadcastMessage.add(userId);
      await editMessageContent(
        ctx,
        `📢 Рассылка\n\nСейчас: Telegram ${counts.withTelegram}, Email ${counts.withEmail}\n\nОтправьте текст сообщения или фото с подписью (caption):`,
        { inline_keyboard: [[{ text: "◀️ Отмена", callback_data: "admin:menu" }]] }
      );
      return;
    }
    if (data.startsWith("admin:bc:")) {
      const channel = data.slice("admin:bc:".length) as "tg" | "email" | "both";
      const raw = lastBroadcastMessage.get(userId);
      if (raw == null) {
        await editMessageContent(ctx, "Текст рассылки не найден. Начните заново.", {
          inline_keyboard: [[{ text: "◀️ В админку", callback_data: "admin:menu" }]],
        });
        return;
      }
      const msg: BroadcastPayload = typeof raw === "string" ? { text: raw } : raw;
      const ch: "telegram" | "email" | "both" = channel === "tg" ? "telegram" : channel === "email" ? "email" : "both";
      const channelLabel = ch === "telegram" ? "Telegram" : ch === "email" ? "Email" : "Telegram и Email";
      // Сразу показываем, что рассылка запущена, чтобы было понятно и не нажимали повторно
      await editMessageContent(ctx, `📢 Рассылка по каналу «${channelLabel}» запущена, подождите…`, {
        inline_keyboard: [[{ text: "◀️ В админку", callback_data: "admin:menu" }]],
      });
      lastBroadcastMessage.delete(userId);
      try {
        const result = await api.postBotAdminBroadcast(userId, msg.text, ch, msg.photoFileId, msg.buttonText, msg.buttonUrl);
        const text = `✅ Рассылка завершена.\n\nTelegram: отправлено ${result.sentTelegram}, ошибок ${result.failedTelegram}\nEmail: отправлено ${result.sentEmail}, ошибок ${result.failedEmail}${result.errors?.length ? "\n\nОшибки: " + result.errors.slice(0, 3).join("; ") : ""}`;
        await editMessageContent(ctx, text, {
          inline_keyboard: [[{ text: "◀️ В админку", callback_data: "admin:menu" }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ В админку", callback_data: "admin:menu" }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:block:")) {
      const clientId = data.slice("admin:block:".length);
      if (!clientId) return;
      await api.patchBotAdminClientBlock(userId, clientId, true);
      const client = await api.getBotAdminClient(userId, clientId);
      const created = client.createdAt ? new Date(client.createdAt).toLocaleString("ru-RU") : "—";
      let text = `👤 ${client.email || client.telegramUsername || client.telegramId || client.id}\n\nID: ${client.id}\nБаланс: ${formatMoney(client.balance ?? 0, client.preferredCurrency ?? "RUB")}\nРефералов: ${client._count?.referrals ?? 0}\nСоздан: ${created}\n\n🚫 Заблокирован`;
      const kb: InlineMarkup["inline_keyboard"] = [
        [{ text: "✅ Разблокировать", callback_data: `admin:unblock:${client.id}` }],
        [{ text: "◀️ К списку", callback_data: "admin:clients:1" }],
      ];
      await editMessageContent(ctx, text, { inline_keyboard: kb });
      return;
    }
    if (data.startsWith("admin:unblock:")) {
      const clientId = data.slice("admin:unblock:".length);
      if (!clientId) return;
      await api.patchBotAdminClientBlock(userId, clientId, false);
      const client = await api.getBotAdminClient(userId, clientId);
      const created = client.createdAt ? new Date(client.createdAt).toLocaleString("ru-RU") : "—";
      let text = `👤 ${client.email || client.telegramUsername || client.telegramId || client.id}\n\nID: ${client.id}\nБаланс: ${formatMoney(client.balance ?? 0, client.preferredCurrency ?? "RUB")}\nРефералов: ${client._count?.referrals ?? 0}\nСоздан: ${created}`;
      const kb: InlineMarkup["inline_keyboard"] = [
        [{ text: "🚫 Заблокировать", callback_data: `admin:block:${client.id}` }],
        [{ text: "◀️ К списку", callback_data: "admin:clients:1" }],
      ];
      await editMessageContent(ctx, text, { inline_keyboard: kb });
      return;
    }
    return;
  }
      return next();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      await ctx.reply(`❌ ${msg}`).catch(() => {});
    }
  });

  composer.on("message:video", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const config = await api.getPublicConfig();
  const isAdmin = config?.botAdminTelegramIds?.includes(String(userId)) ?? false;
  if (!isAdmin) return;
  const fileId = ctx.message.video.file_id;
  await ctx.reply(
    `📹 <b>file_id видео:</b>\n<code>${escapeHtml(fileId)}</code>\n\nСкопируйте и вставьте в админку при добавлении видео-инструкции.`,
    { parse_mode: "HTML" }
  );
  });

  composer.on("message:photo", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  if (!awaitingBroadcastMessage.has(userId)) return;
  awaitingBroadcastMessage.delete(userId);
  const config = await api.getPublicConfig();
  if (!config?.botAdminTelegramIds?.includes(String(userId))) {
    await ctx.reply("Доступ запрещён.");
    return;
  }
  const photos = ctx.message.photo;
  if (!photos?.length) {
    await ctx.reply("Фото не получено. Отправьте фото с подписью или текст.");
    return;
  }
  const largest = photos[photos.length - 1];
  const caption = ctx.message.caption?.trim() ?? "";
  // Парсим кнопку вида [Текст кнопки](URL) из подписи
  const btnMatch = caption.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
  const buttonText = btnMatch?.[1];
  const buttonUrl = btnMatch?.[2];
  const cleanCaption = btnMatch ? caption.replace(btnMatch[0], "").trim() : caption;
  lastBroadcastMessage.set(userId, { text: cleanCaption || caption, photoFileId: largest.file_id, buttonText, buttonUrl });
  await ctx.reply("Кому отправить?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📱 Только Telegram", callback_data: "admin:bc:tg" },
          { text: "📧 Только Email", callback_data: "admin:bc:email" },
        ],
        [{ text: "📱+📧 Telegram и Email", callback_data: "admin:bc:both" }],
        [{ text: "◀️ Отмена", callback_data: "admin:menu" }],
      ],
    },
  });
  });

  composer.on("message:text", async (ctx, next) => {
    const userId = textInputUserId(ctx);
    if (!userId) return next();
    if (!awaitingBroadcastMessage.has(userId) && !awaitingAdminBalance.has(userId) && !awaitingAdminSearch.has(userId)) return next();

  if (awaitingBroadcastMessage.has(userId)) {
    awaitingBroadcastMessage.delete(userId);
    const config = await api.getPublicConfig();
    if (!config?.botAdminTelegramIds?.includes(String(userId))) {
      await ctx.reply("Доступ запрещён.");
      return;
    }
    const text = ctx.message.text?.trim() ?? "";
    if (!text) {
      await ctx.reply("Введите непустой текст сообщения.");
      return;
    }
    // Парсим кнопку вида [Текст кнопки](URL) из текста
    const btnMatch = text.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    const buttonText = btnMatch?.[1];
    const buttonUrl = btnMatch?.[2];
    const cleanText = btnMatch ? text.replace(btnMatch[0], "").trim() : text;
    lastBroadcastMessage.set(userId, { text: cleanText || text, buttonText, buttonUrl });
    await ctx.reply("Кому отправить?", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📱 Только Telegram", callback_data: "admin:bc:tg" },
            { text: "📧 Только Email", callback_data: "admin:bc:email" },
          ],
          [{ text: "📱+📧 Telegram и Email", callback_data: "admin:bc:both" }],
          [{ text: "◀️ Отмена", callback_data: "admin:menu" }],
        ],
      },
    });
    return;
  }

  // Админ: ввод суммы пополнения баланса
  if (awaitingAdminBalance.has(userId)) {
    const clientId = awaitingAdminBalance.get(userId);
    awaitingAdminBalance.delete(userId);
    const config = await api.getPublicConfig();
    if (!config?.botAdminTelegramIds?.includes(String(userId)) || !clientId) {
      await ctx.reply("Доступ запрещён или сессия истекла.");
      return;
    }
    const num = Number(ctx.message.text?.replace(/,/, "."));
    if (!Number.isFinite(num) || num <= 0 || num > 1000000) {
      await ctx.reply("Введите положительное число (до 1 000 000).");
      return;
    }
    try {
      const result = await api.patchBotAdminClientBalance(userId, clientId, num);
      await ctx.reply(`✅ Баланс пополнен. Новый баланс: ${formatMoney(result.newBalance, "RUB")}`);
    } catch (e: unknown) {
      await ctx.reply(`❌ ${e instanceof Error ? e.message : "Ошибка"}`);
    }
    return;
  }

  // Админ: ввод поиска (Telegram ID, @username, email)
  if (awaitingAdminSearch.has(userId)) {
    awaitingAdminSearch.delete(userId);
    const config = await api.getPublicConfig();
    if (!config?.botAdminTelegramIds?.includes(String(userId))) {
      await ctx.reply("Доступ запрещён.");
      return;
    }
    const searchQuery = ctx.message.text?.trim() ?? "";
    lastAdminSearch.set(userId, searchQuery);
    try {
      const { items, total, limit } = await api.getBotAdminClients(userId, 1, searchQuery || undefined);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const msg =
        (searchQuery ? `👥 Поиск «${searchQuery}» (${total})\n\n` : `👥 Клиенты (${total})\n\n`) +
        items
          .map(
            (c, i) =>
              `${i + 1}. ${c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8)} ${c.isBlocked ? "🚫" : ""}`
          )
          .join("\n") +
        `\n\nСтр. 1/${totalPages}`;
      const rows: InlineMarkup["inline_keyboard"] = items.map((c) => [
        {
          text: `${c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8)} ${c.isBlocked ? "🚫" : ""}`,
          callback_data: `admin:client:${c.id}`,
        },
      ]);
      const nav: InlineMarkup["inline_keyboard"][0] = [
        { text: "◀️ В админку", callback_data: "admin:menu" },
      ];
      if (searchQuery) nav.push({ text: "✖ Сбросить поиск", callback_data: "admin:clients:clear" });
      if (totalPages > 1) nav.push({ text: "Вперёд ▶", callback_data: "admin:clients:2" });
      rows.push(nav);
      await ctx.reply(msg, { reply_markup: { inline_keyboard: rows } });
    } catch (e: unknown) {
      lastAdminSearch.delete(userId);
      const errMsg = e instanceof Error ? e.message : "Ошибка поиска";
      await ctx.reply(`❌ ${errMsg}`);
    }
    return;
  }

    return next();
  });

  return composer;
}
