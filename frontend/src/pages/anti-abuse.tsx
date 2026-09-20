import { useCallback, useEffect, useState } from "react";
import {
  ShieldBan, Loader2, RefreshCw, AlertTriangle, Plus, Trash2, Pencil, PlayCircle,
  Ban, AlertCircle, X, Settings2, ScrollText, ListChecks, ShieldX, Save,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import {
  api,
  type AntiAbuseRule,
  type AntiAbuseRuleInput,
  type AntiAbuseChannels,
  type AntiAbuseBannedItem,
  type AntiAbuseWarnedItem,
  type AntiAbuseEvent,
} from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { GlassSelect } from "@/components/ui/glass-select";
import { toast } from "@/components/ui/toast";
import { fmtMsk } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const GIB = 1024 ** 3;

// ── helpers ─────────────────────────────────────────────────────────────────

/** Байты (строкой/числом) → "X.XX ГБ". */
function formatBytes(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const bytes = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 ГБ";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i <= 1 ? 0 : 2)} ${units[i]}`;
}

/** ISO → "14.06.2026, 18:30:42" (МСК). */
function formatDateRu(iso: string | null | undefined): string {
  return fmtMsk(iso);
}

/** Владелец подписки → читабельная строка. */
function ownerLabel(owner: { telegramId: string | null; telegramUsername?: string | null; email: string | null } | null | undefined): string {
  if (!owner) return "—";
  // @username + ID если оба есть; иначе что есть.
  if (owner.telegramUsername) return owner.telegramId ? `@${owner.telegramUsername} (${owner.telegramId})` : `@${owner.telegramUsername}`;
  if (owner.telegramId) return `TG ${owner.telegramId}`;
  if (owner.email) return owner.email;
  return "—";
}

// ── общий контейнер пустого состояния ─────────────────────────────────────────
function EmptyState({ icon: Icon, text }: { icon: typeof ShieldBan; text: string }) {
  return (
    <div className="py-10 flex flex-col items-center text-center gap-2 text-muted-foreground">
      <div className="h-12 w-12 rounded-full bg-foreground/[0.04] border border-white/10 flex items-center justify-center">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ── бейджи ────────────────────────────────────────────────────────────────────
function ActionBadge({ action }: { action: string }) {
  const isBan = action === "BAN";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
      isBan
        ? "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20"
        : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
    )}>
      {isBan ? <Ban className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {isBan ? "Блокировка" : "Предупреждение"}
    </span>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    WARN: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
    BAN: "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20",
    UNBAN: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
    ERROR: "bg-orange-500/10 text-orange-500 dark:text-orange-400 border-orange-500/20",
  };
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
      map[type] ?? "bg-foreground/[0.05] text-muted-foreground border-white/10",
    )}>
      {type}
    </span>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
      enabled
        ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
        : "bg-foreground/[0.05] text-muted-foreground border-white/10",
    )}>
      {enabled ? "Включено" : "Выключено"}
    </span>
  );
}

// ── описание окна ───────────────────────────────────────────────────────────
function windowLabel(rule: Pick<AntiAbuseRule, "windowKind" | "windowValueHours">): string {
  switch (rule.windowKind) {
    case "hour": return "Час";
    case "day": return "Сутки";
    case "week": return "Неделя";
    case "custom": return `${rule.windowValueHours ?? "?"} ч`;
    case "rolling": return "между проверками";
    default: return rule.windowKind;
  }
}

// ── пресеты расписаний ─────────────────────────────────────────────────────────
const SCHEDULE_PRESETS: { label: string; cron: string }[] = [
  { label: "Каждый час", cron: "0 * * * *" },
  { label: "Каждые 6 ч", cron: "0 */6 * * *" },
  { label: "Каждые 12 ч", cron: "0 */12 * * *" },
  { label: "Ежедневно 09:00", cron: "0 9 * * *" },
];

// ── форма правила (черновик в локальном стейте) ─────────────────────────────────
interface RuleDraft {
  name: string;
  enabled: boolean;
  schedules: string[];
  windowKind: AntiAbuseRule["windowKind"];
  windowValueHours: string;
  limitGb: string;
  action: AntiAbuseRule["action"];
  banDurationKind: NonNullable<AntiAbuseRule["banDurationKind"]>;
  banDurationHours: string;
  channelTelegram: boolean;
  channelEmail: boolean;
  messageText: string;
  emailSubject: string;
  scopeKind: AntiAbuseRule["scopeKind"];
  scopeValues: string;
  priority: string;
  resendAfterHours: string;
}

function emptyDraft(): RuleDraft {
  return {
    name: "",
    enabled: true,
    schedules: ["0 * * * *"],
    windowKind: "day",
    windowValueHours: "24",
    limitGb: "100",
    action: "WARN",
    banDurationKind: "until_window_end",
    banDurationHours: "24",
    channelTelegram: true,
    channelEmail: false,
    messageText: "",
    emailSubject: "",
    scopeKind: "all",
    scopeValues: "",
    priority: "0",
    resendAfterHours: "",
  };
}

function draftFromRule(rule: AntiAbuseRule): RuleDraft {
  return {
    name: rule.name,
    enabled: rule.enabled,
    schedules: [...rule.schedules],
    windowKind: rule.windowKind,
    windowValueHours: rule.windowValueHours != null ? String(rule.windowValueHours) : "24",
    limitGb: String(Number(rule.limitBytes) / GIB),
    action: rule.action,
    banDurationKind: rule.banDurationKind ?? "until_window_end",
    banDurationHours: rule.banDurationHours != null ? String(rule.banDurationHours) : "24",
    channelTelegram: !!rule.channels.telegram,
    channelEmail: !!rule.channels.email,
    messageText: rule.messageText,
    emailSubject: rule.emailSubject ?? "",
    scopeKind: rule.scopeKind,
    scopeValues: (rule.scopeValues ?? []).join(", "),
    priority: String(rule.priority),
    resendAfterHours: rule.resendAfterHours != null ? String(rule.resendAfterHours) : "",
  };
}

function draftToInput(draft: RuleDraft): AntiAbuseRuleInput {
  const channels: AntiAbuseChannels = { telegram: draft.channelTelegram, email: draft.channelEmail };
  const gb = Number(draft.limitGb);
  const input: AntiAbuseRuleInput = {
    name: draft.name.trim(),
    enabled: draft.enabled,
    schedules: draft.schedules,
    windowKind: draft.windowKind,
    windowValueHours: draft.windowKind === "custom" || draft.windowKind === "rolling" ? Number(draft.windowValueHours) || null : null,
    limitBytes: String(Math.round((Number.isFinite(gb) ? gb : 0) * GIB)),
    action: draft.action,
    banDurationKind: draft.action === "BAN" ? draft.banDurationKind : null,
    banDurationHours:
      draft.action === "BAN" && draft.banDurationKind === "fixed"
        ? Number(draft.banDurationHours) || null
        : null,
    channels,
    messageText: draft.messageText,
    emailSubject: draft.channelEmail ? draft.emailSubject.trim() || null : null,
    scopeKind: draft.scopeKind,
    scopeValues:
      draft.scopeKind === "all"
        ? null
        : draft.scopeValues.split(",").map((s) => s.trim()).filter(Boolean),
    priority: Number(draft.priority) || 0,
    resendAfterHours: draft.resendAfterHours.trim() ? Number(draft.resendAfterHours) || null : null,
  };
  return input;
}

// ── модалка правила ─────────────────────────────────────────────────────────────
function RuleDialog({
  open,
  onOpenChange,
  editing,
  token,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: AntiAbuseRule | null;
  token: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<RuleDraft>(emptyDraft);
  const [cronInput, setCronInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [tariffOptions, setTariffOptions] = useState<{ id: string; name: string }[]>([]);
  const [squadOptions, setSquadOptions] = useState<{ uuid: string; name: string }[]>([]);

  // Сброс черновика при открытии / смене редактируемого правила.
  useEffect(() => {
    if (!open) return;
    setDraft(editing ? draftFromRule(editing) : emptyDraft());
    setCronInput("");
  }, [open, editing]);

  // Списки тарифов и сквадов для выбора области применения (вместо ручного ввода id).
  useEffect(() => {
    if (!open) return;
    api.getTariffs(token)
      .then((r) => setTariffOptions(r.items.map((t) => ({ id: t.id, name: t.name || t.id }))))
      .catch(() => setTariffOptions([]));
    api.getRemnaSquadsInternal(token)
      .then((raw) => {
        const res = raw as { response?: { internalSquads?: { uuid?: string; name?: string }[] } };
        const list = res?.response?.internalSquads ?? [];
        setSquadOptions(list.filter((s) => s.uuid).map((s) => ({ uuid: s.uuid as string, name: s.name || (s.uuid as string) })));
      })
      .catch(() => setSquadOptions([]));
  }, [open, token]);

  const patch = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const addSchedule = (cron: string) => {
    const trimmed = cron.trim();
    if (!trimmed) return;
    setDraft((d) => (d.schedules.includes(trimmed) ? d : { ...d, schedules: [...d.schedules, trimmed] }));
  };

  const removeSchedule = (cron: string) =>
    setDraft((d) => ({ ...d, schedules: d.schedules.filter((s) => s !== cron) }));

  // Выбранные id/uuid области применения (храним как csv в draft.scopeValues).
  const selectedScope = draft.scopeValues.split(",").map((s) => s.trim()).filter(Boolean);
  const toggleScope = (id: string) => {
    const set = new Set(selectedScope);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    patch("scopeValues", Array.from(set).join(", "));
  };

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error("Укажите название правила");
      return;
    }
    if (draft.schedules.length === 0) {
      toast.error("Добавьте хотя бы одно расписание");
      return;
    }
    try {
      setSaving(true);
      const body = draftToInput(draft);
      if (editing) {
        await api.updateAntiAbuseRule(token, editing.id, body);
        toast.success("Правило обновлено");
      } else {
        await api.createAntiAbuseRule(token, body);
        toast.success("Правило создано");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error("Не удалось сохранить", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Редактирование правила" : "Новое правило"}</DialogTitle>
          <DialogDescription>Теневой лимит трафика: предупреждение или блокировка превысивших порог.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* name + enabled */}
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="aa-name">Название</Label>
              <Input id="aa-name" value={draft.name} onChange={(e) => patch("name", e.target.value)} placeholder="Например: Дневной лимит 100 ГБ" />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={draft.enabled} onCheckedChange={(v) => patch("enabled", v)} id="aa-enabled" />
              <Label htmlFor="aa-enabled" className="cursor-pointer">Включено</Label>
            </div>
          </div>

          {/* schedules */}
          <div className="space-y-2">
            <Label>Будильники (cron)</Label>
            <div className="flex flex-wrap gap-1.5">
              {draft.schedules.length === 0 && (
                <span className="text-xs text-muted-foreground">Нет расписаний — добавьте минимум одно.</span>
              )}
              {draft.schedules.map((cron) => (
                <span key={cron} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-foreground/[0.04] px-2.5 py-1 text-xs font-mono">
                  {cron}
                  <button type="button" onClick={() => removeSchedule(cron)} className="text-muted-foreground hover:text-red-500 transition-colors" title="Удалить">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SCHEDULE_PRESETS.map((p) => (
                <Button key={p.cron} type="button" size="sm" variant="outline" className="h-7 text-xs rounded-lg" onClick={() => addSchedule(p.cron)}>
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={cronInput} onChange={(e) => setCronInput(e.target.value)} placeholder="Своя cron-строка, напр. 0 */3 * * *" className="font-mono text-xs" />
              <Button type="button" size="icon" variant="outline" onClick={() => { addSchedule(cronInput); setCronInput(""); }} title="Добавить cron">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* window + limit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Окно подсчёта</Label>
              <GlassSelect
                value={draft.windowKind}
                onChange={(v) => patch("windowKind", v as RuleDraft["windowKind"])}
                options={[
                  { value: "day", label: "Сутки (точно)" },
                  { value: "week", label: "Неделя (точно)" },
                  { value: "rolling", label: "Между проверками (точный час)" },
                  { value: "custom", label: "Произвольно (дни)" },
                  { value: "hour", label: "Час (≈ сутки, неточно)" },
                ]}
              />
              {draft.windowKind === "rolling" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Считает трафик, накачанный <b>между двумя проверками</b> (дельта счётчика). Точный час/15&nbsp;мин задаётся будильником.
                </p>
              )}
              {draft.windowKind === "hour" && (
                <p className="mt-1 text-[11px] text-amber-500">
                  Remna не отдаёт почасово — «час» фактически считается за текущие сутки. Для точного часа выбери «Между проверками».
                </p>
              )}
              {(draft.windowKind === "custom" || draft.windowKind === "rolling") && (
                <Input
                  type="number"
                  min={1}
                  value={draft.windowValueHours}
                  onChange={(e) => patch("windowValueHours", e.target.value)}
                  placeholder={draft.windowKind === "rolling" ? "Часов (для срока бана)" : "Часов"}
                  className="mt-2"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aa-limit">Лимит трафика, ГБ</Label>
              <Input
                id="aa-limit"
                type="number"
                min={0}
                step="0.1"
                value={draft.limitGb}
                onChange={(e) => patch("limitGb", e.target.value)}
                placeholder="100"
              />
            </div>
          </div>

          {/* action + ban duration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Действие</Label>
              <GlassSelect
                value={draft.action}
                onChange={(v) => patch("action", v as RuleDraft["action"])}
                options={[
                  { value: "WARN", label: "Предупреждение (WARN)" },
                  { value: "BAN", label: "Блокировка (BAN)" },
                ]}
              />
            </div>
            {draft.action === "BAN" && (
              <div className="space-y-1.5">
                <Label>Длительность блокировки</Label>
                <GlassSelect
                  value={draft.banDurationKind}
                  onChange={(v) => patch("banDurationKind", v as RuleDraft["banDurationKind"])}
                  options={[
                    { value: "until_window_end", label: "До конца окна" },
                    { value: "fixed", label: "Фиксированно" },
                  ]}
                />
                {draft.banDurationKind === "fixed" && (
                  <Input
                    type="number"
                    min={1}
                    value={draft.banDurationHours}
                    onChange={(e) => patch("banDurationHours", e.target.value)}
                    placeholder="Часов"
                    className="mt-2"
                  />
                )}
              </div>
            )}
          </div>

          {/* channels */}
          <div className="space-y-2">
            <Label>Каналы уведомления</Label>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Switch checked={draft.channelTelegram} onCheckedChange={(v) => patch("channelTelegram", v)} id="aa-ch-tg" />
                <Label htmlFor="aa-ch-tg" className="cursor-pointer">Telegram</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={draft.channelEmail} onCheckedChange={(v) => patch("channelEmail", v)} id="aa-ch-email" />
                <Label htmlFor="aa-ch-email" className="cursor-pointer">Email</Label>
              </div>
            </div>
          </div>

          {/* message */}
          <div className="space-y-1.5">
            <Label htmlFor="aa-msg">Текст сообщения</Label>
            <Textarea
              id="aa-msg"
              rows={4}
              value={draft.messageText}
              onChange={(e) => patch("messageText", e.target.value)}
              placeholder="Вы превысили лимит трафика по тарифу {tariff}…"
            />
            <p className="text-[11px] text-muted-foreground">
              Плейсхолдеры: <code>{"{tariff}"}</code> <code>{"{sub_index}"}</code> <code>{"{used}"}</code> <code>{"{limit}"}</code> <code>{"{period}"}</code> <code>{"{until}"}</code>
            </p>
          </div>

          {/* email subject (only if email channel) */}
          {draft.channelEmail && (
            <div className="space-y-1.5">
              <Label htmlFor="aa-subj">Тема письма</Label>
              <Input id="aa-subj" value={draft.emailSubject} onChange={(e) => patch("emailSubject", e.target.value)} placeholder="Превышение лимита трафика" />
            </div>
          )}

          {/* scope + priority */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Область применения</Label>
              <GlassSelect
                value={draft.scopeKind}
                onChange={(v) => patch("scopeKind", v as RuleDraft["scopeKind"])}
                options={[
                  { value: "all", label: "Все" },
                  { value: "tariff", label: "По тарифам" },
                  { value: "squad", label: "По сквадам" },
                ]}
              />
              {draft.scopeKind === "tariff" && (
                <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-border/50 bg-background/40 p-2 space-y-1">
                  {tariffOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">Тарифы не найдены</p>
                  ) : (
                    tariffOptions.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-background/60 cursor-pointer text-sm">
                        <input type="checkbox" checked={selectedScope.includes(t.id)} onChange={() => toggleScope(t.id)} className="accent-primary" />
                        <span className="truncate">{t.name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
              {draft.scopeKind === "squad" && (
                <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-border/50 bg-background/40 p-2 space-y-1">
                  {squadOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">Сквады не найдены</p>
                  ) : (
                    squadOptions.map((s) => (
                      <label key={s.uuid} className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-background/60 cursor-pointer text-sm">
                        <input type="checkbox" checked={selectedScope.includes(s.uuid)} onChange={() => toggleScope(s.uuid)} className="accent-primary" />
                        <span className="truncate">{s.name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
              {draft.scopeKind !== "all" && selectedScope.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">Выбрано: {selectedScope.length}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aa-priority">Приоритет</Label>
              <Input id="aa-priority" type="number" value={draft.priority} onChange={(e) => patch("priority", e.target.value)} placeholder="0" />
            </div>
          </div>

          {draft.action === "WARN" && (
            <div className="space-y-1.5">
              <Label htmlFor="aa-resend">Повторять предупреждение каждые (часов)</Label>
              <Input id="aa-resend" type="number" min={1} value={draft.resendAfterHours} onChange={(e) => patch("resendAfterHours", e.target.value)} placeholder="не повторять" />
              <p className="text-[11px] text-muted-foreground">
                Если юзер <b>не снизил</b> потребление — напомнить снова через N часов. Пусто = один раз. Пока подписка в бане — предупреждения молчат.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Отмена</Button>
            <Button type="button" onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── вкладка: Листинг ─────────────────────────────────────────────────────────────
function ListingTab({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banned, setBanned] = useState<AntiAbuseBannedItem[]>([]);
  const [warned, setWarned] = useState<AntiAbuseWarnedItem[]>([]);
  const [unbanning, setUnbanning] = useState<string | null>(null);
  // T-manual-ban (19.06.2026): ручная блокировка подписки из листинга предупреждённых.
  const [banTarget, setBanTarget] = useState<AntiAbuseWarnedItem | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banPreset, setBanPreset] = useState<"1" | "3" | "7" | "30" | "custom" | "forever">("7");
  const [banCustomDays, setBanCustomDays] = useState("");
  const [banning, setBanning] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getAntiAbuseState(token);
      setBanned(res.banned);
      setWarned(res.warned);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const unban = async (subscriptionId: string) => {
    // T-abuse-grace (29.06.2026): админ задаёт срок иммунитета от авто-бана.
    const input = window.prompt(
      "На сколько ДНЕЙ дать иммунитет от авто-бана?\n\nВ это время крон не забанит подписку снова — даём время исправиться. Если через срок не исправился — забанит как обычно.\n\n0 = без иммунитета (крон может забанить уже на следующем часе).",
      "7",
    );
    if (input === null) return;
    const immuneDays = Math.max(0, Math.min(365, Math.round(Number(input) || 0)));
    try {
      setUnbanning(subscriptionId);
      await api.unbanAntiAbuse(token, subscriptionId, immuneDays);
      toast.success(immuneDays > 0 ? `Разблокировано. Иммунитет от авто-бана: ${immuneDays} дн.` : "Разблокировано (без иммунитета)");
      await load();
    } catch (e) {
      toast.error("Не удалось разбанить", e instanceof Error ? e.message : undefined);
    } finally {
      setUnbanning(null);
    }
  };

  const openBanDialog = (w: AntiAbuseWarnedItem) => {
    setBanTarget(w);
    setBanReason("");
    setBanPreset("7");
    setBanCustomDays("");
  };

  const submitBan = async () => {
    const subId = banTarget?.subscription?.id;
    if (!subId) return;
    const reason = banReason.trim();
    if (!reason) { toast.error("Укажите причину блокировки"); return; }
    let durationHours: number | null;
    if (banPreset === "forever") {
      durationHours = null;
    } else if (banPreset === "custom") {
      const d = parseInt(banCustomDays, 10);
      if (!Number.isFinite(d) || d <= 0) { toast.error("Укажите число дней (больше 0)"); return; }
      durationHours = d * 24;
    } else {
      durationHours = parseInt(banPreset, 10) * 24;
    }
    try {
      setBanning(true);
      await api.banAntiAbuse(token, subId, { reason, durationHours });
      toast.success(durationHours === null ? "Подписка заблокирована (бессрочно)" : "Подписка заблокирована");
      setBanTarget(null);
      await load();
    } catch (e) {
      toast.error("Не удалось заблокировать", e instanceof Error ? e.message : undefined);
    } finally {
      setBanning(false);
    }
  };

  if (loading) return <LoadingCard text="Загрузка состояния…" />;
  if (error) return <ErrorBox message={error} />;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={load}>
          <RefreshCw className="h-4 w-4" /> Обновить
        </Button>
      </div>

      {/* Banned */}
      <Card className="rounded-[2rem] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
          <ShieldX className="h-4 w-4 text-red-500 dark:text-red-400" />
          <h3 className="text-sm font-bold">🚫 Заблокированы сейчас</h3>
          {banned.length > 0 && <span className="text-xs text-muted-foreground">({banned.length})</span>}
        </div>
        {banned.length === 0 ? (
          <EmptyState icon={ShieldBan} text="Нет заблокированных" />
        ) : (
          <div className="divide-y divide-white/5">
            {banned.map((b) => (
              <div key={b.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">Подписка #{b.subscriptionIndex}</span>
                    {b.tariff?.name && <span className="text-xs text-muted-foreground">· {b.tariff.name}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{ownerLabel(b.owner)}</span>
                    {b.banReason && <span>Причина: {b.banReason}</span>}
                    <span>До: {formatDateRu(b.bannedUntil)}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-xl shrink-0"
                  onClick={() => unban(b.id)}
                  disabled={unbanning === b.id}
                >
                  {unbanning === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
                  Разбанить
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Warned */}
      <Card className="rounded-[2rem] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-yellow-500 dark:text-yellow-400" />
          <h3 className="text-sm font-bold">⚠️ Предупреждены</h3>
          {warned.length > 0 && <span className="text-xs text-muted-foreground">({warned.length})</span>}
        </div>
        {warned.length === 0 ? (
          <EmptyState icon={AlertTriangle} text="Нет предупреждённых" />
        ) : (
          <div className="divide-y divide-white/5">
            {warned.map((w) => (
              <div key={w.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">Подписка #{w.subscription?.subscriptionIndex ?? "?"}</span>
                    {w.subscription?.tariff?.name && <span className="text-xs text-muted-foreground">· {w.subscription.tariff.name}</span>}
                    {w.rule?.name && <span className="text-xs text-muted-foreground">· {w.rule.name}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{ownerLabel(w.subscription?.owner)}</span>
                    <span>Трафик: {formatBytes(w.lastPeriodBytes)}</span>
                    {w.windowKey && <span>Окно: {w.windowKey}</span>}
                    <span>{formatDateRu(w.warnedAt)}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-xl shrink-0 border-red-500/30 text-red-500 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => openBanDialog(w)}
                  disabled={!w.subscription?.id}
                >
                  <ShieldX className="h-4 w-4" /> Заблокировать
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Модалка ручной блокировки подписки */}
      <Dialog open={!!banTarget} onOpenChange={(o) => { if (!o) setBanTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldX className="h-5 w-5 text-red-500" /> Заблокировать подписку
            </DialogTitle>
            <DialogDescription>
              {banTarget?.subscription
                ? `Подписка #${banTarget.subscription.subscriptionIndex ?? "?"}${banTarget.subscription.tariff?.name ? ` · ${banTarget.subscription.tariff.name}` : ""} · ${ownerLabel(banTarget.subscription.owner)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Причина блокировки</Label>
              <Textarea
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Например: подозрение на перепродажу трафика"
                rows={3}
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Срок блокировки</Label>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { v: "1", l: "1 день" },
                  { v: "3", l: "3 дня" },
                  { v: "7", l: "7 дней" },
                  { v: "30", l: "30 дней" },
                  { v: "custom", l: "Своё" },
                  { v: "forever", l: "Бессрочно" },
                ] as const).map((p) => (
                  <button
                    key={p.v}
                    type="button"
                    onClick={() => setBanPreset(p.v)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                      banPreset === p.v
                        ? "border-red-500/40 bg-red-500/15 text-red-500 dark:text-red-300"
                        : "border-white/10 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.l}
                  </button>
                ))}
              </div>
              {banPreset === "custom" && (
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    type="number"
                    min={1}
                    value={banCustomDays}
                    onChange={(e) => setBanCustomDays(e.target.value)}
                    placeholder="Число дней"
                    className="w-36"
                  />
                  <span className="text-xs text-muted-foreground">дней</span>
                </div>
              )}
              {banPreset === "forever" && (
                <p className="pt-1 text-xs text-muted-foreground">Подписка останется заблокированной до ручного разбана.</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" className="rounded-xl" onClick={() => setBanTarget(null)} disabled={banning}>Отмена</Button>
            <Button
              className="gap-1.5 rounded-xl bg-red-600 text-white hover:bg-red-700"
              onClick={submitBan}
              disabled={banning}
            >
              {banning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />}
              Заблокировать
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── вкладка: Правила ─────────────────────────────────────────────────────────────
function RulesTab({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<AntiAbuseRule[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AntiAbuseRule | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getAntiAbuseRules(token);
      setRules(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (rule: AntiAbuseRule) => { setEditing(rule); setDialogOpen(true); };

  const runNow = async (rule: AntiAbuseRule) => {
    try {
      setRunningId(rule.id);
      const res = await api.runAntiAbuseRule(token, rule.id);
      toast.success("Правило проверено", res.message);
      await load();
    } catch (e) {
      toast.error("Ошибка проверки", e instanceof Error ? e.message : undefined);
    } finally {
      setRunningId(null);
    }
  };

  const remove = async (rule: AntiAbuseRule) => {
    if (!window.confirm(`Удалить правило «${rule.name}»?`)) return;
    try {
      await api.deleteAntiAbuseRule(token, rule.id);
      toast.success("Правило удалено");
      await load();
    } catch (e) {
      toast.error("Не удалось удалить", e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-2">
        <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить
        </Button>
        <Button size="sm" className="gap-1.5 rounded-xl" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Создать правило
        </Button>
      </div>

      {error && <ErrorBox message={error} />}

      {loading && rules.length === 0 ? (
        <LoadingCard text="Загрузка правил…" />
      ) : rules.length === 0 ? (
        <Card className="rounded-[2rem]"><EmptyState icon={ListChecks} text="Правил пока нет — создайте первое." /></Card>
      ) : (
        <div className="grid gap-3">
          {rules.map((rule, i) => (
            <motion.div
              key={rule.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
            >
              <Card className="rounded-2xl p-4">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{rule.name}</span>
                      <EnabledBadge enabled={rule.enabled} />
                      <ActionBadge action={rule.action} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <span>Окно: {windowLabel(rule)}</span>
                      <span>Лимит: {formatBytes(rule.limitBytes)}</span>
                      <span>Приоритет: {rule.priority}</span>
                      {rule.schedules.length > 0 && (
                        <span className="font-mono">{rule.schedules.join(" · ")}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="gap-1.5 rounded-xl" onClick={() => openEdit(rule)}>
                      <Pencil className="h-3.5 w-3.5" /> Редактировать
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 rounded-xl"
                      onClick={() => runNow(rule)}
                      disabled={runningId === rule.id}
                    >
                      {runningId === rule.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                      Проверить
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-xl" onClick={() => remove(rule)} title="Удалить">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <RuleDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} token={token} onSaved={load} />
    </div>
  );
}

// ── вкладка: Настройки ─────────────────────────────────────────────────────────────
function SettingsTab({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [topN, setTopN] = useState("500");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getAntiAbuseSettings(token);
      setEnabled(res.enabled);
      setTopN(String(res.topN));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      setSaving(true);
      await api.updateAntiAbuseSettings(token, { enabled, topN: Number(topN) || 0 });
      toast.success("Настройки сохранены");
    } catch (e) {
      toast.error("Не удалось сохранить", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingCard text="Загрузка настроек…" />;
  if (error) return <ErrorBox message={error} />;

  return (
    <Card className="rounded-[2rem] p-6 space-y-6 max-w-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label className="text-base">Система включена</Label>
          <p className="text-xs text-muted-foreground mt-1">Главный рубильник: выключено = ни одно правило не срабатывает.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="aa-topn">Топ-потребителей на ноду</Label>
        <Input id="aa-topn" type="number" min={1} value={topN} onChange={(e) => setTopN(e.target.value.replace(/\D/g, ""))} className="max-w-[160px]" />
        <p className="text-xs text-muted-foreground">Сколько топ-потребителей опрашивать на каждой ноде (по умолчанию 500).</p>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить
        </Button>
      </div>
    </Card>
  );
}

// ── вкладка: Журнал ─────────────────────────────────────────────────────────────
function LogTab({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<AntiAbuseEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [ruleFilter, setRuleFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [ruleOptions, setRuleOptions] = useState<{ value: string; label: string }[]>([]);

  // Список правил для фильтра.
  useEffect(() => {
    api.getAntiAbuseRules(token)
      .then((r) => setRuleOptions(r.items.map((rl) => ({ value: rl.id, label: rl.name }))))
      .catch(() => setRuleOptions([]));
  }, [token]);

  const buildParams = useCallback((cursor?: string) => ({
    limit: 50,
    eventType: filter === "all" ? undefined : filter,
    ruleId: ruleFilter === "all" ? undefined : ruleFilter,
    dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : undefined,
    cursor,
  }), [filter, ruleFilter, dateFrom, dateTo]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getAntiAbuseEvents(token, buildParams());
      setEvents(res.items);
      setNextCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [token, buildParams]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    try {
      setLoadingMore(true);
      const res = await api.getAntiAbuseEvents(token, buildParams(nextCursor));
      setEvents((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoadingMore(false);
    }
  }, [token, nextCursor, buildParams]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground block">Тип</span>
            <GlassSelect
              value={filter}
              onChange={setFilter}
              className="w-32"
              options={[
                { value: "all", label: "Все" },
                { value: "WARN", label: "WARN" },
                { value: "BAN", label: "BAN" },
                { value: "UNBAN", label: "UNBAN" },
                { value: "ERROR", label: "ERROR" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground block">Правило</span>
            <GlassSelect
              value={ruleFilter}
              onChange={setRuleFilter}
              className="w-48"
              options={[{ value: "all", label: "Все правила" }, ...ruleOptions]}
            />
          </div>
          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground block">С даты</span>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground block">По дату</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={() => load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить
        </Button>
      </div>

      {error && <ErrorBox message={error} />}

      {loading && events.length === 0 ? (
        <LoadingCard text="Загрузка журнала…" />
      ) : events.length === 0 ? (
        <Card className="rounded-[2rem]"><EmptyState icon={ScrollText} text="Событий нет" /></Card>
      ) : (
        <>
        <Card className="rounded-[2rem] overflow-hidden">
          {/* desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Тип</th>
                  <th className="px-4 py-3 font-medium">Подписка</th>
                  <th className="px-4 py-3 font-medium">Трафик</th>
                  <th className="px-4 py-3 font-medium">Окно</th>
                  <th className="px-4 py-3 font-medium">Каналы</th>
                  <th className="px-4 py-3 font-medium">Детали</th>
                  <th className="px-4 py-3 font-medium">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-foreground/[0.02]">
                    <td className="px-4 py-2.5"><EventTypeBadge type={ev.eventType} /></td>
                    <td className="px-4 py-2.5">
                      <div>#{ev.subscription?.subscriptionIndex ?? "?"}</div>
                      <div className="text-xs text-muted-foreground">{ownerLabel(ev.subscription?.owner)}</div>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{formatBytes(ev.periodBytes)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{ev.windowKey ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{channelsLabel(ev.channelsSent)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[220px] truncate" title={ev.detail ?? undefined}>{ev.detail ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">{formatDateRu(ev.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* mobile cards */}
          <div className="md:hidden divide-y divide-white/5">
            {events.map((ev) => (
              <div key={ev.id} className="px-4 py-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <EventTypeBadge type={ev.eventType} />
                  <span className="text-xs text-muted-foreground">{formatDateRu(ev.createdAt)}</span>
                </div>
                <div className="text-sm">Подписка #{ev.subscription?.subscriptionIndex ?? "?"} · {ownerLabel(ev.subscription?.owner)}</div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>Трафик: {formatBytes(ev.periodBytes)}</span>
                  {ev.windowKey && <span>Окно: {ev.windowKey}</span>}
                  <span>Каналы: {channelsLabel(ev.channelsSent)}</span>
                </div>
                {ev.detail && <div className="text-xs text-muted-foreground">{ev.detail}</div>}
              </div>
            ))}
          </div>
        </Card>
        {nextCursor && (
          <div className="flex justify-center pt-1">
            <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={loadMore} disabled={loadingMore}>
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
              Загрузить ещё
            </Button>
          </div>
        )}
        </>
      )}
    </div>
  );
}

function channelsLabel(channels: AntiAbuseChannels | null | undefined): string {
  if (!channels) return "—";
  const parts: string[] = [];
  if (channels.telegram) parts.push("Telegram");
  if (channels.email) parts.push("Email");
  if (channels.site) parts.push("Сайт");
  return parts.length ? parts.join(", ") : "—";
}

// ── общие маленькие блоки ────────────────────────────────────────────────────────
function LoadingCard({ text }: { text: string }) {
  return (
    <Card className="rounded-[2rem] py-16 flex flex-col items-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </Card>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-3">
      <AlertCircle className="h-5 w-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-red-500 dark:text-red-400">Ошибка</p>
        <p className="text-xs text-muted-foreground mt-1">{message}</p>
      </div>
    </div>
  );
}

// ── страница ─────────────────────────────────────────────────────────────────────
export function AntiAbusePage() {
  const token = useAuth().state.accessToken!;
  const [tab, setTab] = useState("listing");

  return (
    <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      <div className="fixed -z-10 bg-red-500/10 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-orange-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-4 bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center shadow-inner border border-white/10">
          <ShieldBan className="h-6 w-6 text-red-500 dark:text-red-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
            Анти-абьюз
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Теневые лимиты трафика: предупреждения и блокировки нарушителей</p>
        </div>
      </motion.div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="listing" className="gap-1.5"><ShieldX className="h-4 w-4" /> Листинг</TabsTrigger>
          <TabsTrigger value="rules" className="gap-1.5"><ListChecks className="h-4 w-4" /> Правила</TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5"><Settings2 className="h-4 w-4" /> Настройки</TabsTrigger>
          <TabsTrigger value="log" className="gap-1.5"><ScrollText className="h-4 w-4" /> Журнал</TabsTrigger>
        </TabsList>

        <TabsContent value="listing">{tab === "listing" && <ListingTab token={token} />}</TabsContent>
        <TabsContent value="rules">{tab === "rules" && <RulesTab token={token} />}</TabsContent>
        <TabsContent value="settings">{tab === "settings" && <SettingsTab token={token} />}</TabsContent>
        <TabsContent value="log">{tab === "log" && <LogTab token={token} />}</TabsContent>
      </Tabs>
    </div>
  );
}
