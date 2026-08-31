/**
 * T-subscription-remna (14.05.2026)
 *
 * Универсальная панель управления Remna user-ом конкретной подписки.
 * Используется в карточке клиента (вкладка «Подписки»), для primary и secondary
 * подписок одинаково. Делит UI на 3 внутренних вкладки:
 *
 *   -  «Обзор»       — данные Remna user + лимиты + кнопка «Применить»
 *   -  «Сквады»      — список internalSquads, добавить/убрать у этой подписки
 *   -  «Действия»    — Отозвать / Disable / Enable / Reset traffic / Refresh / Unlink
 *
 * Все вызовы идут на `/admin/subscriptions/:subId/remna/...`. Если подписка
 * ещё не привязана к Remna (remnawaveUuid=null) — рисуется warning-плашка.
 */
import { useState, useEffect, useCallback } from "react";
import {
  api,
  type AdminClientSubscriptionItem,
  type RemnaUserFull,
  type UpdateClientRemnaPayload,
} from "@/lib/api";
import { fmtMsk, isoToMskInputValue, mskInputValueToIso } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Ticket,
  Ban,
  ShieldCheck,
  Wifi,
  RefreshCw,
  Unlink,
  Copy,
  Check,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STRATEGY_LABELS: Record<string, string> = {
  NO_RESET: "Без сброса",
  DAY: "Ежедневно",
  WEEK: "Еженедельно",
  MONTH: "Ежемесячно",
  MONTH_ROLLING: "Скользящий месяц",
};

function formatTrafficBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-card transition-colors"
      title="Скопировать"
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function MiniSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      className="flex h-9 w-full rounded-xl border border-border bg-foreground/[0.04] dark:bg-white/[0.04] hover:bg-black/30 transition-colors px-3 py-1 text-sm shadow-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

interface Props {
  subscription: AdminClientSubscriptionItem;
  token: string;
  remnaSquads: { uuid: string; name?: string }[];
  /** Вызывается после любого действия которое могло изменить состояние подписки/клиента (для refresh parent). */
  onChanged?: () => void;
}

type InnerTab = "overview" | "squads" | "actions";

interface RemnaUserResponseShape {
  response?: RemnaUserFull;
}

function unwrapRemnaUser(raw: unknown): RemnaUserFull | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RemnaUserResponseShape & Partial<RemnaUserFull>;
  if (r.response && typeof r.response === "object") return r.response as RemnaUserFull;
  if ("uuid" in r && typeof (r as RemnaUserFull).uuid === "string") return r as RemnaUserFull;
  return null;
}

export function SubscriptionRemnaPanel({ subscription, token, remnaSquads, onChanged }: Props) {
  const [innerTab, setInnerTab] = useState<InnerTab>("overview");
  const [remnaUser, setRemnaUser] = useState<RemnaUserFull | null>(null);
  const [activeSquads, setActiveSquads] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<UpdateClientRemnaPayload>({});

  const loadRemna = useCallback(async () => {
    if (!subscription.remnawaveUuid) {
      setRemnaUser(null);
      setActiveSquads([]);
      return;
    }
    setLoading(true);
    try {
      const raw = await api.getSubscriptionRemna(token, subscription.id);
      const user = unwrapRemnaUser(raw);
      setRemnaUser(user);
      const ids = (user?.activeInternalSquads ?? []).map((s) => s.uuid);
      setActiveSquads(ids);
      if (user) {
        setEditForm({
          trafficLimitBytes: user.trafficLimitBytes ?? 0,
          hwidDeviceLimit: user.hwidDeviceLimit,
          trafficLimitStrategy: user.trafficLimitStrategy as UpdateClientRemnaPayload["trafficLimitStrategy"],
          expireAt: user.expireAt ?? undefined,
        });
      }
    } catch (e) {
      setActionMsg(` ${e instanceof Error ? e.message : "Ошибка загрузки"}`);
    } finally {
      setLoading(false);
    }
  }, [subscription.id, subscription.remnawaveUuid, token]);

  useEffect(() => {
    loadRemna();
  }, [loadRemna]);

  async function applyLimits() {
    setSaving(true);
    setActionMsg(null);
    try {
      const payload: UpdateClientRemnaPayload = {};
      if (editForm.trafficLimitBytes !== undefined) payload.trafficLimitBytes = editForm.trafficLimitBytes;
      if (editForm.hwidDeviceLimit !== undefined) payload.hwidDeviceLimit = editForm.hwidDeviceLimit;
      if (editForm.trafficLimitStrategy) payload.trafficLimitStrategy = editForm.trafficLimitStrategy;
      if (editForm.expireAt) payload.expireAt = editForm.expireAt;
      await api.updateSubscriptionRemna(token, subscription.id, payload);
      setActionMsg(" Лимиты применены");
      await loadRemna();
      onChanged?.();
    } catch (e) {
      setActionMsg(` ${e instanceof Error ? e.message : "Ошибка"}`);
    } finally {
      setSaving(false);
    }
  }

  async function runAction(successLabel: string, fn: () => Promise<unknown>) {
    setActionMsg(null);
    try {
      await fn();
      setActionMsg(` ${successLabel}`);
      await loadRemna();
      onChanged?.();
    } catch (e) {
      setActionMsg(` ${e instanceof Error ? e.message : "Ошибка"}`);
    }
  }

  async function squadAdd(uuid: string) {
    await runAction("Сквад добавлен", () => api.subscriptionRemnaSquadAdd(token, subscription.id, uuid));
    setActiveSquads((prev) => (prev.includes(uuid) ? prev : [...prev, uuid]));
  }

  async function squadRemove(uuid: string) {
    await runAction("Сквад удалён", () => api.subscriptionRemnaSquadRemove(token, subscription.id, uuid));
    setActiveSquads((prev) => prev.filter((u) => u !== uuid));
  }

  // Нет привязки к Remna  плашка.
  if (!subscription.remnawaveUuid) {
    return (
      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/[0.06] p-4 text-sm text-yellow-200">
         Эта подписка ещё не привязана к Remna (`remnawaveUuid = null`).
        Купите/активируйте тариф или сделайте «Push в Remna» в массовых операциях клиента.
      </div>
    );
  }

  const trafficUsed = remnaUser?.userTraffic?.usedTrafficBytes ?? 0;
  const trafficLimit = remnaUser?.trafficLimitBytes ?? 0;

  return (
    <div className="space-y-3">
      <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as InnerTab)}>
        <TabsList className="flex flex-wrap gap-1 bg-foreground/[0.03] dark:bg-white/[0.03] p-1 rounded-xl border border-border">
          <TabsTrigger value="overview" className="text-xs rounded-lg data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
             Обзор
          </TabsTrigger>
          <TabsTrigger value="squads" className="text-xs rounded-lg data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
             Сквады
          </TabsTrigger>
          <TabsTrigger value="actions" className="text-xs rounded-lg data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
             Действия
          </TabsTrigger>
        </TabsList>

        {/*  ОБЗОР: данные Remna + лимиты + Применить  */}
        <TabsContent value="overview" className="mt-3 space-y-4">
          {loading && <p className="text-muted-foreground text-sm">Загрузка данных Remna…</p>}

          {remnaUser && (
            <div className="rounded-xl bg-card border border-border p-4 space-y-2 text-sm">
              <div className="font-medium text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Данные Remna
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Username</span>
                  <span className="flex items-center gap-1">
                    <code className="text-xs">{remnaUser.username}</code>
                    <CopyButton text={remnaUser.username} />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ID Remna</span>
                  <span className="font-mono text-xs">{remnaUser.id ?? "—"}</span>
                </div>
                {/* В Remnawave 3.x поля uuid нет — пользователь адресуется
                    числовым id (он показан строкой выше). Строку не рисуем,
                    иначе обращение к undefined роняло всю панель. */}
                {remnaUser.uuid && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">UUID</span>
                    <span className="flex items-center gap-1">
                      <code className="text-[10px]">{remnaUser.uuid.slice(0, 12)}…</code>
                      <CopyButton text={remnaUser.uuid} />
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Трафик</span>
                  <span>
                    {formatTrafficBytes(trafficUsed)}
                    {trafficLimit > 0 ? ` / ${formatTrafficBytes(trafficLimit)}` : " (безлимит)"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Стратегия сброса</span>
                  <span>{STRATEGY_LABELS[remnaUser.trafficLimitStrategy] ?? remnaUser.trafficLimitStrategy}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Истекает</span>
                  <span>{fmtMsk(remnaUser.expireAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Создан в Remna</span>
                  <span>{fmtMsk(remnaUser.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Обновлён</span>
                  <span>{fmtMsk(remnaUser.updatedAt)}</span>
                </div>
              </div>
            </div>
          )}

          <div>
            <h3 className="font-semibold mb-3 text-sm">Лимиты и тариф</h3>
            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              <div className="space-y-2">
                <Label>Лимит трафика (ГБ, 0 = без лимита)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={
                    editForm.trafficLimitBytes !== undefined && editForm.trafficLimitBytes > 0
                      ? (editForm.trafficLimitBytes / 1024 ** 3).toFixed(2).replace(/\.?0+$/, "")
                      : editForm.trafficLimitBytes === 0
                      ? "0"
                      : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditForm((f) => ({
                      ...f,
                      trafficLimitBytes:
                        v === ""
                          ? undefined
                          : (() => {
                              const gb = parseFloat(v);
                              return Number.isNaN(gb) ? undefined : Math.round(gb * 1024 ** 3);
                            })(),
                    }));
                  }}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Лимит устройств (HWID)</Label>
                <Input
                  type="number"
                  min={0}
                  value={editForm.hwidDeviceLimit ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      hwidDeviceLimit: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  placeholder="—"
                />
              </div>
              <div className="space-y-2">
                <Label>Сброс трафика</Label>
                <MiniSelect
                  value={editForm.trafficLimitStrategy ?? ""}
                  onChange={(v) =>
                    setEditForm((f) => ({ ...f, trafficLimitStrategy: v as UpdateClientRemnaPayload["trafficLimitStrategy"] }))
                  }
                  options={[
                    { value: "", label: "—" },
                    { value: "NO_RESET", label: "Без сброса" },
                    { value: "DAY", label: "Ежедневно" },
                    { value: "WEEK", label: "Еженедельно" },
                    { value: "MONTH", label: "Ежемесячно" },
                    { value: "MONTH_ROLLING", label: "Скользящий месяц" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label>Дата окончания (МСК)</Label>
                <Input
                  type="datetime-local"
                  value={isoToMskInputValue(editForm.expireAt)}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      expireAt: mskInputValueToIso(e.target.value),
                    }))
                  }
                />
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 rounded-xl border-border bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08]"
              onClick={applyLimits}
              disabled={saving}
            >
              {saving ? "Применяем…" : "Применить лимиты"}
            </Button>
          </div>
        </TabsContent>

        {/*  СКВАДЫ  */}
        <TabsContent value="squads" className="mt-3">
          {remnaSquads.length === 0 ? (
            <div className="text-sm text-muted-foreground">Сквады Remna не настроены.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {remnaSquads.map((s) => {
                const inSquad = activeSquads.includes(s.uuid);
                return (
                  <span
                    key={s.uuid}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs border transition-colors",
                      inSquad
                        ? "bg-primary/10 border-border text-primary"
                        : "bg-muted border-transparent text-muted-foreground"
                    )}
                  >
                    <span className="font-medium">{s.name || String(s.uuid ?? "").slice(0, 8) || "—"}</span>
                    {inSquad ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-destructive text-[11px]"
                        onClick={() => squadRemove(s.uuid)}
                      >
                        Убрать
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-[11px]"
                        onClick={() => squadAdd(s.uuid)}
                      >
                        + Добавить
                      </Button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/*  ДЕЙСТВИЯ (быстрые действия per-subscription)  */}
        <TabsContent value="actions" className="mt-3 space-y-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.9px] text-muted-foreground mb-2">Подписка в Remnawave</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button variant="outline" className="justify-start gap-2 rounded-lg border-border bg-card hover:bg-muted text-[12.8px] font-semibold h-9"
                onClick={() => runAction("Включено в Remna", () => api.subscriptionRemnaEnable(token, subscription.id))}>
                <ShieldCheck className="h-4 w-4" /> Включить в Remna
              </Button>
              <Button variant="outline" className="justify-start gap-2 rounded-lg border-border bg-card hover:bg-muted text-[12.8px] font-semibold h-9"
                onClick={() => runAction("Трафик сброшен", () => api.subscriptionRemnaResetTraffic(token, subscription.id))}>
                <Wifi className="h-4 w-4" /> Сбросить трафик
              </Button>
              <Button variant="outline" className="justify-start gap-2 rounded-lg border-border bg-card hover:bg-muted text-[12.8px] font-semibold h-9"
                onClick={() => loadRemna()}>
                <RefreshCw className="h-4 w-4" /> Обновить данные
              </Button>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.9px] text-muted-foreground mb-2">Опасная зона</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button variant="outline" className="justify-start gap-2 rounded-lg border-destructive/40 text-destructive hover:bg-destructive/10 text-[12.8px] font-semibold h-9"
                onClick={() => runAction("Отключено в Remna", () => api.subscriptionRemnaDisable(token, subscription.id))}>
                <Ban className="h-4 w-4" /> Отключить в Remna
              </Button>
              <Button variant="outline" className="justify-start gap-2 rounded-lg border-destructive/40 text-destructive hover:bg-destructive/10 text-[12.8px] font-semibold h-9"
                onClick={() => runAction("Подписка отозвана", () => api.subscriptionRemnaRevokeSubscription(token, subscription.id))}>
                <Ticket className="h-4 w-4" /> Отозвать подписку
              </Button>
              <Button variant="outline" className="justify-start gap-2 rounded-lg border-destructive/40 text-destructive hover:bg-destructive/10 text-[12.8px] font-semibold h-9"
                onClick={() => {
                  if (!confirm("Отвязать эту подписку от Remna? UUID будет обнулён, при следующей покупке создастся новый.")) return;
                  runAction("Подписка отвязана от Remna", () => api.subscriptionRemnaUnlink(token, subscription.id));
                }}>
                <Unlink className="h-4 w-4" /> Отвязать от Remna
              </Button>
              <Button variant="outline" className="justify-start gap-2 rounded-lg border-destructive/40 text-destructive hover:bg-destructive/10 text-[12.8px] font-semibold h-9"
                onClick={() => {
                  if (!confirm("Удалить эту подписку? Она исчезнет у клиента, а пользователь в Remnawave будет удалён. Действие необратимо.")) return;
                  runAction("Подписка удалена", () => api.deleteSecondarySubscription(token, subscription.id));
                }}>
                <Trash2 className="h-4 w-4" /> Удалить подписку
              </Button>
            </div>
            <p className="text-[11.5px] text-muted-foreground mt-2">Отзыв подписки перевыпустит ссылку — старые конфиги у клиента перестанут работать. Удаление необратимо: подписка исчезнет и у клиента, и в Remnawave.</p>
          </div>
        </TabsContent>
      </Tabs>

      {actionMsg && <p className="text-sm text-muted-foreground">{actionMsg}</p>}
    </div>
  );
}
