import { mainMenu } from "../../../bot/src/main-menu";
import { widgetContentPages } from "../../../bot/src/widget-content";
import type { AdminSettings } from "./api";

export type MenuScenario = "new" | "active" | "expired" | "trial-used";
export function buildMenuPreview(settings: AdminSettings, options: {
  scenario: MenuScenario; section: "main" | "profile";
  proxy: boolean; singbox: boolean; trials: boolean;
}) {
  const existing = options.scenario === "active" || options.scenario === "expired";
  const active = options.scenario === "active";
  const unused = options.scenario === "new";
  const texts = settings.botMenuTexts ?? {};
  const visible = (key: string) => settings.botMenuLineVisibility?.[key] !== false;
  const plain = (value: string) => value.replace(/\{\{([A-Z_0-9]+)\}\}/g, (_match, key: string) => settings.botEmojis?.[key]?.unicode ?? "").replace(/\*\*|`/g, "");
  const text = (key: string, fallback = "") => plain(texts[key] ?? fallback);
  const date = active ? "30.12.2026, 12:00" : "01.10.2026, 12:00";
  const tariff = existing ? "Стандарт · 30 дней" : "Тариф не выбран";
  const status = active ? text("statusActive", "Активна") : text("statusExpired", "Истекла");
  const balance = `250 ${settings.defaultCurrency?.toUpperCase() === "USD" ? "$" : "₽"}`;
  const lines: string[] = [];
  const add = (key: string, value: string) => { if (visible(key)) lines.push(value); };
  add("welcomeGreeting", text("welcomeGreeting", "Добро пожаловать в ") + (visible("welcomeTitlePrefix") ? text("welcomeTitlePrefix") + settings.serviceName : ""));
  add("balancePrefix", text("balancePrefix", "Баланс: ") + balance);
  add("telegramIdPrefix", text("telegramIdPrefix", "Telegram ID: ") + "123456789");
  if (existing) {
    const subLine = (texts.subLineFormat || "{{SUB_STATUS}} Подписка #{{SUB_NUM}} — {{SUB_DAYS}} до {{SUB_DATE}}")
      .replace(/\{\{SUB_STATUS\}\}/g, active ? "🟢" : "🔴").replace(/\{\{SUB_TYPE\}\}/g, "🌐")
      .replace(/#?\{\{SUB_NUM\}\}/g, settings.multiSubscriptionsEnabled ? "#1" : "")
      .replace(/\{\{SUB_DAYS\}\}/g, active ? "30 дн." : "0 дн.").replace(/\{\{SUB_DATE\}\}/g, date.split(",")[0])
      .replace(/\{\{SUB_TRAFFIC\}\}/g, " | 2.00/100.00 ГБ");
    lines.push(plain(subLine));
  }
  add("tariffPrefix", text("tariffPrefix", "Тариф: ") + tariff);
  add("subscriptionPrefix", text("subscriptionPrefix", "Подписка: ") + status);
  if (existing) {
    add("expirePrefix", text("expirePrefix", "Действует до: ") + date);
    if (active) add("daysLeftPrefix", text("daysLeftPrefix", "Осталось: ") + "30 дней");
    add("devicesLabel", text("devicesLabel", "Устройства: ") + "До 3");
    add("trafficPrefix", text("trafficPrefix", "Трафик: ") + "2.00 / 100.00 GB");
    add("linkLabel", text("linkLabel", "Ссылка подключения:") + "\nhttps://example.invalid/subscription");
  } else add("trafficPrefix", text("trafficPrefix", "Трафик: ") + "0.00 GB");
  add("chooseAction", text("chooseAction", "Выберите действие:"));
  if (settings.botInfoBlock?.trim()) lines.push("", plain(settings.botInfoBlock));
  const buttons = settings.botButtons?.map(button => {
    const emoji = button.emojiKey ? settings.botEmojis?.[button.emojiKey] : null;
    return { ...button, label: emoji?.unicode ? `${emoji.unicode} ${button.label.replace(/^[\s\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]+/u, "")}` : button.label };
  });
  const markup = mainMenu({
    botButtons: buttons, buttonsPerRow: settings.botButtonsPerRow, liteMode: settings.liteMode,
    groupCabinet: settings.botGroupCabinet, groupCabinetItems: settings.botGroupCabinetItems,
    section: options.section, menuMode: settings.botMenuMode,
    showTrial: unused && options.trials,
    paidTrial: unused && settings.cloudpaymentsEnabled && settings.cloudpaymentsTrialTariffId && (settings.cloudpaymentsTrialDays ?? 0) > 0 ? { amount: settings.cloudpaymentsTrialAmount ?? 1, days: settings.cloudpaymentsTrialDays! } : null,
    showVpn: active, showRenew: existing, showProxy: options.proxy, showSingbox: options.singbox,
    showGift: settings.giftSubscriptionsEnabled, showTickets: settings.ticketsEnabled,
    showRoulette: settings.rouletteEnabled !== false,
    showExtraOptions: settings.sellOptionsEnabled && [settings.sellOptionsTrafficProducts, settings.sellOptionsDevicesProducts, settings.sellOptionsServersProducts].some(items => Array.isArray(items) && items.length > 0),
    appUrl: settings.publicAppUrl ?? null,
    hasSupportLinks: Boolean(settings.supportLink || settings.agreementLink || settings.offerLink || settings.instructionsLink || settings.refundLink),
  });
  const summary = ["tariffPrefix", "subscriptionPrefix", "expirePrefix"].some(visible) ? {
    balance: visible("balancePrefix") ? balance : undefined,
    tariff: visible("tariffPrefix") ? tariff : undefined,
    status: visible("subscriptionPrefix") ? status : undefined,
    details: [
      ...(existing && visible("expirePrefix") ? [{ label: "Срок подписки", value: date }] : []),
      ...(active && visible("daysLeftPrefix") ? [{ label: "Осталось", value: "30 дней" }] : []),
      ...(existing && visible("devicesLabel") ? [{ label: "Устройства", value: "До 3" }] : []),
      ...(visible("trafficPrefix") ? [{ label: "Трафик", value: existing ? "2.00 / 100.00 GB" : "0 GB" }] : []),
    ], account: visible("telegramIdPrefix") ? "123456789" : undefined,
    note: [plain(settings.botInfoBlock ?? ""), existing && visible("linkLabel") ? "https://example.invalid/subscription" : ""].filter(Boolean).join("\n\n"),
  } : undefined;
  return { text: lines.join("\n"), rows: markup.inline_keyboard, widgetPages: widgetContentPages(lines.join("\n"), summary) };
}
