import { z } from "zod";

export const botCommandSchema = z.object({
  command: z.enum(["start", "subscriptions", "referral", "support", "paysupport", "autopay"]),
  description: z.string().trim().min(1).max(256),
  visible: z.boolean(),
});
export const botCommandsSchema = z.array(botCommandSchema).max(6).refine(items => new Set(items.map(i => i.command)).size === items.length, "Команды не должны повторяться");
export const defaultBotCommands = [
  { command: "start", description: "Главное меню", visible: true },
  { command: "subscriptions", description: "Моя подписка / инструкции", visible: true },
  { command: "referral", description: "Реферальная программа", visible: true },
  { command: "support", description: "Поддержка", visible: true },
  { command: "paysupport", description: "Помощь с оплатой Stars", visible: true },
  { command: "autopay", description: "Автоплатежи: просмотр и отмена", visible: true },
];
export function loadBotCommands(raw?: string) { return raw ? botCommandsSchema.parse(JSON.parse(raw)) : defaultBotCommands; }
