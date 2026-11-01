import { z } from "zod";
import { money } from "./cloudpayments-api.js";

export const receiptSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  taxationSystem: z.number().int().min(0).max(5).default(1),
  vat: z.union([z.literal(0), z.literal(5), z.literal(7), z.literal(10), z.literal(22), z.literal(105), z.literal(107), z.literal(110), z.literal(122)]).nullable().default(null),
  method: z.number().int().min(1).max(7).default(4),
  object: z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(9), z.literal(10), z.literal(13)]).default(4),
  label: z.string().trim().min(1).max(128).default("{product}"),
});
export type ReceiptSettings = z.infer<typeof receiptSettingsSchema>;
export type CloudReceipt = {
  Items: { label: string; price: number; quantity: number; amount: number; vat: number | null; method: number; object: number }[];
  taxationSystem: number; email: string; amounts: { electronic: number };
};
export function loadReceiptSettings(raw: string | undefined): ReceiptSettings {
  if (!raw) return receiptSettingsSchema.parse({});
  return receiptSettingsSchema.parse(JSON.parse(raw));
}
export function receiptEmail(value: unknown): string {
  return z.string().trim().email("Укажите email для получения чека").max(254).parse(value);
}
export function buildCloudReceipt(settings: ReceiptSettings, amount: number, product: string, email: unknown): CloudReceipt | null {
  if (!settings.enabled) return null;
  const total = money(amount);
  if (total <= 0) throw new Error("Сумма чека должна быть больше нуля");
  return { Items: [{ label: settings.label.replaceAll("{product}", product).slice(0, 128), price: total, quantity: 1, amount: total, vat: settings.vat, method: settings.method, object: settings.object }], taxationSystem: settings.taxationSystem, email: receiptEmail(email), amounts: { electronic: total } };
}
export function resizeCloudReceipt(receipt: CloudReceipt | null | undefined, amount: number): CloudReceipt | null {
  if (!receipt) return null;
  if (receipt.Items.length !== 1) throw new Error("Состав чека требует ручной проверки");
  const total = money(amount);
  if (total <= 0) throw new Error("Сумма чека должна быть больше нуля");
  return { ...receipt, Items: [{ ...receipt.Items[0], price: total, amount: total, quantity: 1 }], amounts: { electronic: total } };
}
