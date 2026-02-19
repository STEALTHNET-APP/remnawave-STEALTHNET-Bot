/**
 * Inline-клавиатуры с цветными кнопками (Telegram Bot API: style — primary, success, danger).
 * Эмодзи в тексте кнопок (Unicode).
 */

type ButtonStyle = "primary" | "success" | "danger";

interface InlineButton {
  text: string;
  callback_data: string;
  style?: ButtonStyle;
  icon_custom_emoji_id?: string;
}

type WebAppButton = { text: string; web_app: { url: string }; icon_custom_emoji_id?: string };
type UrlButton = { text: string; url: string; icon_custom_emoji_id?: string };
export type InlineMarkup = { inline_keyboard: (InlineButton | WebAppButton | UrlButton)[][] };

export type BotButtonConfig = { id: string; visible: boolean; label: string; order: number; style?: string; iconCustomEmojiId?: string };

function btn(text: string, data: string, style?: ButtonStyle | null, iconCustomEmojiId?: string): InlineButton {
  const b: InlineButton = { text, callback_data: data };
  if (style) b.style = style;
  if (iconCustomEmojiId) b.icon_custom_emoji_id = iconCustomEmojiId;
  return b;
}

function resolveStyle(configured: ButtonStyle | undefined | null, fallback: ButtonStyle): ButtonStyle | undefined {
  if (configured === null) return fallback;
  return configured;
}

const MENU_IDS: Record<string, string> = {
  tariffs: "menu:tariffs",
  profile: "menu:profile",
  topup: "menu:topup",
  referral: "menu:referral",
  trial: "menu:trial",
  vpn: "menu:vpn",
  support: "menu:support",
  promocode: "menu:promocode",
  extra_options: "menu:extra_options",
};

const DEFAULT_BUTTONS: BotButtonConfig[] = [
  { id: "tariffs", visible: true, label: "📦 Тарифы", order: 0, style: "success" },
  { id: "profile", visible: true, label: "👤 Профиль", order: 1, style: "" },
  { id: "topup", visible: true, label: "💳 Пополнить баланс", order: 2, style: "success" },
  { id: "referral", visible: true, label: "🔗 Реферальная программа", order: 3, style: "primary" },
  { id: "trial", visible: true, label: "🎁 Попробовать бесплатно", order: 4, style: "success" },
  { id: "vpn", visible: true, label: "🌐 Подключиться к VPN", order: 5, style: "danger" },
  { id: "cabinet", visible: true, label: "🌐 Web Кабинет", order: 6, style: "primary" },
  { id: "support", visible: true, label: "🆘 Поддержка", order: 7, style: "primary" },
  { id: "promocode", visible: true, label: "🎟️ Промокод", order: 8, style: "primary" },
  { id: "extra_options", visible: true, label: "➕ Доп. опции", order: 9, style: "primary" },
];

function toStyle(s: string | undefined): ButtonStyle | undefined | null {
  if (s === "primary" || s === "success" || s === "danger") return s;
  if (s === "") return undefined;
  return null;
}

export type InnerButtonStyles = {
  tariffPay?: string;
  topup?: string;
  back?: string;
  profile?: string;
  trialConfirm?: string;
  lang?: string;
  currency?: string;
};

/** ID премиум-эмодзи для внутренних кнопок (из botEmojis: BACK, CARD, PACKAGE, TRIAL, PUZZLE, SERVERS) */
export type InnerEmojiIds = {
  back?: string;
  card?: string;
  tariff?: string;
  trial?: string;
  profile?: string;
  connect?: string;
};

/** Главное меню: кнопки из конфига. Эмодзи в label (Unicode) и/или icon_custom_emoji_id (премиум). Поддержка показывается только если задана хотя бы одна ссылка. */
export function mainMenu(opts: {
  showTrial: boolean;
  showVpn: boolean;
  appUrl: string | null;
  botButtons?: BotButtonConfig[] | null;
  botBackLabel?: string | null;
  hasSupportLinks?: boolean;
  showExtraOptions?: boolean;
}): InlineMarkup {
  const list = (opts.botButtons && opts.botButtons.length > 0 ? opts.botButtons : DEFAULT_BUTTONS)
    .filter((b) => b.visible)
    .filter((b) => {
      if (b.id === "trial") return opts.showTrial;
      if (b.id === "vpn") return opts.showVpn;
      if (b.id === "cabinet") return !!opts.appUrl?.trim();
      if (b.id === "support") return !!opts.hasSupportLinks;
      if (b.id === "extra_options") return opts.showExtraOptions === true;
      return true;
    })
    .sort((a, b) => a.order - b.order);
  const base = opts.appUrl?.replace(/\/$/, "") ?? "";
  const rows: (InlineButton | WebAppButton)[][] = [];
  for (const b of list) {
    const iconId = b.iconCustomEmojiId;
    if (b.id === "cabinet") {
      if (base) {
        const w: WebAppButton = { text: b.label, web_app: { url: `${base}/cabinet` } };
        if (iconId) w.icon_custom_emoji_id = iconId;
        rows.push([w]);
      }
    } else if (b.id === "vpn" && base) {
      const w: WebAppButton = { text: b.label, web_app: { url: `${base}/cabinet/subscribe` } };
      if (iconId) w.icon_custom_emoji_id = iconId;
      rows.push([w]);
    } else if (MENU_IDS[b.id]) {
      rows.push([btn(b.label, MENU_IDS[b.id], toStyle(b.style), iconId)]);
    }
  }
  return { inline_keyboard: rows };
}

const DEFAULT_BACK_LABEL = "◀️ В меню";

/** Меню «Поддержка»: 4 кнопки-ссылки (только с заданным URL) + «В меню». */
export function supportSubMenu(
  links: { support?: string | null; agreement?: string | null; offer?: string | null; instructions?: string | null },
  backLabel?: string | null,
  backStyle?: string,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(backStyle), "danger");
  const rows: (InlineButton | UrlButton)[][] = [];
  const items: [string, string | null | undefined][] = [
    ["👤 Тех поддержка", links.support],
    ["📜 Соглашения", links.agreement],
    ["📄 Оферта", links.offer],
    ["📋 Инструкции", links.instructions],
  ];
  for (const [label, url] of items) {
    const u = (url ?? "").trim();
    if (u) rows.push([{ text: label, url: u }]);
  }
  rows.push([btn(back, "menu:main", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

export function backToMenu(backLabel?: string | null, backStyle?: string, emojiIds?: InnerEmojiIds): InlineMarkup {
  const text = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  return { inline_keyboard: [[btn(text, "menu:main", resolveStyle(toStyle(backStyle), "danger"), emojiIds?.back)]] };
}

/** Кнопка «Оплатить» (открывает paymentUrl) + «В меню» */
export function payUrlMarkup(
  paymentUrl: string,
  backLabel?: string | null,
  backStyle?: string,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(backStyle), "danger");
  const payBtn: UrlButton = { text: "💳 Оплатить", url: paymentUrl };
  if (emojiIds?.card) payBtn.icon_custom_emoji_id = emojiIds.card;
  return {
    inline_keyboard: [
      [payBtn],
      [btn(back, "menu:main", backSty, emojiIds?.back)],
    ],
  };
}

export function openSubscribePageMarkup(appUrl: string, backLabel?: string | null, backStyle?: string, emojiIds?: InnerEmojiIds): InlineMarkup {
  const base = appUrl.replace(/\/$/, "");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const connectBtn: WebAppButton = { text: "📲 Открыть страницу подключения", web_app: { url: `${base}/cabinet/subscribe` } };
  if (emojiIds?.connect) connectBtn.icon_custom_emoji_id = emojiIds.connect;
  return {
    inline_keyboard: [
      [connectBtn],
      [btn(back, "menu:main", resolveStyle(toStyle(backStyle), "danger"), emojiIds?.back)],
    ],
  };
}

export function topUpPresets(currency: string, backLabel?: string | null, innerStyles?: InnerButtonStyles, emojiIds?: InnerEmojiIds): InlineMarkup {
  const sym = currency.toUpperCase() === "RUB" ? "₽" : currency.toUpperCase() === "USD" ? "$" : "₴";
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const topup = resolveStyle(toStyle(innerStyles?.topup), "primary");
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const cardId = emojiIds?.card;
  return {
    inline_keyboard: [
      [
        btn(`${sym} 100`, "topup:100", topup, cardId),
        btn(`${sym} 300`, "topup:300", topup, cardId),
        btn(`${sym} 500`, "topup:500", topup, cardId),
      ],
      [
        btn(`${sym} 1000`, "topup:1000", topup, cardId),
        btn(`${sym} 2000`, "topup:2000", topup, cardId),
      ],
      [btn(back, "menu:main", backSty, emojiIds?.back)],
    ],
  };
}

/** Кнопки категорий тарифов (первый экран при нескольких категориях) */
export function tariffCategoryButtons(
  categories: { id: string; name: string; emoji?: string }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const tariffId = emojiIds?.tariff;
  const rows: InlineButton[][] = categories.map((cat) => {
    const label = ((cat.emoji && cat.emoji.trim()) ? `${cat.emoji} ` : "") + cat.name;
    return [btn(label.slice(0, 64), `cat_tariffs:${cat.id}`, tariffPay, tariffId)];
  });
  rows.push([btn(back, "menu:main", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки тарифов одной категории. backData: куда ведёт «Назад» (menu:tariffs или menu:main) */
export function tariffsOfCategoryButtons(
  category: { name: string; emoji?: string; tariffs: { id: string; name: string; price: number; currency: string }[] },
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  backData: string = "menu:tariffs",
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const rows: InlineButton[][] = [];
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const prefix = (category.emoji && category.emoji.trim()) ? `${category.emoji} ` : "";
  const tariffId = emojiIds?.tariff;
  for (const t of category.tariffs) {
    const label = `${prefix}${t.name} — ${t.price} ${t.currency}`.slice(0, 64);
    rows.push([btn(label, `pay_tariff:${t.id}`, tariffPay, tariffId)]);
  }
  rows.push([btn(back, backData, backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Все тарифы списком (одна категория — без экрана выбора категории) */
export function tariffPayButtons(
  categories: {
    id: string;
    name: string;
    emoji?: string;
    tariffs: { id: string; name: string; price: number; currency: string }[];
  }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  if (categories.length === 0) {
    const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
    const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
    return { inline_keyboard: [[btn(back, "menu:main", backSty, emojiIds?.back)]] };
  }
  if (categories.length === 1) {
    return tariffsOfCategoryButtons(categories[0]!, backLabel, innerStyles, "menu:main", emojiIds);
  }
  return tariffCategoryButtons(categories, backLabel, innerStyles, emojiIds);
}

/** Кнопки выбора способа оплаты (СПБ, Карты и т.д. из админки) для тарифа + баланс + ЮMoney */
export function tariffPaymentMethodButtons(
  tariffId: string,
  methods: { id: number; label: string }[],
  backLabel?: string | null,
  backStyle?: string,
  emojiIds?: InnerEmojiIds,
  balanceLabel?: string | null,
  yoomoneyEnabled?: boolean,
  yookassaEnabled?: boolean,
  tariffCurrency?: string,
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(backStyle), "danger");
  const cardId = emojiIds?.card;
  const rows: InlineButton[][] = [];
  // Кнопка оплаты балансом (первая)
  if (balanceLabel) {
    rows.push([btn(balanceLabel, `pay_tariff_balance:${tariffId}`, "success", cardId)]);
  }
  // ЮMoney — только для рублёвых тарифов
  if (yoomoneyEnabled && (!tariffCurrency || tariffCurrency.toUpperCase() === "RUB")) {
    rows.push([btn("💳 ЮMoney — оплата картой", `pay_tariff_yoomoney:${tariffId}`, "primary", cardId)]);
  }
  // ЮKassa — только RUB
  if (yookassaEnabled && (!tariffCurrency || tariffCurrency.toUpperCase() === "RUB")) {
    rows.push([btn("💳 ЮKassa — карта / СБП", `pay_tariff_yookassa:${tariffId}`, "primary", cardId)]);
  }
  for (const m of methods) {
    rows.push([btn(m.label, `pay_tariff:${tariffId}:${m.id}`, "primary", cardId)]);
  }
  rows.push([btn(back, "menu:tariffs", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки выбора способа оплаты для пополнения на сумму + ЮMoney */
export function topupPaymentMethodButtons(
  amount: string,
  methods: { id: number; label: string }[],
  backLabel?: string | null,
  backStyle?: string,
  emojiIds?: InnerEmojiIds,
  yoomoneyEnabled?: boolean,
  yookassaEnabled?: boolean,
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(backStyle), "danger");
  const cardId = emojiIds?.card;
  const rows: InlineButton[][] = [];
  if (yoomoneyEnabled) {
    rows.push([btn("💳 ЮMoney — оплата картой", `topup_yoomoney:${amount}`, "primary", cardId)]);
  }
  if (yookassaEnabled) {
    rows.push([btn("💳 ЮKassa — карта / СБП", `topup_yookassa:${amount}`, "primary", cardId)]);
  }
  for (const m of methods) {
    rows.push([btn(m.label, `topup:${amount}:${m.id}`, "primary", cardId)]);
  }
  rows.push([btn(back, "menu:topup", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

type SellOptionItem =
  | { kind: "traffic"; id: string; name: string; trafficGb: number; price: number; currency: string }
  | { kind: "devices"; id: string; name: string; deviceCount: number; price: number; currency: string }
  | { kind: "servers"; id: string; name: string; squadUuid: string; trafficGb?: number; price: number; currency: string };

/** Кнопки списка доп. опций (трафик, устройства, серверы). */
export function extraOptionsButtons(
  options: SellOptionItem[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const cardId = emojiIds?.card;
  const rows: InlineButton[][] = options.map((o) => {
    const extra = o.kind === "servers" && (o.trafficGb ?? 0) > 0 ? ` + ${o.trafficGb} ГБ` : "";
    const label = `${o.name || o.kind}${extra} — ${o.price} ${o.currency}`.slice(0, 64);
    return [btn(label, `pay_option:${o.kind}:${o.id}`, "success", cardId)];
  });
  rows.push([btn(back, "menu:main", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки выбора способа оплаты опции: баланс, ЮMoney, ЮKassa, Platega. */
export function optionPaymentMethodButtons(
  option: SellOptionItem,
  balance: number,
  backLabel: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds,
  plategaMethods: { id: number; label: string }[] = [],
  yoomoneyEnabled?: boolean,
  yookassaEnabled?: boolean
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const cardId = emojiIds?.card;
  const rows: InlineButton[][] = [];
  if (balance >= option.price) {
    rows.push([btn(`💰 Оплатить балансом (${option.price} ₽)`, `pay_option_balance:${option.kind}:${option.id}`, "success", cardId)]);
  }
  if (yoomoneyEnabled) {
    rows.push([btn("💳 ЮMoney — карта", `pay_option_yoomoney:${option.kind}:${option.id}`, "primary", cardId)]);
  }
  if (yookassaEnabled !== false) {
    rows.push([btn("💳 ЮKassa — карта / СБП", `pay_option_yookassa:${option.kind}:${option.id}`, "primary", cardId)]);
  }
  for (const m of plategaMethods) {
    rows.push([btn(m.label, `pay_option_platega:${option.kind}:${option.id}:${m.id}`, "primary", cardId)]);
  }
  if (rows.length === 0) {
    rows.push([btn("💳 Оплата (ЮKassa)", `pay_option_yookassa:${option.kind}:${option.id}`, "primary", cardId)]);
  }
  rows.push([btn(back, "menu:extra_options", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

export function profileButtons(backLabel?: string | null, innerStyles?: InnerButtonStyles, emojiIds?: InnerEmojiIds): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const profile = resolveStyle(toStyle(innerStyles?.profile), "primary");
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const profileId = emojiIds?.profile;
  return {
    inline_keyboard: [
      [btn("🌐 Язык", "profile:lang", profile, profileId), btn("💱 Валюта", "profile:currency", profile, profileId)],
      [btn(back, "menu:main", backSty, emojiIds?.back)],
    ],
  };
}

export function langButtons(langs: string[], innerStyles?: InnerButtonStyles, emojiIds?: InnerEmojiIds): InlineMarkup {
  const langStyle = resolveStyle(toStyle(innerStyles?.lang), "primary");
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const row: InlineButton[] = langs.slice(0, 3).map((l) => btn(l.toUpperCase(), `set_lang:${l}`, langStyle));
  return { inline_keyboard: [row, [btn("◀️ Назад", "menu:profile", backSty, emojiIds?.back)]] };
}

export function currencyButtons(currencies: string[], innerStyles?: InnerButtonStyles, emojiIds?: InnerEmojiIds): InlineMarkup {
  const currencyStyle = resolveStyle(toStyle(innerStyles?.currency), "primary");
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const row: InlineButton[] = currencies.slice(0, 3).map((c) => btn(c.toUpperCase(), `set_currency:${c}`, currencyStyle));
  return { inline_keyboard: [row, [btn("◀️ Назад", "menu:profile", backSty, emojiIds?.back)]] };
}

export function trialConfirmButton(innerStyles?: InnerButtonStyles, emojiIds?: InnerEmojiIds): InlineMarkup {
  const trialConfirm = resolveStyle(toStyle(innerStyles?.trialConfirm), "success");
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  return {
    inline_keyboard: [
      [btn("🎁 Активировать триал", "trial:confirm", trialConfirm, emojiIds?.trial), btn("Отмена", "menu:main", backSty, emojiIds?.back)],
    ],
  };
}
