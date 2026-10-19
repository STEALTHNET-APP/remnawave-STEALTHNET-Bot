import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { checkStarsCheckout, receiveStarsPayment, refundStarsPayment } from "./stars.service.js";

export const starsBotRouter = Router();
starsBotRouter.use((req, res, next) => {
  const expected = Buffer.from(process.env.BOT_TOKEN?.trim() || "");
  const actual = Buffer.from(req.get("X-Telegram-Bot-Token") || "");
  if (!expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
});
const checkout = z.object({ paymentId: z.string().min(1).max(64), telegramId: z.string().regex(/^[1-9][0-9]{0,15}$/), currency: z.literal("XTR"), totalAmount: z.number().int().positive().max(1000000) }).strict();
const paid = checkout.extend({ chargeId: z.string().min(1).max(512) });
for (const [path, schema, handler] of [["/checkout", checkout.extend({ checkoutId: z.string().min(1).max(512) }), checkStarsCheckout], ["/paid", paid, receiveStarsPayment], ["/refunded", paid, (receipt: z.infer<typeof checkout> & { chargeId?: string }) => refundStarsPayment(receipt.paymentId, receipt).then(() => ({ ok: true }))]] as const) {
  starsBotRouter.post(path, async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: "Неверные данные оплаты" }); return; }
    try { res.json(await handler(parsed.data)); }
    catch (error) { res.status(409).json({ message: error instanceof Error ? error.message : "Не удалось проверить оплату" }); }
  });
}
