import { menuWebAppUrl } from "./menu-web-app.js";
import { isBotButtonUrl } from "./button-url.js";
export type ButtonStyle = "primary" | "success" | "danger";

export interface InlineButton {
  text: string;
  callback_data: string;
  style?: ButtonStyle;
  icon_custom_emoji_id?: string;
}

export type WebAppButton = { text: string; web_app: { url: string }; icon_custom_emoji_id?: string; style?: ButtonStyle };
export type UrlButton = { text: string; url: string; icon_custom_emoji_id?: string; style?: ButtonStyle };
export type InlineMarkup = { inline_keyboard: (InlineButton | WebAppButton | UrlButton)[][] };

export type BotButtonConfig = { id: string; visible: boolean; label: string; order: number; style?: string; iconCustomEmojiId?: string; onePerRow?: boolean; url?: string };

export const DEFAULT_CABINET_GROUPED_IDS: string[] = [
  "cloudtrial",
  "autopay",
  "tariffs",
  "my_subs",
  "proxy",
  "my_proxy",
  "singbox",
  "my_singbox",
  "devices",
  "topup",
  "referral",
  "trial",
  "vpn",
  "promocode",
  "extra_options",
  "gift",
  "roulette",
  "tg_proxy",
];

const MENU_IDS: Record<string, string> = {
  tariffs: "menu:tariffs",
  proxy: "menu:proxy",
  my_proxy: "menu:my_proxy",
  singbox: "menu:singbox",
  my_singbox: "menu:my_singbox",
  profile: "menu:profile",
  devices: "menu:devices",
  topup: "menu:topup",
  referral: "menu:referral",
  cloudtrial: "menu:cloudtrial",
  autopay: "menu:autopay",
  trial: "menu:trial",
  vpn: "menu:vpn",
  renew: "menu:renew",
  support: "menu:support",
  promocode: "menu:promocode",
  extra_options: "menu:extra_options",
  gift: "menu:gift",
  roulette: "menu:roulette",
  // Унифицированный список подписок (root + secondary). См. handler menu:my_subs в index.ts.
  my_subs: "menu:my_subs",
  // T14 (11.05.2026): бесплатный MTProto-прокси для Telegram. См. handler menu:tg_proxy в index.ts.
  tg_proxy: "menu:tg_proxy",
};

const DEFAULT_BUTTONS: BotButtonConfig[] = [
  { id: "cloudtrial", visible: true, label: "Пробный доступ: {days} дн. за {amount} ₽", order: -1, style: "" },
  { id: "autopay", visible: true, label: "Автоплатежи", order: 4.6, style: "" },
  { id: "tariffs", visible: true, label: "📦 Тарифы", order: 0, style: "success" },
  // «Мои подписки» — order 0.05, чтобы стояло сразу после «Тарифы» и перед прокси/singbox.
  { id: "my_subs", visible: true, label: "📋 Мои подписки", order: 0.05, style: "primary" },
  { id: "proxy", visible: true, label: "🌐 Прокси", order: 0.5, style: "primary" },
  { id: "my_proxy", visible: true, label: "📋 Мои прокси", order: 0.6, style: "primary" },
  { id: "singbox", visible: true, label: "🔑 Доступы", order: 0.55, style: "primary" },
  { id: "my_singbox", visible: true, label: "📋 Мои доступы", order: 0.65, style: "primary" },
  { id: "profile", visible: true, label: "👤 Профиль", order: 1, style: "" },
  { id: "devices", visible: true, label: "📱 Устройства", order: 1.5, style: "primary" },
  { id: "topup", visible: true, label: "💳 Пополнить баланс", order: 2, style: "success" },
  // T11 (11.05.2026): эмодзи ↔️ → 👥 по эталону скрина 1.
  { id: "referral", visible: true, label: "👥 Реферальная программа", order: 3, style: "primary" },
  { id: "trial", visible: true, label: "🎁 Бесплатный Тест", order: 4, style: "success" },
  { id: "renew", visible: true, label: "🔄 Продлить подписку", order: 4.5, style: "primary" },
  { id: "vpn", visible: true, label: "🌐 Подключиться к VPN", order: 5, style: "danger", onePerRow: true },
  { id: "cabinet", visible: true, label: "🌐 Web Кабинет", order: 6, style: "primary" },
  { id: "tickets", visible: true, label: "🎫 Тикеты", order: 6.5, style: "primary" },
  // T11 (11.05.2026): «🆘 Поддержка» → «⭕ Помощь» по эталону скрина 1.
  { id: "support", visible: true, label: "⭕ Помощь", order: 7, style: "primary" },
  { id: "promocode", visible: true, label: "🎟️ Промокод", order: 8, style: "primary" },
  { id: "gift", visible: true, label: "🎁 Подарки", order: 8.5, style: "primary" },
  { id: "roulette", visible: true, label: "🎰 Рулетка", order: 8.7, style: "primary" },
  { id: "extra_options", visible: true, label: "➕ Доп. опции", order: 9, style: "primary" },
  // T14 (11.05.2026): бесплатный MTProto-прокси для Telegram (по эталону скрина 1).
  { id: "tg_proxy", visible: true, label: "🛡 Бесплатный Прокси для Telegram", order: 6.8, style: "primary", onePerRow: true },
];

const LEADING_EMOJI_RE = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u;
function stripLeadingEmoji(text: string): string {
  return text.replace(LEADING_EMOJI_RE, "");
}
function btn(text: string, data: string, style?: ButtonStyle | null, iconCustomEmojiId?: string): InlineButton {
  const finalText = iconCustomEmojiId ? stripLeadingEmoji(text) : text;
  const b: InlineButton = { text: finalText, callback_data: data };
  if (style) b.style = style;
  if (iconCustomEmojiId) b.icon_custom_emoji_id = iconCustomEmojiId;
  return b;
}
function toStyle(s: string | undefined): ButtonStyle | undefined | null {
  if (s === "primary" || s === "success" || s === "danger") return s;
  if (s === "") return undefined;
  return null;
}
export function mainMenu(opts: {
  liteMode?: boolean;
  showTrial: boolean;
  paidTrial?: { amount: number; days: number } | null;
  showVpn: boolean;
  showRenew?: boolean;
  connectTarget?: { url: string } | { web_app: { url: string } };
  showProxy?: boolean;
  showSingbox?: boolean;
  appUrl: string | null;
  botButtons?: BotButtonConfig[] | null;
  botBackLabel?: string | null;
  hasSupportLinks?: boolean;
  showTickets?: boolean;
  showExtraOptions?: boolean;
  showGift?: boolean;
  showRoulette?: boolean;
  menuMode?: "classic" | "web";
  groupCabinet?: boolean;
  groupCabinetItems?: string[] | null;
  section?: "main" | "profile";
  /** Кнопок в ряд: 1 или 2 (по умолчанию 1) */
  buttonsPerRow?: 1 | 2;
  /** URL страницы подписки Remna (если задан — кнопка VPN ведёт туда) */
  remnaSubscriptionUrl?: string | null;
}): InlineMarkup {
  const configButtons = opts.botButtons ?? [];
  const fromConfig = Array.isArray(opts.botButtons);
  let list = (fromConfig ? configButtons : DEFAULT_BUTTONS).map(b => ({ ...b }));
  const cabinetIds = new Set(
    Array.isArray(opts.groupCabinetItems)
      ? opts.groupCabinetItems
      : DEFAULT_CABINET_GROUPED_IDS
  );
  if (!opts.liteMode && opts.groupCabinet && opts.section !== "profile") {
    const profile = list.find(b => b.id === "profile");
    if (profile) profile.visible = true;
    else list.push({ ...DEFAULT_BUTTONS.find(b => b.id === "profile")! });
  }
  list = list
    .filter(b => opts.liteMode || (opts.section === "profile" ? cabinetIds.has(b.id) : !opts.groupCabinet || !cabinetIds.has(b.id)))
    .filter((b) => b.visible)
    .filter((b) => {
      if (b.id === "cloudtrial") return !!opts.paidTrial;
      if (b.id === "trial") return opts.showTrial;
      if (b.id === "vpn") return opts.showVpn;
      if (b.id === "renew") return opts.showRenew === true;
      if (b.id === "proxy" || b.id === "my_proxy") return opts.showProxy === true;
      if (b.id === "singbox" || b.id === "my_singbox") return opts.showSingbox === true;
      if (b.id === "cabinet") return !!opts.appUrl?.trim();
      if (b.id === "tickets") return opts.showTickets === true && !!opts.appUrl?.trim();
      if (b.id === "support") return !!opts.hasSupportLinks || (opts.showTickets === true && !!opts.appUrl?.trim());
      if (b.id === "extra_options") return opts.showExtraOptions === true;
      if (b.id === "gift") return opts.showGift === true;
      if (b.id === "roulette") return opts.showRoulette !== false;
      return true;
    })
    .sort((a, b) => a.order - b.order);
  if (opts.liteMode) list = list.filter(b => ["cloudtrial", "autopay", "tariffs", "my_subs", "vpn", "renew", "cabinet", "topup", "trial", "support"].includes(b.id));
  const base = opts.appUrl?.replace(/\/$/, "") ?? "";
  const perRow = opts.buttonsPerRow === 2 ? 2 : 1;
  const items: { node: InlineButton | WebAppButton | UrlButton; onePerRow: boolean }[] = [];
  for (const b of list) {
    if (b.id === "cloudtrial" && opts.paidTrial) b.label = b.label.split("{days}").join(String(opts.paidTrial.days)).split("{amount}").join(String(opts.paidTrial.amount));
    const iconId = b.iconCustomEmojiId;
    const onePerRow = b.onePerRow === true;
    const labelForIcon = iconId ? stripLeadingEmoji(b.label) : b.label;
    // Стиль (primary/success/danger) для всех типов кнопок — в т.ч. web_app/url.
    // Telegram Bot API игнорирует поле для не-callback кнопок, но мы передаём
    // его на случай поддержки в будущих версиях клиента.
    const styleForBtn = toStyle(b.style);
    if (b.id.startsWith("custom_")) {
      const url = b.url?.trim() ?? "";
      if (!isBotButtonUrl(url) || !labelForIcon.trim()) continue;
      const node: UrlButton = { text: labelForIcon, url };
      if (iconId) node.icon_custom_emoji_id = iconId;
      if (styleForBtn) node.style = styleForBtn;
      items.push({ node, onePerRow });
    } else if (b.id === "vpn" && opts.connectTarget) {
      const node: WebAppButton | UrlButton = { text: labelForIcon, ...opts.connectTarget };
      if (iconId) node.icon_custom_emoji_id = iconId;
      if (styleForBtn) node.style = styleForBtn;
      items.push({ node, onePerRow });
    } else if (opts.menuMode === "web" && b.id !== "vpn" && !(!opts.liteMode && opts.groupCabinet && b.id === "profile") && menuWebAppUrl(base, b.id)) {
      const node: WebAppButton = { text: labelForIcon, web_app: { url: menuWebAppUrl(base, b.id)! } };
      if (iconId) node.icon_custom_emoji_id = iconId;
      if (styleForBtn) node.style = styleForBtn;
      items.push({ node, onePerRow });
    } else if (b.id === "cabinet") {
      if (base) {
        const w: WebAppButton = { text: labelForIcon, web_app: { url: `${base}/cabinet` } };
        if (iconId) w.icon_custom_emoji_id = iconId;
        if (styleForBtn) w.style = styleForBtn;
        items.push({ node: w, onePerRow });
      }
    } else if (b.id === "site") {
      // новая кнопка «🌐 Сайт» — URL-кнопка на главный сайт.
      // URL берётся из system_settings.publicAppUrl. Без URL — кнопка скрывается.
      const siteUrl = opts.appUrl?.replace(/\/$/, "") || null;
      if (siteUrl) {
        const u: UrlButton = { text: labelForIcon, url: siteUrl };
        if (iconId) u.icon_custom_emoji_id = iconId;
        if (styleForBtn) u.style = styleForBtn;
        items.push({ node: u, onePerRow });
      }
    } else if (b.id === "vpn") {
      items.push({ node: btn(b.label, MENU_IDS[b.id], styleForBtn, iconId), onePerRow });
    } else if (b.id === "tickets" && base) {
      const w: WebAppButton = { text: labelForIcon, web_app: { url: `${base}/cabinet/tickets` } };
      if (iconId) w.icon_custom_emoji_id = iconId;
      if (styleForBtn) w.style = styleForBtn;
      items.push({ node: w, onePerRow });
    } else if (b.id === "roulette" && base) {
      const w: WebAppButton = { text: labelForIcon, web_app: { url: `${base}/cabinet/roulette` } };
      if (iconId) w.icon_custom_emoji_id = iconId;
      if (styleForBtn) w.style = styleForBtn;
      items.push({ node: w, onePerRow });
    } else if (MENU_IDS[b.id]) {
      items.push({ node: btn(b.label, MENU_IDS[b.id], styleForBtn, iconId), onePerRow });
    }
  }
  const rows: (InlineButton | WebAppButton | UrlButton)[][] = [];
  let currentRow: (InlineButton | WebAppButton | UrlButton)[] = [];
  for (const { node, onePerRow } of items) {
    if (onePerRow) {
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
      rows.push([node]);
    } else {
      currentRow.push(node);
      if (currentRow.length >= perRow) {
        rows.push(currentRow);
        currentRow = [];
      }
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  return { inline_keyboard: rows };
}

