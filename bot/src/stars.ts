import type { Composer, Context } from "grammy";
import { getPublicConfig, starsCheckout, starsPaid, starsRefunded } from "./api.js";

export function registerStarsPayments(composer: Composer<Context>) {
  composer.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    if (!query.invoice_payload.startsWith("snstars:")) {
      await ctx.answerPreCheckoutQuery(false, { error_message: "Неизвестный счёт" });
      return;
    }
    try {
      await starsCheckout({ checkoutId: query.id, paymentId: query.invoice_payload.slice(8), telegramId: String(query.from.id), currency: query.currency, totalAmount: query.total_amount });
      await ctx.answerPreCheckoutQuery(true);
    } catch {
      await ctx.answerPreCheckoutQuery(false, { error_message: "Не удалось подтвердить счёт. Проверьте аккаунт и создайте новый платёж." });
    }
  });
  composer.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    if (payment.currency !== "XTR" || !payment.invoice_payload.startsWith("snstars:")) return;
    try {
      const result = await starsPaid({ paymentId: payment.invoice_payload.slice(8), telegramId: String(ctx.from.id), currency: payment.currency, totalAmount: payment.total_amount, chargeId: payment.telegram_payment_charge_id });
      await ctx.reply(result.delivery === "delivered" ? "✅ Оплата Stars получена. Покупка доступна в меню /start." : "Оплата Stars получена. Выдача обрабатывается; если покупка не появилась, напишите /paysupport.");
    } catch {
      await ctx.reply("Оплата Stars получена Telegram. Проверяем зачисление. Если покупка не появилась, напишите /paysupport.").catch(() => {});
    }
  });
  composer.on("message:refunded_payment", async (ctx) => {
    const payment = ctx.message.refunded_payment;
    if (payment.currency !== "XTR" || !payment.invoice_payload.startsWith("snstars:")) return;
    await starsRefunded({ paymentId: payment.invoice_payload.slice(8), telegramId: String(ctx.chat.id), currency: payment.currency, totalAmount: payment.total_amount, chargeId: payment.telegram_payment_charge_id }).catch(() => {});
  });
  composer.command("paysupport", async (ctx) => {
    const config = await getPublicConfig().catch(() => null);
    const link = config?.supportLink?.trim();
    await ctx.reply("По вопросам оплаты и возврата Stars обратитесь в поддержку сервиса. Укажите номер платежа из чека Telegram. Telegram не обрабатывает обращения по покупкам у нашего бота.", {
      reply_markup: { inline_keyboard: [[link ? { text: "Поддержка", url: link } : { text: "Поддержка", callback_data: "menu:support" }]] },
    });
  });
}
