import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, Eye, FileText, GripVertical, Layers, Link2, Loader2, MessageCircle, MessageSquare, Plus, RotateCw, Sliders, Smile, Sparkles, Trash2, Wallet } from "lucide-react";
import { adminAlert } from "@/lib/admin-dialogs";
import { isBotButtonUrl } from "@/lib/bot-button-url";
import { BotCommandsSettings } from "@/components/admin/bot-commands-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AdminSettings } from "@/lib/api";

export type BotButtonItem = { id: string; visible: boolean; label: string; order: number; style?: string; emojiKey?: string; onePerRow?: boolean; url?: string };
export const DEFAULT_BOT_BUTTONS: BotButtonItem[] = [
  { id: "cloudtrial", visible: true, label: "Пробный доступ: {days} дн. за {amount} ₽", order: -1, style: "" },
  { id: "autopay", visible: true, label: "Автоплатежи", order: 4.6, style: "" },
  { id: "tariffs", visible: true, label: " Купить доступ / Продлить", order: 2, style: "" },
  { id: "proxy", visible: true, label: " Прокси", order: 0.5, style: "primary", emojiKey: "SERVERS" },
  { id: "my_proxy", visible: true, label: " Мои прокси", order: 0.6, style: "primary", emojiKey: "SERVERS" },
  { id: "singbox", visible: true, label: " Доступы", order: 0.55, style: "primary", emojiKey: "SERVERS" },
  { id: "my_singbox", visible: true, label: " Мои доступы", order: 0.65, style: "primary", emojiKey: "SERVERS" },
  { id: "profile", visible: true, label: " Профиль", order: 1, style: "", emojiKey: "PUZZLE" },
  { id: "devices", visible: true, label: " Устройства", order: 1.5, style: "primary", emojiKey: "DEVICES" },
  { id: "topup", visible: true, label: " Пополнить баланс", order: 2, style: "success", emojiKey: "CARD" },
  { id: "referral", visible: true, label: " Реферальная программа", order: 3, style: "primary", emojiKey: "LINK" },
  { id: "trial", visible: true, label: " Попробовать бесплатно", order: 4, style: "success", emojiKey: "TRIAL" },
  { id: "renew", visible: true, label: "🔄 Продлить подписку", order: 4.5, style: "primary" },
  { id: "vpn", visible: true, label: " Подключиться к VPN", order: 5, style: "danger", emojiKey: "SERVERS", onePerRow: true },
  { id: "cabinet", visible: true, label: " Web Кабинет", order: 6, style: "primary", emojiKey: "SERVERS" },
  { id: "tickets", visible: true, label: " Тикеты", order: 6.5, style: "primary", emojiKey: "NOTE" },
  { id: "support", visible: true, label: " Поддержка", order: 7, style: "primary", emojiKey: "NOTE" },
  { id: "promocode", visible: true, label: " Промокод", order: 8, style: "primary", emojiKey: "STAR" },
  { id: "gift", visible: true, label: " Подарки", order: 8.5, style: "primary", emojiKey: "TRIAL" },
  { id: "roulette", visible: true, label: "🎰 Рулетка", order: 8.7, style: "primary", emojiKey: "STAR" },
  { id: "extra_options", visible: true, label: " Доп. опции", order: 9, style: "primary", emojiKey: "PACKAGE" },
  // Кастомные кнопки. Используются в главном меню.
  { id: "my_subs", visible: true, label: " Мои подписки", order: 3, style: "", onePerRow: true },
  { id: "tg_proxy", visible: true, label: " Бесплатный Прокси для Telegram", order: 8, style: "", onePerRow: true },
  { id: "site", visible: true, label: " Сайт", order: 10, style: "", onePerRow: true },
];

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

const BOT_EMOJI_KEYS = ["HEADER", "MAIN_MENU", "STATUS", "BALANCE", "TARIFFS", "PACKAGE", "PROFILE", "CARD", "TRIAL", "LINK", "SERVERS", "BACK", "BACK_TO_PROFILE", "BACK_TO_SUB", "BACK_TO_SUBS_LIST", "PUZZLE", "DATE", "TIME", "TRAFFIC", "ACTIVE_GREEN", "ACTIVE_YELLOW", "INACTIVE", "CONNECT", "NOTE", "STAR", "CROWN", "DURATION", "DEVICES", "LOCATION", "CUSTOM_1", "CUSTOM_2", "CUSTOM_3", "CUSTOM_4", "CUSTOM_5"] as const;

export const DEFAULT_BOT_MENU_TEXTS: Record<string, string> = {
  welcomeTitlePrefix: " ",
  welcomeGreeting: " Добро пожаловать в ",
  balancePrefix: " Баланс: ",
  telegramIdPrefix: "🆔 Telegram ID: ",
  tariffPrefix: " Ваш тариф : ",
  subscriptionPrefix: " Статус подписки — ",
  statusInactive: " Истекла",
  statusActive: " Активна",
  statusExpired: " Истекла",
  statusLimited: " Ограничена",
  statusDisabled: " Отключена",
  expirePrefix: " до ",
  daysLeftPrefix: " осталось ",
  devicesLabel: " Устройств: ",
  devicesAvailable: " доступно",
  trafficPrefix: " Трафик — ",
  linkLabel: " Ссылка подключения:",
  chooseAction: "Выберите действие:",
  subsCountLabel: " Подписок: ",
  subLineFormat: "{{SUB_STATUS}} {{SUB_TYPE}} Подписка #{{SUB_NUM}} — **{{SUB_DAYS}}** до {{SUB_DATE}}{{SUB_TRAFFIC}}",
};

export const DEFAULT_BOT_TARIFFS_TEXT = "Тарифы\n\n{{CATEGORY}}\n{{TARIFFS}}\n\nВыберите тариф для оплаты:";
export const DEFAULT_BOT_PAYMENT_TEXT = "Оплата: {{NAME}} — {{PRICE}}\n\n{{ACTION}}";

export const DEFAULT_BOT_TARIFF_FIELDS: Record<string, boolean> = {
  name: true,
  durationDays: false,
  price: true,
  currency: true,
  trafficLimit: false,
  deviceLimit: false,
};

export const DEFAULT_BOT_MENU_LINE_VISIBILITY: Record<string, boolean> = {
  welcomeTitlePrefix: true,
  welcomeGreeting: true,
  balancePrefix: true,
  telegramIdPrefix: true,
  tariffPrefix: true,
  subscriptionPrefix: true,
  expirePrefix: true,
  daysLeftPrefix: true,
  devicesLabel: true,
  trafficPrefix: true,
  linkLabel: true,
  chooseAction: true,
};

const BOT_TARIFF_FIELD_LABELS: Record<string, string> = {
  name: "Название",
  durationDays: "Длительность (дни)",
  price: "Цена",
  currency: "Валюта",
  trafficLimit: "Лимит трафика",
  deviceLimit: "Лимит устройств",
};

const BOT_MENU_LINE_LABELS: Record<string, string> = {
  welcomeTitlePrefix: "Название бота",
  welcomeGreeting: "Приветствие",
  balancePrefix: "Баланс",
  telegramIdPrefix: "Telegram ID",
  tariffPrefix: "Тариф",
  subscriptionPrefix: "Статус подписки",
  expirePrefix: "Дата окончания",
  daysLeftPrefix: "Осталось дней",
  devicesLabel: "Устройства",
  trafficPrefix: "Трафик",
  linkLabel: "Ссылка подключения",
  chooseAction: "Призыв к действию",
};

/** Все ключи стилей внутренних кнопок и их дефолты — при изменении одного не терять остальные */
export const DEFAULT_BOT_INNER_STYLES: Record<string, string> = {
  tariffPay: "success",
  topup: "primary",
  back: "danger",
  profile: "primary",
  trialConfirm: "success",
  lang: "primary",
  currency: "primary",
  backProfile: "danger",
};

const BOT_MENU_TEXT_LABELS: Record<string, string> = {
  welcomeTitlePrefix: "Заголовок (префикс перед названием)",
  welcomeGreeting: "Приветствие",
  balancePrefix: "Подпись баланса",
  telegramIdPrefix: "Подпись Telegram ID",
  tariffPrefix: "Подпись тарифа (Ваш тариф : …)",
  subscriptionPrefix: "Подпись статуса подписки",
  statusInactive: "Статус: не активна",
  statusActive: "Статус: активна",
  statusExpired: "Статус: истекла",
  statusLimited: "Статус: ограничена",
  statusDisabled: "Статус: отключена",
  expirePrefix: "Подпись даты окончания",
  daysLeftPrefix: "Подпись «осталось дней»",
  devicesLabel: "Подпись устройств",
  devicesAvailable: "Суффикс «доступно»",
  trafficPrefix: "Подпись трафика",
  linkLabel: "Подпись ссылки подключения",
  chooseAction: "Призыв к действию",
  subsCountLabel: "Мульти: счётчик подписок ( Подписок: N)",
  subLineFormat: "Мульти: формат строки подписки — плейсхолдеры {{SUB_STATUS}} {{SUB_TYPE}} {{SUB_NUM}} {{SUB_DAYS}} {{SUB_DATE}} {{SUB_TRAFFIC}}",
};

/** Человеко-читаемые описания emoji-ключей для админки (вместо технических HEADER, BALANCE и т.п.). */
const BOT_EMOJI_LABELS: Record<string, string> = {
  HEADER: "Заголовок главного меню",
  MAIN_MENU: "Иконка «Главное меню»",
  STATUS: "Статус подписки",
  BALANCE: "Баланс",
  TARIFFS: "Раздел «Тарифы»",
  PACKAGE: "Пакет / Тариф",
  PROFILE: "Профиль",
  CARD: "Оплата / Карта",
  TRIAL: "Триал / Подарок",
  LINK: "Ссылка / Реферал",
  SERVERS: "VPN / Серверы",
  BACK: "Кнопка «Назад»",
  BACK_TO_PROFILE: "Кнопка «Назад» (в профиль)",
  BACK_TO_SUB: "Кнопка «К подписке»",
  BACK_TO_SUBS_LIST: "Кнопка «К списку подписок»",
  PUZZLE: "Меню профиля",
  DATE: "Дата окончания",
  TIME: "Осталось дней",
  TRAFFIC: "Трафик",
  ACTIVE_GREEN: "Активно (зелёный)",
  ACTIVE_YELLOW: "Ограничено (жёлтый)",
  INACTIVE: "Неактивно (серый)",
  CONNECT: "Подключение",
  NOTE: "Поддержка / Заметка",
  STAR: "Промокод / Звезда",
  CROWN: "Премиум / Корона",
  DURATION: "Длительность",
  DEVICES: "Устройства",
  LOCATION: "Локация",
  CUSTOM_1: "Свой эмодзи №1",
  CUSTOM_2: "Свой эмодзи №2",
  CUSTOM_3: "Свой эмодзи №3",
  CUSTOM_4: "Свой эмодзи №4",
  CUSTOM_5: "Свой эмодзи №5",
};

/** Опции стилей кнопок с цветовыми превью. Внутренние ID-стили примерно одинаковы в TG. */
const BOT_STYLE_OPTIONS: { value: string; label: string; swatch: string }[] = [
  { value: "", label: "По умолчанию", swatch: "bg-muted" },
  { value: "primary", label: "Синий", swatch: "bg-blue-500" },
  { value: "success", label: "Зелёный", swatch: "bg-emerald-500" },
  { value: "danger", label: "Красный", swatch: "bg-red-500" },
];

/** Человеко-читаемые имена кнопок главного меню по их id (для подсказок справа от ввода). */
const BOT_BUTTON_HUMAN_NAMES: Record<string, string> = {
  tariffs: "Список тарифов VPN",
  proxy: "Прокси-тарифы",
  my_proxy: "Мои прокси-доступы",
  singbox: "Singbox-доступы",
  my_singbox: "Мои singbox-доступы",
  profile: "Профиль клиента",
  devices: "Управление устройствами",
  topup: "Пополнение баланса",
  referral: "Реферальная программа",
  trial: "Бесплатный триал",
  vpn: "Подключение к VPN",
  renew: "Продление существующей подписки",
  cabinet: "Открыть веб-кабинет",
  tickets: "Тикеты поддержки",
  support: "Связь с поддержкой",
  promocode: "Ввод промокода",
  gift: "Подарочные коды",
  extra_options: "Доп. опции (трафик, устройства)",
};

/** Подсказки к текстам экранов бота: где это используется и какие переменные доступны. */
const BOT_INNER_STYLE_LABELS: Record<string, { label: string; desc: string }> = {
  tariffPay: { label: "Кнопка оплаты тарифа", desc: "Цвет кнопки выбора тарифа в списке" },
  topup: { label: "Кнопка пополнения", desc: "Цвет на экране пополнения баланса" },
  back: { label: "Кнопка «Назад»", desc: "Возврат в предыдущее меню" },
  profile: { label: "Кнопка профиля", desc: "Кнопки внутри экрана профиля" },
  trialConfirm: { label: "Подтверждение триала", desc: "Подтверждение активации триала" },
  lang: { label: "Выбор языка", desc: "Кнопки выбора языка интерфейса" },
  currency: { label: "Выбор валюты", desc: "Кнопки выбора валюты" },
  backProfile: { label: "Кнопка «Назад» (в профиль)", desc: "Возврат в меню профиля при включённых разделах в кабинете" },
};

export function BotTab({
  settings,
  setSettings,
  saving,
  message,
  saveBotMenu,
  botSubTab,
  setBotSubTab,
}: {
  settings: AdminSettings;
  setSettings: Dispatch<SetStateAction<AdminSettings | null>>;
  saving: boolean;
  message: string;
  saveBotMenu: () => void;
  botSubTab: "menu" | "texts" | "emoji" | "behavior" | "links";
  setBotSubTab: Dispatch<SetStateAction<"menu" | "texts" | "emoji" | "behavior" | "links">>;
}) {
  const { t } = useTranslation();

  return (
          <TabsContent value="bot">
            <Card className="overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border">
                <div className="absolute inset-0 bg-transparent pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      Настройки Telegram-бота
                    </h2>
                    <p className="text-[12.5px] text-muted-foreground mt-1">
                      Главное меню, тексты экранов, эмодзи, поведение и ссылки. Изменения подхватываются ботом автоматически после сохранения.
                    </p>
                  </div>
                </div>
              </div>
              <CardContent className="p-4 sm:p-4 space-y-6">
                <Tabs value={botSubTab} onValueChange={(v) => setBotSubTab(v as typeof botSubTab)}>
                  <TabsList className="w-full flex flex-wrap gap-1.5 p-1.5 h-auto bg-muted/40 rounded-xl border">
                    <TabsTrigger value="menu" className="gap-2 py-2.5 px-3 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:text-white data-[state=active]:shadow-md">
                      <Layers className="h-4 w-4 shrink-0" /><span className="text-xs sm:text-sm">Меню</span>
                    </TabsTrigger>
                    <TabsTrigger value="texts" className="gap-2 py-2.5 px-3 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:text-white data-[state=active]:shadow-md">
                      <MessageSquare className="h-4 w-4 shrink-0" /><span className="text-xs sm:text-sm">Тексты</span>
                    </TabsTrigger>
                    <TabsTrigger value="emoji" className="gap-2 py-2.5 px-3 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:text-white data-[state=active]:shadow-md">
                      <Smile className="h-4 w-4 shrink-0" /><span className="text-xs sm:text-sm">Эмодзи</span>
                    </TabsTrigger>
                    <TabsTrigger value="behavior" className="gap-2 py-2.5 px-3 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:text-white data-[state=active]:shadow-md">
                      <Sliders className="h-4 w-4 shrink-0" /><span className="text-xs sm:text-sm">Поведение</span>
                    </TabsTrigger>
                    <TabsTrigger value="links" className="gap-2 py-2.5 px-3 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:text-white data-[state=active]:shadow-md">
                      <Link2 className="h-4 w-4 shrink-0" /><span className="text-xs sm:text-sm">Ссылки</span>
                    </TabsTrigger>
                  </TabsList>

                  {/* === ВКЛАДКА: МЕНЮ === */}
                  <TabsContent value="menu" className="space-y-5 mt-5">
                    <BotCommandsSettings value={settings.botCommands} onChange={botCommands => setSettings(s => s ? { ...s, botCommands } : s)}/>
                    <div className="rounded-xl border border-sky-500/20 bg-muted p-4 space-y-3">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Кнопка возврата</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">Текст кнопки, которая возвращает в <b>главное меню</b> бота (на предыдущий экран ведёт отдельная кнопка «Назад»). Появляется почти на всех экранах.</p>
                      <Input
                        value={settings.botBackLabel ?? " В меню"}
                        onChange={(e) => setSettings((s) => (s ? { ...s, botBackLabel: e.target.value || " В меню" } : s))}
                        placeholder=" В меню"
                      />
                    </div>

                    {/* редактирование текстов
                        экранов бота вынесено в отдельный редактор «Тексты экранов бота» —
                        чтобы не дублировать настройку в двух местах. */}
                    <div className="rounded-xl border border-sky-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Кнопки главного меню</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">Добавляйте свои кнопки со ссылками на канал, сайт или инструкции. Меняйте порядок, название, видимость и оформление любых кнопок.</p>
                      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-card border border-border">
                        <Label htmlFor="bot-buttons-per-row" className="text-sm font-medium">Кнопок в ряд:</Label>
                        <select
                          id="bot-buttons-per-row"
                          className="flex h-9 rounded-lg border border-input bg-background px-3 py-1 text-sm"
                          value={settings.botButtonsPerRow ?? 1}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, botButtonsPerRow: e.target.value === "2" ? 2 : 1 } : s))
                          }
                        >
                          <option value={1}>1 — по одной</option>
                          <option value={2}>2 — парами</option>
                        </select>
                        <span className="text-xs text-muted-foreground">Глобально для всего меню (отдельные кнопки можно вытолкнуть в свою строку флагом ниже)</span>
                      </div>
                      <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                        <Label htmlFor="bot-menu-mode">Режим меню бота</Label>
                        <select id="bot-menu-mode" className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={settings.botMenuMode ?? "classic"} onChange={(e) => setSettings((s) => s ? { ...s, botMenuMode: e.target.value === "web" ? "web" : "classic" } : s)}>
                          <option value="classic">Классический — разделы в переписке</option>
                          <option value="web">Web — разделы в Mini App</option>
                        </select>
                        <p className="text-xs text-muted-foreground">Web-режиму нужен публичный HTTPS-адрес кабинета. Свои ссылки сохраняются. Новое меню появится после /start или возврата в меню; старые кнопки продолжат работать.</p>
                      </div>
                      <div className="rounded-xl border border-border p-3 space-y-3">
                        <label className="flex items-start gap-3">
                          <input type="checkbox" className="mt-1" checked={settings.botGroupCabinet ?? false} onChange={e => setSettings(s => s ? { ...s, botGroupCabinet: e.target.checked } : s)} />
                          <span>Разделы внутри личного кабинета<span className="block text-xs text-muted-foreground">Тарифы, подписки, устройства, баланс и бонусы будут внутри «Профиля». Кнопка профиля останется доступной. Web-кабинет и поддержка останутся в главном меню.</span></span>
                        </label>
                        {settings.botGroupCabinet && (
                          <div className="space-y-3 rounded-lg border border-border bg-card p-3">
                            <div>
                              <h4 className="text-sm font-semibold">Пункты внутри «Профиля»</h4>
                              <p className="text-xs text-muted-foreground">Отметьте пункты, которые должны находиться внутри меню «Профиль». Неотмеченные пункты останутся на главной странице бота.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => setSettings(s => s ? { ...s, botGroupCabinetItems: (s.botButtons ?? DEFAULT_BOT_BUTTONS).filter(b => b.id !== "profile").map(b => b.id) } : s)}>Выбрать все</Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => setSettings(s => s ? { ...s, botGroupCabinetItems: [...DEFAULT_CABINET_GROUPED_IDS] } : s)}>По умолчанию</Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => setSettings(s => s ? { ...s, botGroupCabinetItems: [] } : s)}>Снять все</Button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                              {(settings.botButtons ?? DEFAULT_BOT_BUTTONS).filter(b => b.id !== "profile").map(b => {
                                const selected = (settings.botGroupCabinetItems ?? DEFAULT_CABINET_GROUPED_IDS).includes(b.id);
                                return (
                                  <label key={b.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      onChange={e => setSettings(s => {
                                        if (!s) return s;
                                        const current = s.botGroupCabinetItems ?? DEFAULT_CABINET_GROUPED_IDS;
                                        const next = e.target.checked ? [...current.filter(id => id !== b.id), b.id] : current.filter(id => id !== b.id);
                                        return { ...s, botGroupCabinetItems: next };
                                      })}
                                    />
                                    <span className="text-sm">{b.label || b.id}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                      <BotButtonsList
                        onSave={saveBotMenu}
                        saving={saving}
                        buttons={[...(settings.botButtons ?? DEFAULT_BOT_BUTTONS)].sort((a, b) => a.order - b.order)}
                        onChange={(updated) => setSettings((s) => (s ? { ...s, botButtons: updated } : s))}
                      />
                      <p className="text-xs text-muted-foreground rounded-lg bg-card border border-border p-2.5 flex items-start gap-2">
                        <Wallet className="h-4 w-4" aria-hidden="true"/>
                        <span>Перетаскивайте кнопки за ⋮⋮ ручку слева, чтобы менять порядок. «Во всю ширину» вытолкнет кнопку на отдельную строку даже в режиме 2-колоночного меню.</span>
                      </p>
                    </div>
                  </TabsContent>

                  {/* === ВКЛАДКА: ЭМОДЗИ === */}
                  <TabsContent value="emoji" className="space-y-5 mt-5">
                    <div className="rounded-xl border border-amber-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Эмодзи и премиум-иконки</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_emojis_hint")}</p>
                      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                        <Sparkles className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700 dark:text-amber-300">{t("admin.settings.bot_emojis_premium_warn")}</p>
                      </div>
                      <div className="rounded-xl border border-border overflow-hidden bg-card/40">
                        <div className="grid grid-cols-[1fr_90px_1fr] gap-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                          <div className="py-2.5 px-3">Назначение</div>
                          <div className="py-2.5 px-2 text-center">Unicode</div>
                          <div className="py-2.5 px-3">Premium ID (Telegram)</div>
                        </div>
                        <div className="divide-y divide-border">
                          {BOT_EMOJI_KEYS.map((key) => {
                            const raw = (settings.botEmojis ?? {})[key];
                            const entry = typeof raw === "object" && raw !== null ? raw : { unicode: typeof raw === "string" ? raw : undefined, tgEmojiId: undefined };
                            return (
                              <div key={key} className="grid grid-cols-[1fr_90px_1fr] gap-0 items-center hover:bg-muted/20 transition-colors">
                                <div className="py-2 px-3">
                                  <div className="text-sm font-medium">{BOT_EMOJI_LABELS[key] ?? key}</div>
                                  <div className="text-[10px] text-muted-foreground font-mono">{key}</div>
                                </div>
                                <div className="py-2 px-2">
                                  <Input
                                    className="h-9 w-full p-1 text-center text-base"
                                    value={entry.unicode ?? ""}
                                    onChange={(e) =>
                                      setSettings((s) => {
                                        if (!s) return s;
                                        const prev = (s.botEmojis ?? {})[key];
                                        const prevObj = typeof prev === "object" && prev !== null ? prev : { unicode: typeof prev === "string" ? prev : undefined, tgEmojiId: undefined };
                                        return { ...s, botEmojis: { ...(s.botEmojis ?? {}), [key]: { ...prevObj, unicode: e.target.value || undefined } } };
                                      })
                                    }
                                    placeholder=""
                                  />
                                </div>
                                <div className="py-2 px-3">
                                  <Input
                                    className="h-9 min-w-0 text-xs font-mono"
                                    value={entry.tgEmojiId ?? ""}
                                    onChange={(e) =>
                                      setSettings((s) => {
                                        if (!s) return s;
                                        const prev = (s.botEmojis ?? {})[key];
                                        const prevObj = typeof prev === "object" && prev !== null ? prev : { unicode: typeof prev === "string" ? prev : undefined, tgEmojiId: undefined };
                                        return { ...s, botEmojis: { ...(s.botEmojis ?? {}), [key]: { ...prevObj, tgEmojiId: e.target.value || undefined } } };
                                      })
                                    }
                                    placeholder="5289722755871162900"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Цвета вторичных кнопок</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_inner_styles_hint")}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {Object.keys(BOT_INNER_STYLE_LABELS).map((key) => {
                          const meta = BOT_INNER_STYLE_LABELS[key]!;
                          const currentVal = (settings.botInnerButtonStyles ?? {})[key] ?? "";
                          const swatch = BOT_STYLE_OPTIONS.find((o) => o.value === currentVal)?.swatch ?? "bg-muted";
                          return (
                            <div key={key} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card/40">
                              <div className={`h-3 w-3 rounded-full ${swatch} shrink-0 ring-2 ring-white/10`} />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{meta.label}</div>
                                <div className="text-[11px] text-muted-foreground truncate">{meta.desc}</div>
                              </div>
                              <select
                                className="flex h-9 w-32 shrink-0 rounded-md border border-input bg-background px-2 py-1 text-sm"
                                value={currentVal}
                                onChange={(e) =>
                                  setSettings((s) => {
                                    if (!s) return s;
                                    const next = { ...DEFAULT_BOT_INNER_STYLES, ...(s.botInnerButtonStyles ?? {}), [key]: e.target.value };
                                    return { ...s, botInnerButtonStyles: next };
                                  })
                                }
                              >
                                {BOT_STYLE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </TabsContent>

                  {/* === ВКЛАДКА: ТЕКСТЫ === */}
                  <TabsContent value="texts" className="space-y-5 mt-5">
                    {/*  Приветственное сообщение при /start  */}
                    <div className="rounded-xl border border-emerald-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-xl bg-emerald-500/20 flex items-center justify-center"></div>
                          <div>
                            <h3 className="text-base font-semibold">Приветственное сообщение</h3>
                            <p className="text-xs text-muted-foreground">Показывается клиенту при первом /start. Картинка-баннер + текст + кнопка «Войти».</p>
                          </div>
                        </div>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <Switch
                            checked={settings.botWelcomeEnabled ?? false}
                            onCheckedChange={(checked: boolean) => setSettings((s) => (s ? { ...s, botWelcomeEnabled: checked === true } : s))}
                          />
                          <span className="text-sm">Включить</span>
                        </label>
                      </div>
                      <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                        <div className="space-y-2">
                          <Label className="text-xs">Текст приветствия</Label>
                          <textarea
                            className="w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={settings.botWelcomeText ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, botWelcomeText: e.target.value || null } : s))}
                            placeholder={"Добро пожаловать в VPN!\n\n Высокая скорость\n Удаляем рекламу\n Огромный запас трафика\n Платим 30% с платежей друзей"}
                            maxLength={4000}
                          />
                          <p className="text-[10px] text-muted-foreground">До 4000 символов. Эмодзи поддерживаются. Если задана картинка — текст идёт как caption (макс. 1024 символа в Telegram).</p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Картинка-баннер (PNG / JPG / GIF / WEBP, до 5 МБ)</Label>
                          <div className="flex items-center gap-3 flex-wrap">
                            {settings.botWelcomeImage && (
                              <img
                                src={settings.botWelcomeImage}
                                alt="welcome"
                                className="h-28 w-auto rounded-md border border-border object-cover"
                              />
                            )}
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/gif,image/webp"
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                if (f.size > 5_000_000) {
                                  (await adminAlert("Файл больше 5 МБ — попробуйте сжать."));
                                  return;
                                }
                                const reader = new FileReader();
                                reader.onload = () => {
                                  const url = String(reader.result || "");
                                  setSettings((s) => (s ? { ...s, botWelcomeImage: url } : s));
                                };
                                reader.readAsDataURL(f);
                              }}
                              className="text-xs"
                            />
                            {settings.botWelcomeImage && (
                              <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, botWelcomeImage: null } : s))}>
                                Убрать картинку
                              </Button>
                            )}
                          </div>
                        </div>
                        <label className="inline-flex items-center gap-2 cursor-pointer text-xs pt-2 border-t border-border">
                          <Switch
                            checked={settings.botWelcomeShowOnce ?? true}
                            onCheckedChange={(checked: boolean) => setSettings((s) => (s ? { ...s, botWelcomeShowOnce: checked === true } : s))}
                          />
                          <span>Показывать только при первом /start (пока клиент не нажал «Войти в кабинет»)</span>
                        </label>
                      </div>
                    </div>

                    <div className="rounded-xl border border-violet-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Главное меню — содержимое</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_welcome_hint")}</p>
                      <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Eye className="h-4 w-4 text-violet-500" />
                            <Label className="text-sm font-medium">Какие строки показывать</Label>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setSettings((s) => (s ? { ...s, botMenuLineVisibility: { ...DEFAULT_BOT_MENU_LINE_VISIBILITY } } : s))}
                          >
                            <RotateCw className="h-3.5 w-3.5 mr-1" />Сброс
                          </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {Object.keys(DEFAULT_BOT_MENU_LINE_VISIBILITY).map((key) => {
                            const visible = (settings.botMenuLineVisibility ?? DEFAULT_BOT_MENU_LINE_VISIBILITY)[key] !== false;
                            return (
                              <label key={key} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/30 cursor-pointer transition-colors">
                                <Switch
                                  checked={visible}
                                  onCheckedChange={(checked: boolean) =>
                                    setSettings((s) =>
                                      s ? { ...s, botMenuLineVisibility: { ...(s.botMenuLineVisibility ?? DEFAULT_BOT_MENU_LINE_VISIBILITY), [key]: checked === true } } : s
                                    )
                                  }
                                />
                                <span className="text-sm">{BOT_MENU_LINE_LABELS[key] ?? key}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button type="button" variant="outline" className="w-full justify-between rounded-xl">
                            <span className="flex items-center gap-2"><FileText className="h-4 w-4" />Тексты строк меню</span>
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="pt-3 space-y-3 border-t mt-3">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setSettings((s) => (s ? { ...s, botMenuTexts: { ...DEFAULT_BOT_MENU_TEXTS } } : s))}
                            >
                              <RotateCw className="h-3.5 w-3.5 mr-1" />Сбросить тексты
                            </Button>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {Object.keys(DEFAULT_BOT_MENU_TEXTS).map((key) => (
                                <div key={key} className="space-y-1">
                                  <Label className="text-xs">{BOT_MENU_TEXT_LABELS[key] ?? key}</Label>
                                  <Input
                                    value={settings.botMenuTexts?.[key] ?? DEFAULT_BOT_MENU_TEXTS[key] ?? ""}
                                    onChange={(e) =>
                                      setSettings((s) =>
                                        s ? { ...s, botMenuTexts: { ...(s.botMenuTexts ?? DEFAULT_BOT_MENU_TEXTS), [key]: e.target.value } } : s
                                      )
                                    }
                                    placeholder={DEFAULT_BOT_MENU_TEXTS[key]}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>

                    <div className="rounded-xl border border-violet-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Экран «Тарифы»</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_tariffs_hint")}</p>
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Шаблон сообщения</Label>
                        <Textarea
                          rows={6}
                          value={settings.botTariffsText ?? DEFAULT_BOT_TARIFFS_TEXT}
                          onChange={(e) => setSettings((s) => (s ? { ...s, botTariffsText: e.target.value } : s))}
                          placeholder={DEFAULT_BOT_TARIFFS_TEXT}
                          className="font-mono text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground">Доступные плейсхолдеры: <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{CATEGORY}}`}</code> — название категории, <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{TARIFFS}}`}</code> — список тарифов</p>
                      </div>
                      <div className="rounded-xl border border-border bg-card/40 p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-sm font-medium">Поля в карточке тарифа</Label>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setSettings((s) => (s ? { ...s, botTariffsFields: { ...DEFAULT_BOT_TARIFF_FIELDS } } : s))}
                          >
                            <RotateCw className="h-3.5 w-3.5 mr-1" />Сброс
                          </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {Object.keys(DEFAULT_BOT_TARIFF_FIELDS).map((key) => {
                            const enabled = (settings.botTariffsFields ?? DEFAULT_BOT_TARIFF_FIELDS)[key] !== false;
                            return (
                              <label key={key} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/30 cursor-pointer transition-colors">
                                <Switch
                                  checked={enabled}
                                  onCheckedChange={(checked: boolean) =>
                                    setSettings((s) =>
                                      s ? { ...s, botTariffsFields: { ...(s.botTariffsFields ?? DEFAULT_BOT_TARIFF_FIELDS), [key]: checked === true } } : s
                                    )
                                  }
                                />
                                <span className="text-sm">{BOT_TARIFF_FIELD_LABELS[key] ?? key}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-violet-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Окно оплаты</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_payment_hint")}</p>
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Шаблон сообщения оплаты</Label>
                        <Textarea
                          rows={5}
                          value={settings.botPaymentText ?? DEFAULT_BOT_PAYMENT_TEXT}
                          onChange={(e) => setSettings((s) => (s ? { ...s, botPaymentText: e.target.value } : s))}
                          placeholder={DEFAULT_BOT_PAYMENT_TEXT}
                          className="font-mono text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground">Плейсхолдеры: <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{NAME}}`}</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{PRICE}}`}</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{AMOUNT}}`}</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{CURRENCY}}`}</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{ACTION}}`}</code></p>
                      </div>
                    </div>
                  </TabsContent>
                  {/* === ВКЛАДКА: ПОВЕДЕНИЕ === */}
                  <TabsContent value="behavior" className="space-y-5 mt-5">
                    <div className="rounded-xl border border-emerald-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Инфо-блок (объявления)</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Произвольный текст, который показывается в главном меню бота и в кабинете клиента.
                        Используй для объявлений тех. работ, акций, контактов поддержки. Скрывается если поле пустое.
                      </p>
                      <Textarea
                        value={settings.botInfoBlock ?? ""}
                        onChange={(e) =>
                          setSettings((s) => (s ? { ...s, botInfoBlock: e.target.value.length ? e.target.value : null } : s))
                        }
                        rows={4}
                        maxLength={2000}
                        placeholder=" Тех. работы 12.05 с 03:00 до 05:00 МСК&#10; Поддержка: @support_bot"
                      />
                      <p className="text-[11px] text-muted-foreground text-right">{(settings.botInfoBlock ?? "").length} / 2000</p>
                    </div>

                    <div className="rounded-xl border border-emerald-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-semibold mb-1">Авто-удаление нераспознанных сообщений</h3>
                          <p className="text-xs text-muted-foreground">
                            Бот удаляет сообщения, которые не команды и не активный ввод (стикеры, случайный текст, фото).
                            Чат остаётся чистым. Требует право «Delete messages» у бота.
                          </p>
                        </div>
                        <Switch
                          checked={!!settings.botAutoDeleteUnknownMessages}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, botAutoDeleteUnknownMessages: checked === true } : s))
                          }
                        />
                      </div>
                    </div>

                    {/* Тогглы сервисных кнопок на экране «Тарифы» бота */}
                    <div className="rounded-xl border border-emerald-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Кнопки на экране «Тарифы»</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Сервисные кнопки под списком тарифов в боте. Выключи, если не продаёшь доп. устройства
                        или не хочешь показывать баланс на этом экране.
                      </p>
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                        <Switch
                          checked={settings.botTariffsShowExtraDevicesButton !== false}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, botTariffsShowExtraDevicesButton: checked === true } : s))
                          }
                        />
                        <Label className="text-sm">Кнопка «Докупить устройство» в Тарифах</Label>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                        <Switch
                          checked={settings.botTariffsShowBalanceButton !== false}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, botTariffsShowBalanceButton: checked === true } : s))
                          }
                        />
                        <Label className="text-sm">Кнопка «Мой баланс» в Тарифах</Label>
                      </div>
                      <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                        <Switch id="htmlbubbles-test" checked={settings.botHtmlBubblesTest === true} onCheckedChange={checked => setSettings(s => s ? { ...s, botHtmlBubblesTest: checked === true } : s)} />
                        <div className="space-y-1"><Label htmlFor="htmlbubbles-test">htmlbubbles test</Label><p className="text-xs text-muted-foreground">Интерактивные меню внутри сообщений Telegram. Только личные чаты и актуальные клиенты. Email, промокоды и обращения вводятся сообщением боту. Под каждым виджетом доступен переход к обычному меню.</p></div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                        <Switch
                          checked={settings.botShowTariffCategories !== false}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, botShowTariffCategories: checked === true } : s))
                          }
                        />
                        <div className="space-y-0.5">
                          <Label className="text-sm">Меню выбора категорий</Label>
                          <p className="text-[11px] text-muted-foreground">
                            Включено — при входе в «Тарифы» бот сначала покажет категории. Выключено — сразу плоский список тарифов.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Обязательная подписка на канал</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_force_hint")}</p>
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                        <Switch
                          checked={!!settings.forceSubscribeEnabled}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, forceSubscribeEnabled: checked === true } : s))
                          }
                        />
                        <Label className="text-sm">{t("admin.settings.bot_check_subscribe")}</Label>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">ID канала или @username</Label>
                        <Input
                          value={settings.forceSubscribeChannelId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, forceSubscribeChannelId: e.target.value || null } : s))}
                          placeholder={t("admin.settings.bot_channel_placeholder")}
                          disabled={!settings.forceSubscribeEnabled}
                        />
                        <p className="text-[11px] text-muted-foreground">{t("admin.settings.bot_channel_hint")}</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Сообщение для не подписанных</Label>
                        <Input
                          value={settings.forceSubscribeMessage ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, forceSubscribeMessage: e.target.value || null } : s))}
                          placeholder={t("admin.settings.bot_unsub_placeholder")}
                          disabled={!settings.forceSubscribeEnabled}
                        />
                        <p className="text-[11px] text-muted-foreground">{t("admin.settings.bot_unsub_hint")}</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-red-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-semibold mb-1">Community Blacklist</h3>
                          <p className="text-xs text-muted-foreground">{t("admin.settings.bot_blacklist_hint")}</p>
                        </div>
                        <Switch
                          checked={!!settings.blacklistEnabled}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, blacklistEnabled: checked === true } : s))
                          }
                        />
                      </div>
                    </div>
                  </TabsContent>

                  {/* === ВКЛАДКА: ССЫЛКИ === */}
                  <TabsContent value="links" className="space-y-5 mt-5">
                    <div className="rounded-xl border border-rose-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold">Ссылки и поддержка</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_support_hint")}</p>
                      <div className="grid gap-3">
                        <div className="space-y-1.5 p-4 rounded-xl border border-border bg-card/40">
                          <div className="flex items-center gap-2 mb-1">
                            <MessageCircle className="h-4 w-4 text-rose-500" />
                            <Label className="text-sm font-medium">Техническая поддержка</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Username аккаунта поддержки или t.me-ссылка. Появляется в кнопке «Поддержка» в главном меню.</p>
                          <Input
                            value={settings.supportLink ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, supportLink: e.target.value } : s))}
                            placeholder={t("admin.settings.bot_support_placeholder")}
                          />
                        </div>
                        <div className="space-y-1.5 p-4 rounded-xl border border-border bg-card/40">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-pink-500" />
                            <Label className="text-sm font-medium">Пользовательское соглашение</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Telegra.ph или внешняя страница с правилами использования сервиса.</p>
                          <Input
                            value={settings.agreementLink ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, agreementLink: e.target.value } : s))}
                            placeholder="https://telegra.ph/..."
                          />
                        </div>
                        <div className="space-y-1.5 p-4 rounded-xl border border-border bg-card/40">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-fuchsia-500" />
                            <Label className="text-sm font-medium">Публичная оферта</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Юридическая оферта (особенно нужна при работе через ИП/самозанятость).</p>
                          <Input
                            value={settings.offerLink ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, offerLink: e.target.value } : s))}
                            placeholder="https://telegra.ph/..."
                          />
                        </div>
                        <div className="space-y-1.5 p-4 rounded-xl border border-border bg-card/40">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-purple-500" />
                            <Label className="text-sm font-medium">Инструкции по подключению</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Инструкции для клиентов как подключить VPN на разных устройствах.</p>
                          <Input
                            value={settings.instructionsLink ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, instructionsLink: e.target.value } : s))}
                            placeholder="https://telegra.ph/..."
                          />
                        </div>
                        {/* инструкция по рефералке — кнопка «Инструкции» в разделе рефералки бота. */}
                        <div className="space-y-1.5 p-4 rounded-xl border border-border bg-card/40">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-emerald-500" />
                            <Label className="text-sm font-medium">Инструкция по реферальной программе</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Telegra.ph-статья «Как пользоваться рефералкой». Кнопка «Инструкции» под «Поделиться ссылкой» в разделе рефералки бота. Пусто = дефолтная ссылка.</p>
                          <Input
                            value={settings.referralInstructionsUrl ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, referralInstructionsUrl: e.target.value } : s))}
                            placeholder="https://telegra.ph/Kak-polzovatsya-referalnoj-programmoj-i-zarabatyvat-05-28"
                          />
                        </div>
                        {/* T11 (11.05.2026): Политика возврата (Telegraph URL). Кнопка появляется в боте «Помощь  Документы». */}
                        <div className="space-y-1.5 p-4 rounded-xl border border-border bg-card/40">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-amber-500" />
                            <Label className="text-sm font-medium">Политика возврата</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Telegra.ph-страница с правилами возврата средств. Появляется кнопкой в «Помощь  Документы».</p>
                          <Input
                            value={(settings as { refundLink?: string | null }).refundLink ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, refundLink: e.target.value } as typeof s : s))}
                            placeholder="https://telegra.ph/..."
                          />
                        </div>
                        {/* Текст экрана «Помощь» (help_intro_text) — большой rich-text «цели/приоритеты». */}
                        <div className="space-y-1.5 p-4 rounded-xl border border-border bg-card/40 sm:col-span-2">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-cyan-500" />
                            <Label className="text-sm font-medium">Текст экрана «Помощь»</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Большой блок «цели / приоритеты / правила» в разделе «Помощь» бота. Поддерживает несколько строк и эмодзи. Пусто = скрыт.</p>
                          <textarea
                            className="w-full min-h-[200px] rounded-xl border border-input bg-background px-3 py-2 text-sm"
                            value={(settings as { helpIntroText?: string | null }).helpIntroText ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, helpIntroText: e.target.value || undefined } as typeof s : s))}
                            placeholder="Обращайтесь к нам по любым вопросам и предложениям &#10;&#10; Наша цель — ..."
                            maxLength={8000}
                          />
                        </div>
                      </div>
                    </div>

                    {/* настройки экрана «Бесплатный Прокси для Telegram».
                        Текст экрана + динамический список прокси-серверов (любое кол-во стран).
                        Каждая запись = {flag, name, url}. Бот рендерит по кнопке на каждый
                        элемент в порядке списка. Старые поля primary/backup используются
                        только как fallback если массив пуст. */}
                    <div className="rounded-xl border border-sky-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-semibold"> Бесплатный Telegram-прокси</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Кнопка «Бесплатный Прокси для Telegram» в главном меню бота. Открывает экран с инструкцией и кнопками-странами. Добавь столько прокси-серверов, сколько нужно — каждый рендерится отдельной кнопкой в порядке списка.
                      </p>
                      <div className="grid gap-3">
                        <div className="space-y-1.5 p-4 rounded-xl border border-border bg-card/40">
                          <Label className="text-sm font-medium">Текст экрана</Label>
                          <p className="text-[11px] text-muted-foreground mb-2">Markdown-текст инструкции (что такое прокси, как подключить/отключить). Показывается над кнопками.</p>
                          <textarea
                            className="w-full min-h-[160px] rounded-xl border border-input bg-background px-3 py-2 text-sm font-mono"
                            value={settings.tgProxyText ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, tgProxyText: e.target.value || undefined } : s))}
                            placeholder=" Бесплатный прокси для Telegram&#10;&#10;Что такое прокси?..."
                            maxLength={8000}
                          />
                        </div>

                        {/* Список серверов */}
                        <div className="space-y-2 p-4 rounded-xl border border-border bg-card/40">
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-sm font-medium">Прокси-серверы</Label>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setSettings((s) => {
                                if (!s) return s;
                                const list = ((s as { tgProxyServers?: { flag: string; name: string; url: string }[] | null }).tgProxyServers) ?? [];
                                return { ...s, tgProxyServers: [...list, { flag: "", name: "", url: "" }] } as typeof s;
                              })}
                            >
                              + Добавить страну
                            </Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">URL формата <code className="text-[10px] bg-foreground/5 px-1 py-0.5 rounded">tg://proxy?server=IP&amp;port=4433&amp;secret=ee...</code>. Порядок в списке = порядок кнопок в боте. Стрелочки  — поменять местами,  — удалить.</p>
                          {(() => {
                            const list = ((settings as { tgProxyServers?: { flag: string; name: string; url: string }[] | null }).tgProxyServers) ?? [];
                            if (list.length === 0) {
                              return <p className="text-[11px] text-muted-foreground italic p-3 text-center bg-foreground/[0.02] rounded-lg">Список пуст. Добавь хотя бы один прокси-сервер.</p>;
                            }
                            return (
                              <div className="space-y-2">
                                {list.map((srv, idx) => (
                                  <div key={idx} className="flex items-start gap-2 p-2 rounded-lg border border-border bg-card">
                                    <div className="flex flex-col gap-1 pt-1">
                                      <button
                                        type="button"
                                        disabled={idx === 0}
                                        title="Вверх"
                                        className="text-xs disabled:opacity-30 hover:text-primary"
                                        onClick={() => setSettings((s) => {
                                          if (!s) return s;
                                          const arr = [...((s as { tgProxyServers?: typeof list }).tgProxyServers ?? [])];
                                          if (idx <= 0) return s;
                                          [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                                          return { ...s, tgProxyServers: arr } as typeof s;
                                        })}
                                      ></button>
                                      <button
                                        type="button"
                                        disabled={idx === list.length - 1}
                                        title="Вниз"
                                        className="text-xs disabled:opacity-30 hover:text-primary"
                                        onClick={() => setSettings((s) => {
                                          if (!s) return s;
                                          const arr = [...((s as { tgProxyServers?: typeof list }).tgProxyServers ?? [])];
                                          if (idx >= arr.length - 1) return s;
                                          [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                                          return { ...s, tgProxyServers: arr } as typeof s;
                                        })}
                                      ></button>
                                    </div>
                                    <Input
                                      className="w-16 text-center"
                                      value={srv.flag}
                                      onChange={(e) => setSettings((s) => {
                                        if (!s) return s;
                                        const arr = [...((s as { tgProxyServers?: typeof list }).tgProxyServers ?? [])];
                                        arr[idx] = { ...arr[idx], flag: e.target.value };
                                        return { ...s, tgProxyServers: arr } as typeof s;
                                      })}
                                      placeholder=""
                                      maxLength={8}
                                    />
                                    <Input
                                      className="w-40"
                                      value={srv.name}
                                      onChange={(e) => setSettings((s) => {
                                        if (!s) return s;
                                        const arr = [...((s as { tgProxyServers?: typeof list }).tgProxyServers ?? [])];
                                        arr[idx] = { ...arr[idx], name: e.target.value };
                                        return { ...s, tgProxyServers: arr } as typeof s;
                                      })}
                                      placeholder="Название (Нидерланды)"
                                      maxLength={50}
                                    />
                                    <Input
                                      className="flex-1 font-mono text-[11px]"
                                      value={srv.url}
                                      onChange={(e) => setSettings((s) => {
                                        if (!s) return s;
                                        const arr = [...((s as { tgProxyServers?: typeof list }).tgProxyServers ?? [])];
                                        arr[idx] = { ...arr[idx], url: e.target.value };
                                        return { ...s, tgProxyServers: arr } as typeof s;
                                      })}
                                      placeholder="tg://proxy?server=...&port=4433&secret=ee..."
                                      maxLength={2000}
                                    />
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      title="Удалить"
                                      className="text-destructive hover:bg-destructive/10"
                                      onClick={() => setSettings((s) => {
                                        if (!s) return s;
                                        const arr = [...((s as { tgProxyServers?: typeof list }).tgProxyServers ?? [])];
                                        arr.splice(idx, 1);
                                        return { ...s, tgProxyServers: arr } as typeof s;
                                      })}
                                    ></Button>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>

                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving} className="w-full sm:w-auto h-9 px-6 rounded-xl bg-primary hover:opacity-90 text-white font-semibold shadow-primary/20">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
  );
}

function BotButtonsList({
  buttons,
  onChange,
  onSave,
  saving,
}: {
  buttons: BotButtonItem[];
  onChange: (updated: BotButtonItem[]) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const moveButton = (id: string, newIdx: number) => {
    const oldIdx = buttons.findIndex((button) => button.id === id);
    if (oldIdx < 0 || newIdx < 0 || newIdx >= buttons.length || oldIdx === newIdx) return;
    onChange(arrayMove(buttons, oldIdx, newIdx).map((button, index) => ({ ...button, order: index + 1 })));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    moveButton(String(active.id), buttons.findIndex((button) => button.id === over.id));
  };

  const updateButton = (id: string, patch: Partial<BotButtonItem>) => {
    onChange(buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const customCount = buttons.filter((button) => button.id.startsWith("custom_")).length;
  const addButton = () => {
    if (customCount >= 20) return;
    onChange([{ id: `custom_${crypto.randomUUID()}`, label: "Новая кнопка", url: "", visible: true, order: Math.min(0, ...buttons.map((button) => button.order)) - 1, style: "", onePerRow: true }, ...buttons]);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={addButton} disabled={customCount >= 20}>
          <Plus className="mr-2 h-4 w-4" />Добавить кнопку-ссылку
        </Button>
        <Button type="button" onClick={onSave} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить меню"}</Button>
        <span className="text-xs text-muted-foreground">{customCount} из 20 своих кнопок</span>
      </div>
      <p className="text-xs text-muted-foreground">Перетащите строку за ⋮⋮ или выберите её номер. Нажмите на название, чтобы раскрыть настройки. Скрытые кнопки занимают место в списке, но не появляются в боте.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={buttons.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {buttons.map((btn, idx) => (
              <SortableBotButtonCard
                key={btn.id}
                btn={btn}
                idx={idx}
                total={buttons.length}
                onMove={(position) => moveButton(btn.id, position)}
                onUpdate={(patch) => updateButton(btn.id, patch)}
                onRemove={btn.id.startsWith("custom_") ? () => onChange(buttons.filter((button) => button.id !== btn.id)) : undefined}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableBotButtonCard({
  btn,
  idx,
  total,
  onMove,
  onUpdate,
  onRemove,
}: {
  btn: BotButtonItem;
  idx: number;
  total: number;
  onMove: (position: number) => void;
  onUpdate: (patch: Partial<BotButtonItem>) => void;
  onRemove?: () => void;
}) {
  const [expanded, setExpanded] = useState(btn.id.startsWith("custom_") && !btn.url);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: btn.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const swatch = BOT_STYLE_OPTIONS.find((o) => o.value === (btn.style ?? ""))?.swatch ?? "bg-slate-400";
  const styleLabel = BOT_STYLE_OPTIONS.find((o) => o.value === (btn.style ?? ""))?.label ?? "По умолчанию";

  return (
    <details
      ref={setNodeRef}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      style={style}
      className={`relative group rounded-xl border bg-muted ${btn.visible ? "border-border" : "border-dashed border-border"} ${isDragging ? "shadow-2xl ring-2 ring-sky-500/40 z-10" : ""}`}
    >
      <summary className="flex list-none cursor-pointer items-center gap-2 p-2.5 [&::-webkit-details-marker]:hidden">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing touch-none p-1 rounded-md hover:bg-card shrink-0"
          {...attributes}
          {...listeners}
          aria-label={`Переместить: ${btn.label}`}
          title="Перетащите чтобы изменить порядок"
          onClick={(event) => event.preventDefault()}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <select
          aria-label={`Позиция: ${btn.label}`}
          className="h-8 w-14 shrink-0 rounded-md border border-input bg-background px-1 text-sm"
          value={idx}
          onChange={(event) => onMove(Number(event.target.value))}
          onClick={(event) => event.stopPropagation()}
        >
          {Array.from({ length: total }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}
        </select>
        <span className={`h-2.5 w-2.5 rounded-full ${swatch} shrink-0`} title={styleLabel} />
        <span className={`flex-1 min-w-0 truncate text-sm font-medium ${btn.visible ? "" : "text-muted-foreground"}`} title={btn.label}>
          {btn.label || "Без названия"}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">{btn.visible ? "" : "Скрыта"}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 ${expanded ? "rotate-180" : ""}`} />
      </summary>
      <div className="border-t border-border p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex-1 text-xs text-muted-foreground">{btn.id.startsWith("custom_") ? "Своя кнопка-ссылка" : BOT_BUTTON_HUMAN_NAMES[btn.id] ?? btn.id}</span>
          <Switch aria-label={`Видимость: ${btn.label}`} checked={btn.visible} onCheckedChange={(checked: boolean) => onUpdate({ visible: checked === true })} />
          <span className="text-xs text-muted-foreground">{btn.visible ? "Видна" : "Скрыта"}</span>
          {onRemove && <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Удалить кнопку: ${btn.label}`}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      <div className="mb-2.5 p-2 rounded-lg bg-card border border-border">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          <Eye className="h-3 w-3" />
          Предпросмотр
        </div>
        <div className={`inline-block px-3 py-1.5 rounded-lg text-sm font-medium ${
          btn.style === "success" ? "bg-emerald-500/30 text-emerald-100 border border-emerald-500/40"
          : btn.style === "danger" ? "bg-rose-500/30 text-rose-100 border border-rose-500/40"
          : btn.style === "primary" ? "bg-sky-500/30 text-sky-100 border border-sky-500/40"
          : "bg-card text-foreground border border-border"
        }`}>
          {btn.label || "(пустое название)"}
        </div>
      </div>

      {onRemove && <div className="space-y-1 mb-3">
        <Label htmlFor={`bot-button-url-${btn.id}`}>Ссылка</Label>
        <Input id={`bot-button-url-${btn.id}`} type="url" maxLength={1000} value={btn.url ?? ""} onChange={(event) => onUpdate({ url: event.target.value })} placeholder="https://t.me/your_channel" required aria-invalid={!!btn.url && !isBotButtonUrl(btn.url.trim())} />
        <p className="text-xs text-muted-foreground">Адрес сайта или Telegram: https://, http:// или tg://. Изменения появятся при следующем открытии меню, в течение минуты после сохранения.</p>
      </div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_140px_140px_auto]">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Текст кнопки</Label>
          <Input aria-label={`Название кнопки ${idx + 1}`} maxLength={onRemove ? 64 : undefined} className="h-9" value={btn.label} onChange={(e) => onUpdate({ label: e.target.value })} placeholder=" Подключиться" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Иконка (premium)</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={btn.emojiKey ?? ""}
            onChange={(e) => onUpdate({ emojiKey: e.target.value })}
          >
            <option value="">— нет —</option>
            {BOT_EMOJI_KEYS.map((k) => (
              <option key={k} value={k}>{BOT_EMOJI_LABELS[k] ?? k}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Цвет</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={btn.style ?? ""}
            onChange={(e) => onUpdate({ style: e.target.value })}
          >
            {BOT_STYLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-1.5 pb-1">
          <Switch
            id={`onePerRow-${btn.id}`}
            checked={btn.onePerRow === true}
            onCheckedChange={(checked: boolean) => onUpdate({ onePerRow: checked === true })}
          />
          <Label htmlFor={`onePerRow-${btn.id}`} className="text-xs cursor-pointer whitespace-nowrap">Во всю ширину</Label>
        </div>
      </div>
      </div>
    </details>
  );
}
