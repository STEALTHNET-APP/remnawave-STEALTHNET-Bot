/**
 * админ-страница «Автосписание».
 *
 * Две секции:
 *   1.  Настройки списания (расписание + ЮKassa-recurring) — про деньги, не про текст.
 *   2.  Конструктор уведомлений — список карточек шаблонов с типами событий и переменными.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type { AutoRenewNotificationRecord, AutoRenewTriggerType, AdminSettings } from "@/lib/api";
import { CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, Plus, Pencil, Trash2, Save, X, Sparkles,
  Clock, CheckCircle2, XCircle, RotateCw, Ban, Layers, Wand2, ArrowRight,
  CreditCard, Wallet, Info, Eye,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const TRIGGER_INFO: Record<AutoRenewTriggerType, {
  label: string;
  Icon: typeof Clock;
  iconColor: string;
  tabGradient: string;
  cardGradient: string;
  description: string;
}> = {
  UPCOMING: {
    label: "До списания",
    Icon: Clock,
    iconColor: "text-amber-300",
    tabGradient: "bg-muted",
    cardGradient: "bg-muted border-amber-500/30",
    description: "Напоминание ДО автосписания. Можно создать несколько (за 3 дня, за 1 день, за 15 минут).",
  },
  SUCCESS: {
    label: "Успешно",
    Icon: CheckCircle2,
    iconColor: "text-emerald-300",
    tabGradient: "bg-muted",
    cardGradient: "bg-muted border-emerald-500/30",
    description: "Подтверждение после успешного списания.",
  },
  FAILED: {
    label: "Ошибка",
    Icon: XCircle,
    iconColor: "text-rose-300",
    tabGradient: "bg-muted",
    cardGradient: "bg-muted border-rose-500/30",
    description: "Если автосписание не удалось (нет баланса, ошибка ЮKassa).",
  },
  RETRY: {
    label: "Повтор",
    Icon: RotateCw,
    iconColor: "text-violet-300",
    tabGradient: "bg-muted",
    cardGradient: "bg-muted border-violet-500/30",
    description: "Между попытками в грейс-периоде.",
  },
  EXPIRED: {
    label: "Истёк грейс",
    Icon: Ban,
    iconColor: "text-slate-300",
    tabGradient: "bg-muted",
    cardGradient: "bg-muted border-slate-500/30",
    description: "После всех неудач — автосписание выключается.",
  },
};

const VARIABLES_INFO = [
  { key: "{tariff_name}", desc: "Имя тарифа", example: " Стандартная" },
  { key: "{amount}", desc: "Сумма списания", example: "249" },
  { key: "{currency}", desc: "Валюта", example: "₽" },
  { key: "{days_left}", desc: "Дней до истечения", example: "3" },
  { key: "{hours_left}", desc: "Часов до истечения", example: "72" },
  { key: "{minutes_left}", desc: "Минут до истечения", example: "4320" },
  { key: "{days_unit}", desc: "«день/дня/дней» (склонение)", example: "дня" },
  { key: "{expire_date}", desc: "Дата истечения", example: "14.05.2026" },
  { key: "{sub_index}", desc: "Номер подписки", example: "2" },
  { key: "{balance}", desc: "Баланс клиента", example: "150" },
];

const SAMPLE_CONTEXT = {
  tariff_name: " Стандартная",
  amount: "249",
  currency: "₽",
  days_left: "3",
  hours_left: "72",
  minutes_left: "4320",
  days_unit: "дня",
  expire_date: "14.05.2026",
  sub_index: "2",
  balance: "150",
};

function renderSample(text: string): string {
  return Object.entries(SAMPLE_CONTEXT).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), v),
    text,
  );
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return "Сразу";
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} ч`;
  const days = Math.round(minutes / (60 * 24));
  return `${days} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"}`;
}

type EditState = "create" | { edit: AutoRenewNotificationRecord } | null;
type TabFilter = AutoRenewTriggerType | "ALL";

export function AutoRenewPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? null;

  const [notifs, setNotifs] = useState<AutoRenewNotificationRecord[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditState>(null);
  const [tab, setTab] = useState<TabFilter>("ALL");

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [notifRes, settingsRes] = await Promise.all([
        api.getAutoRenewNotifications(token),
        api.getSettings(token),
      ]);
      setNotifs(notifRes.items);
      setSettings(settingsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleSaveSettings = async () => {
    if (!token || !settings) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      await api.updateSettings(token, {
        defaultAutoRenewEnabled: settings.defaultAutoRenewEnabled,
        yookassaRecurringEnabled: settings.yookassaRecurringEnabled,
        autoRenewDaysBeforeExpiry: settings.autoRenewDaysBeforeExpiry,
        autoRenewGracePeriodDays: settings.autoRenewGracePeriodDays,
        autoRenewMaxRetries: settings.autoRenewMaxRetries,
      });
      setSavedMsg("Сохранено");
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (n: AutoRenewNotificationRecord) => {
    if (!token) return;
    try {
      await api.updateAutoRenewNotification(token, n.id, { enabled: !n.enabled });
      setNotifs((arr) => arr.map((it) => (it.id === n.id ? { ...it, enabled: !it.enabled } : it)));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const handleDelete = async (n: AutoRenewNotificationRecord) => {
    if (!token) return;
    if (!confirm(`Удалить шаблон «${n.name}»?`)) return;
    try {
      await api.deleteAutoRenewNotification(token, n.id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const grouped = useMemo(() => {
    const g: Record<AutoRenewTriggerType, AutoRenewNotificationRecord[]> = {
      UPCOMING: [], SUCCESS: [], FAILED: [], RETRY: [], EXPIRED: [],
    };
    notifs.forEach((n) => g[n.triggerType].push(n));
    return g;
  }, [notifs]);

  const filteredNotifs = tab === "ALL" ? notifs : grouped[tab];
  const counts = useMemo(() => {
    const c: Partial<Record<TabFilter, number>> = { ALL: notifs.length };
    (Object.keys(grouped) as AutoRenewTriggerType[]).forEach((k) => (c[k] = grouped[k].length));
    return c;
  }, [grouped, notifs.length]);

  return (
    <div className="flex flex-col gap-3.5 relative">

      {/*  HERO  */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-4 bg-card border border-border p-4 rounded-2xl"
      >
        <div className="flex-1 min-w-0">
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
              Автосписание
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">
              Поведение автопродления подписок и конструктор уведомлений клиентам — по событиям, с подстановкой переменных.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge label={`${notifs.length} шаблон${notifs.length === 1 ? "" : notifs.length < 5 ? "а" : "ов"}`} icon={Wand2} />
              <Badge label={settings?.yookassaRecurringEnabled ? "ЮKassa-recurring вкл." : "ЮKassa-recurring выкл."} icon={CreditCard} variant={settings?.yookassaRecurringEnabled ? "ok" : "muted"} />
              <Badge label={settings?.defaultAutoRenewEnabled ? "Default ON" : "Default OFF"} icon={Wallet} variant={settings?.defaultAutoRenewEnabled ? "ok" : "muted"} />
            </div>
        </div>
      </motion.div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400">{error}</div>
      )}

      {loading || !settings ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/*  TIMELINE визуализация  */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl border border-border bg-card p-4 sm:p-4"
          >
            <div className="flex items-center gap-2 mb-4">
              <Layers className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">Как работает автосписание</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <TimelineStep
                icon={Clock} title="UPCOMING"
                desc="Напоминания клиенту перед списанием"
                count={grouped.UPCOMING.length}
                color="bg-muted border-amber-500/30"
              />
              <TimelineArrow />
              <TimelineStep
                icon={CreditCard} title="Списание"
                desc={`За ${settings.autoRenewDaysBeforeExpiry ?? 1} дн до истечения`}
                badge="cron"
                color="bg-muted border-border"
              />
              <TimelineArrow />
              <TimelineStep
                icon={CheckCircle2} title="SUCCESS / FAILED"
                desc="Уведомление о результате"
                count={grouped.SUCCESS.length + grouped.FAILED.length}
                color="bg-muted border-emerald-500/30"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <TimelineStep
                icon={RotateCw} title="RETRY (в грейсе)"
                desc={`Грейс ${settings.autoRenewGracePeriodDays ?? 2} дн · до ${settings.autoRenewMaxRetries ?? 3} попыток`}
                count={grouped.RETRY.length}
                color="bg-muted border-violet-500/30"
              />
              <TimelineStep
                icon={Ban} title="EXPIRED"
                desc="Все попытки исчерпаны  автосписание выкл."
                count={grouped.EXPIRED.length}
                color="bg-muted border-slate-500/30"
              />
              <div className="rounded-xl border border-border bg-white/[0.03] p-3 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-sm">
                  <Info className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-muted-foreground">
                    Каждое событие триггерит <span className="text-foreground font-semibold">все активные шаблоны</span> своего типа.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/*  Секция: Поведение списания  */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-2xl border border-border bg-card overflow-hidden"
          >
            <div className="bg-transparent p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div>
                  <h2 className="text-[13.5px] font-bold">Поведение списания</h2>
                  <p className="text-xs text-muted-foreground">Когда и сколько раз cron пытается списать. <span className="text-primary">Текстовые уведомления — в конструкторе ниже.</span></p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-3 p-4">
              {/* Toggles */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ToggleRow
                  title="Автопродление подписки"
                  desc="Включать автопродление (списание с баланса) для новых клиентов по умолчанию."
                  checked={settings.defaultAutoRenewEnabled ?? false}
                  onChange={(v) => setSettings((s) => (s ? { ...s, defaultAutoRenewEnabled: v } : s))}
                />
                <ToggleRow
                  title="Рекуррентные платежи ЮKassa"
                  desc={!settings.yookassaShopId || !settings.yookassaSecretKey
                    ? "Сначала настройте ЮKassa во вкладке «Платежи»."
                    : "Если баланса не хватает — спишем с сохранённой карты клиента."}
                  checked={settings.yookassaRecurringEnabled ?? false}
                  onChange={(v) => setSettings((s) => (s ? { ...s, yookassaRecurringEnabled: v } : s))}
                  disabled={!settings.yookassaShopId || !settings.yookassaSecretKey}
                />
              </div>

              {/* Numeric settings */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <NumberCard
                  label="Списать за N дней до"
                  value={settings.autoRenewDaysBeforeExpiry ?? 1}
                  min={1} max={30}
                  hint="Когда cron начинает попытки списать с баланса/карты"
                  icon={Clock}
                  onChange={(v) => setSettings((s) => (s ? { ...s, autoRenewDaysBeforeExpiry: v } : s))}
                />
                <NumberCard
                  label="Грейс-период (дн.)"
                  value={settings.autoRenewGracePeriodDays ?? 2}
                  min={0} max={14}
                  hint="Сколько дней после истечения продолжать попытки"
                  icon={RotateCw}
                  onChange={(v) => setSettings((s) => (s ? { ...s, autoRenewGracePeriodDays: v } : s))}
                />
                <NumberCard
                  label="Макс. попыток списания"
                  value={settings.autoRenewMaxRetries ?? 3}
                  min={1} max={10}
                  hint="После N фейлов автосписание выключится автоматически"
                  icon={Ban}
                  onChange={(v) => setSettings((s) => (s ? { ...s, autoRenewMaxRetries: v } : s))}
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleSaveSettings}
                  disabled={saving}
                  className="gap-2 rounded-xl"
                >
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Сохранить настройки
                </Button>
                {savedMsg && <span className="inline-flex items-center gap-1.5 text-sm text-emerald-500 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />{savedMsg}</span>}
              </div>
            </CardContent>
          </motion.section>

          {/*  Секция: Конструктор уведомлений  */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-2xl border border-border bg-card overflow-hidden"
          >
            <div className="relative bg-transparent p-4 border-b border-border">
              <div className="relative flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="text-[13.5px] font-bold flex items-center gap-2">
                      Конструктор уведомлений
                      <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                    </h2>
                    <p className="text-xs text-muted-foreground">Все сообщения клиенту — настраиваемые шаблоны с переменными</p>
                  </div>
                </div>
                <Button onClick={() => setEditor("create")} className="gap-1.5 rounded-xl">
                  <Plus className="h-4 w-4" />
                  Создать шаблон
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <div className="px-5 pt-4 pb-2 border-b border-border flex flex-wrap gap-2">
              <TabButton active={tab === "ALL"} count={counts.ALL ?? 0} onClick={() => setTab("ALL")}>
                <Layers className="h-3.5 w-3.5 mr-1.5" />
                Все
              </TabButton>
              {(Object.keys(TRIGGER_INFO) as AutoRenewTriggerType[]).map((t) => {
                const info = TRIGGER_INFO[t];
                const Icon = info.Icon;
                return (
                  <TabButton key={t} active={tab === t} count={counts[t] ?? 0} onClick={() => setTab(t)}>
                    <Icon className={`h-3.5 w-3.5 mr-1.5 ${info.iconColor}`} />
                    {info.label}
                  </TabButton>
                );
              })}
            </div>

            <CardContent className="p-4">
              {filteredNotifs.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-12">
                  <h3 className="text-[13.5px] font-bold tracking-tight">Шаблонов нет</h3>
                  <p className="text-[12.5px] text-muted-foreground mt-[3px]">В этой категории пока пусто.</p>
                  <Button variant="outline" className="mt-4 gap-1.5 rounded-xl" onClick={() => setEditor("create")}>
                    <Plus className="h-4 w-4" /> Создать первый
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {filteredNotifs.map((n) => {
                    const info = TRIGGER_INFO[n.triggerType];
                    const Icon = info.Icon;
                    return (
                      <motion.div
                        key={n.id}
                        layout
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        whileHover={{ y: -2 }}
                        transition={{ type: "spring", damping: 20 }}
                        className={`relative overflow-hidden rounded-xl border  ${info.cardGradient} p-4 ${!n.enabled ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-3 flex-wrap min-w-0">
                            <div className={`h-9 w-9 rounded-xl bg-card flex items-center justify-center shrink-0`}>
                              <Icon className={`h-4 w-4 ${info.iconColor}`} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold leading-tight truncate">{n.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {info.label}{n.triggerType === "UPCOMING" ? ` · за ${formatOffset(n.offsetMinutes)}` : ""}
                              </p>
                            </div>
                          </div>
                          <Switch checked={n.enabled} onCheckedChange={() => handleToggle(n)} />
                        </div>
                        <div className="text-xs whitespace-pre-wrap line-clamp-5 text-foreground/80 bg-card rounded-lg p-3 mt-2 border border-border font-mono">
                          {n.messageText}
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" variant="outline" className="bg-card" onClick={() => setEditor({ edit: n })}>
                            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Изменить
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300" onClick={() => handleDelete(n)}>
                            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Удалить
                          </Button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Подсказка про переменные */}
              <details className="mt-5 group">
                <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2 p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.06] transition-colors list-none">
                  <Info className="h-4 w-4 text-primary" />
                  Переменные в тексте сообщения <span className="text-xs text-muted-foreground font-normal">(нажмите чтобы развернуть)</span>
                  <ArrowRight className="h-3.5 w-3.5 ml-auto transition-transform group-open:rotate-90" />
                </summary>
                <div className="mt-3 p-4 rounded-xl border border-border bg-primary/5 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {VARIABLES_INFO.map((v) => (
                      <div key={v.key} className="flex items-start gap-2 p-2 rounded bg-card">
                        <code className="text-primary bg-primary/10 rounded px-1.5 py-0.5 font-mono shrink-0">{v.key}</code>
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground">{v.desc}</p>
                          <p className="text-muted-foreground text-[10px]">пример: <span className="text-foreground/80">{v.example}</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Поддерживается HTML Telegram: <code className="text-amber-300 bg-amber-500/10 rounded px-1">&lt;b&gt;жирный&lt;/b&gt;</code>, <code className="text-amber-300 bg-amber-500/10 rounded px-1">&lt;i&gt;курсив&lt;/i&gt;</code>, <code className="text-amber-300 bg-amber-500/10 rounded px-1">&lt;code&gt;моноширинный&lt;/code&gt;</code>.
                  </p>
                </div>
              </details>
            </CardContent>
          </motion.section>
        </>
      )}

      <AnimatePresence>
        {editor && (
          <NotifEditor
            initial={editor === "create" ? null : editor.edit}
            onClose={() => setEditor(null)}
            onSaved={async () => {
              setEditor(null);
              await load();
            }}
            token={token}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

//  Sub-components 

function Badge({ label, icon: Icon, variant = "neutral" }: { label: string; icon: typeof Clock; variant?: "neutral" | "ok" | "muted" }) {
  const c = variant === "ok" ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/30"
    : variant === "muted" ? "bg-white/[0.06] text-muted-foreground border-border"
    : "bg-primary/15 text-primary border-border";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${c}`}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

function TimelineStep({ icon: Icon, title, desc, count, badge, color }: {
  icon: typeof Clock; title: string; desc: string; count?: number; badge?: string; color: string;
}) {
  return (
    <div className={`rounded-xl border  ${color} p-3 relative overflow-hidden`}>
      <div className="flex items-center gap-2">
        <span className="h-8 w-8 rounded-xl bg-card border border-border flex items-center justify-center shrink-0"><Icon className="h-4 w-4 text-foreground/80" /></span>
        <p className="font-semibold text-sm">{title}</p>
        {count != null && (
          <span className="ml-auto text-[10px] bg-card rounded-full px-2 py-0.5 border border-border">
            {count}
          </span>
        )}
        {badge && (
          <span className="ml-auto text-[10px] bg-primary/20 text-primary rounded-full px-2 py-0.5 border border-border">
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}

function TimelineArrow() {
  return (
    <div className="hidden md:flex items-center justify-center">
      <ArrowRight className="h-5 w-5 text-muted-foreground/40" />
    </div>
  );
}

function ToggleRow({ title, desc, checked, onChange, disabled }: {
  title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 p-4 rounded-xl border bg-white/[0.03] ${disabled ? "opacity-50" : "hover:bg-white/[0.05]"} transition-colors`}>
      <div className="space-y-0.5 flex-1 min-w-0">
        <Label className="font-semibold">{title}</Label>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function NumberCard({ label, value, min, max, hint, icon: Icon, onChange }: {
  label: string; value: number; min: number; max: number; hint: string; icon: typeof Clock; onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-foreground/[0.02] p-4 space-y-1.5 hover:bg-foreground/[0.04] transition-colors">
      <div className="flex items-center gap-2">
        <span className="h-7 w-7 rounded-lg bg-primary/10 border border-border flex items-center justify-center shrink-0"><Icon className="h-3.5 w-3.5 text-primary" /></span>
        <Label className="font-medium">{label}</Label>
      </div>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || min)}
        className="text-base font-semibold"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function TabButton({ active, count, children, onClick }: { active: boolean; count: number; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center text-xs sm:text-sm px-3 py-1.5 rounded-full border transition-all ${
        active
          ? "bg-primary/20 border-border text-foreground"
          : "bg-white/[0.03] border-border text-muted-foreground hover:bg-white/[0.06]"
      }`}
    >
      {children}
      <span className="ml-1.5 bg-card rounded-full px-1.5 text-[10px] border border-border">{count}</span>
    </button>
  );
}

//  Editor Modal 

function NotifEditor({
  initial, onClose, onSaved, token,
}: {
  initial: AutoRenewNotificationRecord | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  token: string | null;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [triggerType, setTriggerType] = useState<AutoRenewTriggerType>(initial?.triggerType ?? "UPCOMING");
  const [offsetValue, setOffsetValue] = useState(initial?.offsetMinutes ?? 15);
  const [offsetUnit, setOffsetUnit] = useState<"minutes" | "hours" | "days">(
    initial && initial.offsetMinutes % (60 * 24) === 0 && initial.offsetMinutes > 0
      ? "days"
      : initial && initial.offsetMinutes % 60 === 0 && initial.offsetMinutes > 0
        ? "hours"
        : "minutes",
  );
  const [messageText, setMessageText] = useState(initial?.messageText ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      if (initial.offsetMinutes % (60 * 24) === 0 && initial.offsetMinutes > 0) setOffsetValue(initial.offsetMinutes / (60 * 24));
      else if (initial.offsetMinutes % 60 === 0 && initial.offsetMinutes > 0) setOffsetValue(initial.offsetMinutes / 60);
      else setOffsetValue(initial.offsetMinutes);
    }
  }, [initial]);

  const toMinutes = () => {
    const v = Math.max(0, offsetValue);
    if (offsetUnit === "days") return v * 60 * 24;
    if (offsetUnit === "hours") return v * 60;
    return v;
  };

  const handleSave = async () => {
    if (!token) return;
    setErr(null);
    if (!name.trim()) return setErr("Укажите название");
    if (!messageText.trim()) return setErr("Укажите текст сообщения");
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        triggerType,
        offsetMinutes: triggerType === "UPCOMING" ? toMinutes() : 0,
        messageText: messageText.trim(),
        enabled,
      };
      if (initial) await api.updateAutoRenewNotification(token, initial.id, payload);
      else await api.createAutoRenewNotification(token, payload);
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const previewText = renderSample(messageText || "");

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 24 }}
        className="bg-card border border-border rounded-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-transparent px-3 py-2 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              {initial ? "Изменить шаблон" : "Новый шаблон уведомления"}
            </h3>
            <Button size="icon" variant="ghost" onClick={onClose}><X className="h-5 w-5" /></Button>
          </div>
        </div>
        <div className="p-4 space-y-5 grid grid-cols-1 lg:grid-cols-2 lg:gap-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Название (для админки)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Уведомление за 1 день" />
            </div>

            <div className="space-y-1.5">
              <Label>Тип события</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TRIGGER_INFO) as AutoRenewTriggerType[]).map((t) => {
                  const info = TRIGGER_INFO[t];
                  const Icon = info.Icon;
                  const active = triggerType === t;
                  return (
                    <button
                      key={t} type="button"
                      onClick={() => setTriggerType(t)}
                      className={`text-left p-3 rounded-xl border transition-all ${active ? `${info.tabGradient} ring-2 ring-primary/40` : "bg-white/[0.03] hover:bg-white/[0.06]"}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${info.iconColor}`} />
                        <p className="font-semibold text-sm">{info.label}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{info.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {triggerType === "UPCOMING" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                className="space-y-1.5 p-3 rounded-xl border bg-amber-500/10 border-amber-500/20"
              >
                <Label className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-300" /> За сколько ДО списания
                </Label>
                <div className="flex gap-2">
                  <Input type="number" min={1} value={offsetValue} onChange={(e) => setOffsetValue(parseInt(e.target.value) || 1)} className="flex-1" />
                  <select
                    value={offsetUnit}
                    onChange={(e) => setOffsetUnit(e.target.value as "minutes" | "hours" | "days")}
                    className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="minutes">минут</option>
                    <option value="hours">часов</option>
                    <option value="days">дней</option>
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">Cron запускается каждый час · допуск ±30 мин</p>
              </motion.div>
            )}

            <div className="space-y-1.5">
              <Label>Текст сообщения (HTML)</Label>
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={9}
                className="w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder={` <b>Скоро автосписание</b>\n\nЧерез {days_left} {days_unit} с подписки «{tariff_name}» спишется {amount} {currency}.`}
              />
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl border bg-white/[0.03]">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <Label>Шаблон включён</Label>
            </div>
          </div>

          {/* Preview column */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-sm">
              <Eye className="h-4 w-4 text-primary" /> Live preview (с подстановкой)
            </Label>
            <div className="rounded-xl border border-border bg-muted p-4 min-h-[200px]">
              <div className="text-xs text-primary mb-2 font-mono">Telegram</div>
              <div className="bg-card rounded-xl p-4 border border-border text-sm whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: previewText || "<span class='text-muted-foreground italic'>Введите текст сообщения слева — здесь будет preview...</span>" }} />
            </div>

            <details className="group">
              <summary className="cursor-pointer text-xs font-semibold flex items-center gap-2 p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.06] transition-colors list-none">
                <Info className="h-3.5 w-3.5 text-primary" />
                Подставить переменную в текст
              </summary>
              <div className="mt-2 grid grid-cols-1 gap-1">
                {VARIABLES_INFO.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setMessageText((t) => t + v.key)}
                    className="text-left text-xs p-2 rounded bg-white/[0.03] hover:bg-white/[0.06] flex items-center gap-2 transition-colors"
                  >
                    <code className="text-primary bg-primary/10 rounded px-1.5 py-0.5 font-mono shrink-0">{v.key}</code>
                    <span className="text-muted-foreground truncate">{v.desc}</span>
                  </button>
                ))}
              </div>
            </details>
          </div>

          {err && <p className="text-red-500 dark:text-red-400 text-sm lg:col-span-2">{err}</p>}

          <div className="flex gap-2 pt-2 lg:col-span-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1 gap-2 rounded-xl">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {initial ? "Сохранить изменения" : "Создать шаблон"}
            </Button>
            <Button variant="outline" onClick={onClose} className="rounded-xl">Отмена</Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default AutoRenewPage;
