import { z } from "zod";

export type BotButtonConfig = { id: string; visible: boolean; label: string; order: number; style?: string; emojiKey?: string; onePerRow?: boolean; url?: string };

export function isBotButtonUrl(value: string): boolean {
  if (!value || value.length > 1000 || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ["https:", "http:", "tg:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

export const customBotButtonSchema = z.object({
  id: z.string().regex(/^custom_[A-Za-z0-9_-]{1,64}$/),
  visible: z.boolean(),
  label: z.string().trim().min(1).max(64),
  url: z.string().trim().refine(isBotButtonUrl, "Укажите ссылку https://, http:// или tg://"),
  order: z.number().finite(),
  style: z.enum(["", "primary", "success", "danger"]).optional(),
  emojiKey: z.string().max(50).optional(),
  onePerRow: z.boolean().optional(),
});

export const botButtonsJsonSchema = z.string().max(50000).superRefine((raw, ctx) => {
  if (!raw.trim()) return;
  let list: unknown;
  try { list = JSON.parse(raw); } catch {
    ctx.addIssue({ code: "custom", message: "Некорректный список кнопок" }); return;
  }
  if (!Array.isArray(list) || list.length > 80) {
    ctx.addIssue({ code: "custom", message: "Некорректный список кнопок" }); return;
  }
  const ids = new Set<string>();
  let customCount = 0;
  for (const item of list) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || ids.has(item.id)) {
      ctx.addIssue({ code: "custom", message: "Кнопки должны иметь уникальные идентификаторы" }); return;
    }
    ids.add(item.id);
    if (item.id.startsWith("custom_")) {
      customCount++;
      if (!customBotButtonSchema.safeParse(item).success) {
        ctx.addIssue({ code: "custom", message: "У кнопки-ссылки должно быть название до 64 символов и корректный адрес" }); return;
      }
    } else if (item.url !== undefined) {
      ctx.addIssue({ code: "custom", message: "Ссылки можно задавать только своим кнопкам" }); return;
    }
  }
  if (customCount > 20) ctx.addIssue({ code: "custom", message: "Можно добавить не больше 20 своих кнопок" });
});

export function parseConfiguredBotButtons(raw: string | undefined, DEFAULT_BOT_BUTTONS: BotButtonConfig[]): BotButtonConfig[] {
  if (!raw || !raw.trim()) return DEFAULT_BOT_BUTTONS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_BOT_BUTTONS;
    const result = parsed.filter((x) => x && typeof x === "object" && !Array.isArray(x)).map<BotButtonConfig | null>((x: unknown, i: number) => {
      const o = x as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : String(o.id ?? "button");
      if (id.startsWith("custom_")) {
        const custom = customBotButtonSchema.safeParse(o);
        return custom.success ? custom.data : null;
      }
      const def = DEFAULT_BOT_BUTTONS.find((d) => d.id === id) ?? { label: id, order: i, style: "" as string };
      return {
        id,
        visible: typeof o.visible === "boolean" ? o.visible : true,
        label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : def.label,
        order: typeof o.order === "number" ? o.order : (typeof o.order === "string" ? parseFloat(o.order) : i),
        style: typeof o.style === "string" ? o.style : (def as BotButtonConfig).style ?? "",
        emojiKey: typeof o.emojiKey === "string" ? o.emojiKey.trim() : undefined,
        onePerRow: typeof o.onePerRow === "boolean" ? o.onePerRow : (def as BotButtonConfig).onePerRow,
      };
    }).filter((button): button is BotButtonConfig => button !== null);
    const savedIds = new Set(result.map((b) => b.id));
    for (const def of DEFAULT_BOT_BUTTONS) {
      if (!savedIds.has(def.id)) {
        result.push({ id: def.id, visible: def.visible, label: def.label, order: def.order, style: def.style ?? "", emojiKey: undefined, onePerRow: def.onePerRow });
      }
    }
    return result;
  } catch {
    return DEFAULT_BOT_BUTTONS;
  }
}
