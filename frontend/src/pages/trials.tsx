/**
 * админ-страница управления Trial-пресетами.
 *
 * Несколько триалов, каждый привязан к одному из тарифов (наследует squads/devices/traffic),
 * длительность задаётся отдельно. Один клиент = одна активация каждого триала.
 *
 * UI: таблица + модалка создания/редактирования. Сделано простой формой, без лишних украшений.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type { TrialRecord, CreateTrialPayload, TariffCategoryWithTariffs } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Pencil, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type FlatTariff = { id: string; name: string; categoryName: string };

export function TrialsPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? null;

  const [trials, setTrials] = useState<TrialRecord[]>([]);
  const [tariffsFlat, setTariffsFlat] = useState<FlatTariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"add" | { edit: TrialRecord } | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [trialsRes, catsRes] = await Promise.all([
        api.getTrials(token),
        api.getTariffCategories(token),
      ]);
      setTrials(trialsRes.items);
      const flat: FlatTariff[] = [];
      for (const c of catsRes.items as TariffCategoryWithTariffs[]) {
        for (const t of c.tariffs) {
          flat.push({ id: t.id, name: t.name, categoryName: c.name });
        }
      }
      setTariffsFlat(flat);
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

  const handleDelete = async (id: string) => {
    if (!token || !confirm("Удалить триал? Уже активированные клиентами подписки останутся живыми, но потеряют пометку.")) return;
    try {
      await api.deleteTrial(token, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleToggleEnabled = async (t: TrialRecord) => {
    if (!token) return;
    try {
      await api.updateTrial(token, t.id, { enabled: !t.enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка обновления");
    }
  };

  return (
    <div className="flex flex-col gap-3.5 relative">

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">Триалы</h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">
              Пробные подписки: каждый триал привязан к тарифу, клиент активирует каждый один раз. Когда все использованы — кнопка в боте скрывается.
            </p>
          </div>
        </div>
        <Button onClick={() => setModal("add")} className="gap-1.5 rounded-xl">
          <Plus className="h-4 w-4" />
          Добавить триал
        </Button>
      </motion.div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400">{error}</div>
      )}

      {loading && (
        <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем триалы…</p>
        </Card>
      )}

      {!loading && trials.length === 0 && (
        <Card className="bg-card border-border rounded-2xl p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <h3 className="text-[13.5px] font-bold tracking-tight">Триалов нет</h3>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Создайте первый — он появится в боте кнопкой «Получить пробную подписку».</p>
            <Button onClick={() => setModal("add")} className="mt-4 gap-1.5 rounded-xl">
              <Plus className="h-4 w-4" />
              Создать триал
            </Button>
          </div>
        </Card>
      )}

      {!loading && trials.length > 0 && (
        <Card className="bg-card border-border rounded-2xl overflow-hidden py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Порядок</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Название</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Тариф</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Дней</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Статус</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {trials.map((t) => (
                <tr key={t.id} className="border-t border-border hover:bg-foreground/5 transition-colors">
                  <td className="px-5 py-3.5 text-muted-foreground">{t.sortOrder}</td>
                  <td className="px-5 py-3.5 font-medium">{t.name}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{t.tariffName ?? "—"}</td>
                  <td className="px-5 py-3.5">{t.durationDays}</td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => handleToggleEnabled(t)}
                      title="Нажмите, чтобы переключить"
                      className={cn(
                        "inline-flex items-center gap-1.5 border rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
                        t.enabled
                          ? "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25"
                          : "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/25"
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", t.enabled ? "bg-emerald-400" : "bg-zinc-400")} />
                      {t.enabled ? "Включен" : "Выключен"}
                    </button>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setModal({ edit: t })} className="h-8 w-8 rounded-lg" title="Редактировать">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(t.id)} className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" title="Удалить">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {modal && (
        <TrialFormDialog
          mode={modal === "add" ? "add" : "edit"}
          trial={modal !== "add" ? modal.edit : undefined}
          tariffs={tariffsFlat}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// 
// Модалка создания/редактирования триала.

function TrialFormDialog({
  mode,
  trial,
  tariffs,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  trial?: TrialRecord;
  tariffs: FlatTariff[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { state } = useAuth();
  const token = state.accessToken ?? null;

  const [name, setName] = useState(trial?.name ?? "");
  // источник триала: существующий тариф ИЛИ standalone из сквада.
  const [source, setSource] = useState<"tariff" | "squad">(trial && !trial.tariffId ? "squad" : "tariff");
  const [tariffId, setTariffId] = useState(trial?.tariffId ?? tariffs[0]?.id ?? "");
  const [squadUuid, setSquadUuid] = useState<string>(trial?.squadUuids?.[0] ?? "");
  const [deviceLimit, setDeviceLimit] = useState<number>(trial?.deviceLimit ?? 1);
  const [squads, setSquads] = useState<{ uuid: string; name?: string }[]>([]);
  // конвертация триала: тоггл + «в любой тариф».
  const [convertEnabled, setConvertEnabled] = useState<boolean>(trial?.convertEnabled ?? true);
  const [convertAllTariffs, setConvertAllTariffs] = useState<boolean>(trial?.convertAllTariffs ?? false);
  const [durationDays, setDurationDays] = useState<number>(trial?.durationDays ?? 3);

  // сквады из Remna — для standalone-источника.
  useEffect(() => {
    if (!token) return;
    api.getRemnaSquadsInternal(token).then((r) => {
      const res = r as { response?: { internalSquads?: { uuid?: string; name?: string }[] } };
      const list = res?.response?.internalSquads ?? [];
      setSquads(Array.isArray(list) ? list.map((s) => ({ uuid: s.uuid ?? "", name: s.name })) : []);
    }).catch(() => setSquads([]));
  }, [token]);
  // отдельный лимит трафика триала в ГБ (пусто = из тарифа).
  // BigInt в БД, в UI работаем в ГБ для удобства администратора.
  const initialTrialGb = trial?.trafficLimitBytes != null
    ? (Number(trial.trafficLimitBytes) / (1024 ** 3)).toFixed(2).replace(/\.?0+$/, "")
    : "";
  const [trialTrafficGb, setTrialTrafficGb] = useState<string>(initialTrialGb);
  const [enabled, setEnabled] = useState(trial?.enabled ?? true);
  const [sortOrder, setSortOrder] = useState<number>(trial?.sortOrder ?? 0);
  const [description, setDescription] = useState(trial?.description ?? "");
  // тарифы, в которые можно конвертировать триал после
  // пробного периода (переход на их сквады). Пусто — только тариф триала.
  const [convertIds, setConvertIds] = useState<string[]>(trial?.convertTariffIds ?? []);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    if (!token) return;
    if (!name.trim() || durationDays < 1 || (source === "tariff" ? !tariffId : !squadUuid)) {
      setErr(source === "tariff"
        ? "Заполните название, выберите тариф и укажите длительность ≥ 1."
        : "Заполните название, выберите сквад и укажите длительность ≥ 1.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      // T16 (12.05.2026) — ГБ  байты (BigInt в БД).
      // Пустая строка / 0 / NaN  null (используется лимит тарифа).
      let trafficLimitBytes: number | null = null;
      if (trialTrafficGb.trim()) {
        const gb = parseFloat(trialTrafficGb.replace(",", "."));
        if (Number.isFinite(gb) && gb > 0) {
          trafficLimitBytes = Math.floor(gb * 1024 ** 3);
        }
      }
      const payload: CreateTrialPayload = {
        name: name.trim(),
        tariffId: source === "tariff" ? tariffId : null,
        squadUuids: source === "squad" ? [squadUuid] : null,
        deviceLimit: source === "squad" ? Math.max(1, deviceLimit) : null,
        durationDays,
        trafficLimitBytes,
        enabled,
        sortOrder,
        description: description.trim() || null,
        convertEnabled,
        convertAllTariffs,
        // сам тариф триала всегда доступен — храним только дополнительные.
        convertTariffIds: convertAllTariffs ? null : convertIds.filter((id) => id !== tariffId),
      };
      if (mode === "edit" && trial) {
        await api.updateTrial(token, trial.id, payload);
      } else {
        await api.createTrial(token, payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-card border-border rounded-2xl p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
            {mode === "add" ? <Plus className="h-5 w-5 text-primary" /> : <Pencil className="h-5 w-5 text-primary" />}
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight">{mode === "add" ? "Новый триал" : "Редактировать триал"}</h2>
            <p className="text-xs text-muted-foreground">Источник, длительность и правила конвертации</p>
          </div>
        </div>

        {err && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500 dark:text-red-400">
            {err}
          </div>
        )}

        <div className="grid gap-1">
          <Label htmlFor="trial-name" className="text-xs">Название (видно клиенту в боте)</Label>
          <Input
            id="trial-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder=" Пробная Стандартная"
          />
        </div>

        {/* источник: тариф или standalone-сквад. */}
        <div className="grid gap-1.5">
          <Label className="text-xs">Источник триала</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSource("tariff")}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${source === "tariff" ? "border-border bg-primary/10 text-primary" : "border-input bg-background text-muted-foreground"}`}
            >
              Из тарифа
            </button>
            <button
              type="button"
              onClick={() => setSource("squad")}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${source === "squad" ? "border-border bg-primary/10 text-primary" : "border-input bg-background text-muted-foreground"}`}
            >
              Из сквада (не тариф)
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            «Из сквада» — псевдо-тариф: в каталоге тарифов не отображается, сквад и лимиты задаются прямо здесь.
          </p>
        </div>

        {source === "tariff" ? (
        <div className="grid gap-1">
          <Label htmlFor="trial-tariff" className="text-xs">Тариф (наследует squads, устройства, трафик)</Label>
          <select
            id="trial-tariff"
            value={tariffId}
            onChange={(e) => setTariffId(e.target.value)}
            className="w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {tariffs.length === 0 && <option value="">— Сначала создайте тариф —</option>}
            {tariffs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.categoryName} — {t.name}
              </option>
            ))}
          </select>
        </div>
        ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="trial-squad" className="text-xs">Сквад (Remna)</Label>
            <select
              id="trial-squad"
              value={squadUuid}
              onChange={(e) => setSquadUuid(e.target.value)}
              className="w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">— Выберите сквад —</option>
              {squads.map((s) => (
                <option key={s.uuid} value={s.uuid}>{s.name ?? s.uuid}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="trial-devlimit" className="text-xs">Лимит устройств</Label>
            <Input
              id="trial-devlimit"
              type="number"
              min={1}
              max={100}
              value={deviceLimit}
              onChange={(e) => setDeviceLimit(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
        </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="trial-days" className="text-xs">Длительность (дней)</Label>
            <Input
              id="trial-days"
              type="number"
              min={1}
              max={365}
              value={durationDays}
              onChange={(e) => setDurationDays(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="trial-order" className="text-xs">Порядок (0 — сверху)</Label>
            <Input
              id="trial-order"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
            />
          </div>
        </div>

        {/* отдельный лимит трафика для триала. */}
        <div className="grid gap-1">
          <Label htmlFor="trial-traffic-gb" className="text-xs">
            Лимит трафика триала (ГБ) <span className="text-[10px] opacity-60">пусто = брать из тарифа</span>
          </Label>
          <Input
            id="trial-traffic-gb"
            type="text"
            inputMode="decimal"
            placeholder="например 5 (для 5 ГБ)"
            value={trialTrafficGb}
            onChange={(e) => setTrialTrafficGb(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground">
            Если задан — на время триала клиент получит именно столько ГБ. При конвертации в платную подписку выставляется полный лимит из тарифа.
          </p>
        </div>

        {/* настройки конвертации триала. */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={convertEnabled}
            onChange={(e) => setConvertEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          Разрешить конвертацию в платный тариф
        </label>
        <p className="text-[10px] text-muted-foreground -mt-2">
          Включено — у триала кнопка «Конвертировать» (дни и остаток трафика сохраняются).
          Выключено — у триальной подписки не будет кнопок продления/конвертации вовсе.
        </p>

        {convertEnabled && (
        <>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={convertAllTariffs}
            onChange={(e) => setConvertAllTariffs(e.target.checked)}
            className="h-4 w-4"
          />
          Конвертировать можно в ЛЮБОЙ тариф
        </label>

        {!convertAllTariffs && (
        <div className="grid gap-1.5">
          <Label className="text-xs">
            Конвертация после триала <span className="text-[10px] opacity-60">в какие тарифы можно перейти</span>
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {tariffs.filter((t) => t.id !== tariffId).map((t) => {
              const on = convertIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setConvertIds((prev) => on ? prev.filter((x) => x !== t.id) : [...prev, t.id])}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                    on
                      ? "border-border bg-primary/10 text-primary"
                      : "border-input bg-background text-muted-foreground hover:border-border"
                  }`}
                >
                  {on ? " " : ""}{t.categoryName} — {t.name}
                </button>
              );
            })}
            {tariffs.filter((t) => t.id !== tariffId).length === 0 && (
              <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Других тарифов нет.</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            После пробного периода клиент сможет перейти на выбранные тарифы (сквады
            обновятся под новый тариф, дни и остаток трафика триала сохранятся).
            Тариф самого триала доступен всегда. Пусто — только он.
          </p>
        </div>
        )}
        </>
        )}

        <div className="grid gap-1">
          <Label htmlFor="trial-desc" className="text-xs">Описание (опц., показывается клиенту)</Label>
          <textarea
            id="trial-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Бесплатная пробная подписка на стандартный тариф на 3 дня..."
            rows={3}
            className="w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          Активен (виден в боте)
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "add" ? "Создать" : "Сохранить"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
