import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  Check,
  Clock,
  Globe,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtMsk } from "@/lib/datetime";
import {
  clientsBulkApi,
  type AntibotCandidate,
  type AntibotFindFilters,
  type AntibotFindResult,
} from "@/lib/admin-extras-api";

type Preset = "all_test" | "recent_hour" | "ip_storm" | "custom";

export function AntibotPage() {
  const token = useAuth().state.accessToken!;

  const [filters, setFilters] = useState<AntibotFindFilters>({
    emailDomainBuiltinList: true,
    emailPatternBuiltin: true,
    neverConnected: true,
    hasNoPayments: true,
    limit: 500,
  });
  const [preset, setPreset] = useState<Preset>("custom");
  const [result, setResult] = useState<AntibotFindResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [purging, setPurging] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === "all_test") {
      setFilters({
        emailDomainBuiltinList: true,
        emailPatternBuiltin: true,
        neverConnected: true,
        hasNoPayments: true,
        limit: 1000,
      });
    } else if (p === "recent_hour") {
      setFilters({
        createdSinceMinutes: 60,
        emailDomainBuiltinList: true,
        emailPatternBuiltin: true,
        neverConnected: true,
        hasNoPayments: true,
        limit: 1000,
      });
    } else if (p === "ip_storm") {
      setFilters({
        sameIpThreshold: 5,
        createdSinceMinutes: 60 * 24,
        neverConnected: true,
        hasNoPayments: true,
        limit: 2000,
      });
    }
  };

  const find = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setSelected(new Set());
      setPurgeMsg(null);
      const r = await clientsBulkApi.antibotFind(token, filters);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка поиска");
    } finally {
      setLoading(false);
    }
  }, [token, filters]);

  const toggleAll = () => {
    if (!result) return;
    if (selected.size === result.candidates.length) setSelected(new Set());
    else setSelected(new Set(result.candidates.map((c) => c.id)));
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const purge = async (force = false) => {
    if (selected.size === 0) return;
    const msg = force
      ? `Удалить ${selected.size} клиентов БЕЗ защиты от удаления платящих? Это необратимо.`
      : `Удалить ${selected.size} клиентов? Платящие/с активной подпиской будут пропущены.`;
    if (!confirm(msg)) return;
    try {
      setPurging(true);
      const r = await clientsBulkApi.antibotPurge(token, { ids: Array.from(selected), force });
      setPurgeMsg(
        `Удалено ${r.deleted} из ${r.requested}` +
          (r.protected.length > 0 ? `, защищено ${r.protected.length} (платящие)` : "") +
          (r.errors.length > 0 ? `, ошибок ${r.errors.length}` : "")
      );
      setSelected(new Set());
      await find();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setPurging(false);
    }
  };

  const allSelected = useMemo(
    () => result !== null && result.candidates.length > 0 && selected.size === result.candidates.length,
    [result, selected]
  );

  return (
    <div className="flex flex-col gap-3.5 relative">

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
              Антибот
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">
              Поиск и массовое удаление подозрительных регистраций
            </p>
          </div>
        </div>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </motion.div>
      )}

      {purgeMsg && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500 flex items-center gap-2"
        >
          <Check className="h-4 w-4 shrink-0" />
          {purgeMsg}
        </motion.div>
      )}

      {/* Пресеты */}
      <Card className="bg-card border-border rounded-2xl p-4">
        <div className="flex items-center gap-3 mb-4">
          <Bot className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-bold tracking-tight">Быстрые сценарии</h3>
            <p className="text-xs text-muted-foreground">Часто-используемые комбинации фильтров</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <PresetButton active={preset === "all_test"} onClick={() => applyPreset("all_test")} label="Все тестовые домены" hint="example.com, mailinator, test_*" />
          <PresetButton active={preset === "recent_hour"} onClick={() => applyPreset("recent_hour")} label="Накрутки за час" hint="за последние 60 мин" />
          <PresetButton active={preset === "ip_storm"} onClick={() => applyPreset("ip_storm")} label="Шторм с одного IP" hint="≥ 5 регистраций / IP / 24ч" />
          <PresetButton active={preset === "custom"} onClick={() => setPreset("custom")} label="Свой набор" hint="редактировать ниже" />
        </div>
      </Card>

      {/* Фильтры */}
      <Card className="bg-card border-border rounded-2xl p-4">
        <div className="flex items-center gap-3 mb-4">
          <Search className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-bold tracking-tight">Фильтры</h3>
            <p className="text-xs text-muted-foreground">
              Все условия складываются по AND. Пустые поля не учитываются.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <FilterCheckbox
            label="Встроенный список disposable-доменов"
            hint="example.com, mailinator, tempmail и др."
            checked={!!filters.emailDomainBuiltinList}
            onChange={(v) => setFilters((f) => ({ ...f, emailDomainBuiltinList: v }))}
          />
          <FilterCheckbox
            label="Подозрительные паттерны"
            hint="test_*, bot_*, последовательности цифр"
            checked={!!filters.emailPatternBuiltin}
            onChange={(v) => setFilters((f) => ({ ...f, emailPatternBuiltin: v }))}
          />
          <FilterCheckbox
            label="Никогда не подключался"
            hint="нет remnawave_uuid и trial_used = false"
            checked={!!filters.neverConnected}
            onChange={(v) => setFilters((f) => ({ ...f, neverConnected: v }))}
          />
          <FilterCheckbox
            label="Без платежей"
            hint="ни одного payment в истории"
            checked={!!filters.hasNoPayments}
            onChange={(v) => setFilters((f) => ({ ...f, hasNoPayments: v }))}
          />
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              Точный домен
            </label>
            <Input
              placeholder="например: example.com"
              value={filters.emailDomain ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, emailDomain: e.target.value || undefined }))}
              className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              Точный IP
            </label>
            <Input
              placeholder="203.0.113.5"
              value={filters.registrationIp ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, registrationIp: e.target.value || undefined }))}
              className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              За последние, минут
            </label>
            <Input
              type="number"
              placeholder="60 = час, 1440 = сутки"
              value={filters.createdSinceMinutes ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  createdSinceMinutes: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
              className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Минимум регистраций / IP
            </label>
            <Input
              type="number"
              placeholder="например: 5"
              value={filters.sameIpThreshold ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  sameIpThreshold: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
              className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5">Источник регистрации</label>
            <select
              value={filters.registrationSource ?? ""}
              onChange={(e) =>
                setFilters((f) => ({ ...f, registrationSource: e.target.value || undefined }))
              }
              className="w-full h-10 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border border-border px-3 text-sm"
            >
              <option value="">Любой</option>
              <option value="web">Веб</option>
              <option value="telegram">Telegram</option>
              <option value="google">Google</option>
              <option value="apple">Apple</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs text-muted-foreground">
            Лимит результата:{" "}
            <input
              type="number"
              min={1}
              max={2000}
              value={filters.limit ?? 500}
              onChange={(e) => setFilters((f) => ({ ...f, limit: Number(e.target.value) || 500 }))}
              className="ml-1 inline-block w-20 h-7 rounded-md bg-foreground/[0.03] dark:bg-white/[0.02] border border-border px-2 text-sm"
            />
          </div>
          <Button onClick={find} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Найти
          </Button>
        </div>
      </Card>

      {/* Результаты */}
      {result && (
        <>
          {result.ipGroups.length > 0 && (
            <Card className="bg-card border-border rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <Globe className="h-5 w-5 text-amber-500" />
                <h3 className="text-sm font-bold tracking-tight">IP с массовыми регистрациями</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.ipGroups.map((g) => (
                  <button
                    key={g.ip}
                    onClick={() => setFilters((f) => ({ ...f, registrationIp: g.ip, sameIpThreshold: undefined }))}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs hover:bg-amber-500/20 transition"
                  >
                    <span className="font-mono">{g.ip}</span>
                    <span className="rounded-full bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold">
                      {g.count}
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          <Card className="bg-card border-border rounded-2xl p-4">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-primary" />
                <div>
                  <h3 className="text-sm font-bold tracking-tight">
                    Найдено: {result.total}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {selected.size > 0 ? `Выбрано: ${selected.size}` : "Выберите ключи для удаления"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="rounded-xl" onClick={toggleAll}>
                  {allSelected ? <X className="h-3.5 w-3.5 mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
                  {allSelected ? "Снять всё" : "Выбрать всё"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-red-500/30 text-red-500 hover:bg-red-500/10"
                  disabled={selected.size === 0 || purging}
                  onClick={() => purge(false)}
                >
                  {purging ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                  Удалить ({selected.size})
                </Button>
              </div>
            </div>

            {result.candidates.length === 0 ? (
              <div className="py-12 flex flex-col items-center text-center text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mb-3 text-emerald-500" />
                <p>Ничего подозрительного не найдено</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-[600px] overflow-y-auto">
                {result.candidates.map((c) => (
                  <CandidateRow
                    key={c.id}
                    c={c}
                    selected={selected.has(c.id)}
                    onToggle={() => toggle(c.id)}
                  />
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function PresetButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border px-4 py-3 text-left transition-all",
        active
          ? "bg-primary/15 border-border text-primary"
          : "bg-foreground/[0.03] dark:bg-white/[0.02] border-border hover:border-border"
      )}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>
    </button>
  );
}

function FilterCheckbox({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "rounded-xl border px-3 py-2.5 cursor-pointer transition-all flex items-start gap-2",
        checked
          ? "bg-primary/10 border-border"
          : "bg-foreground/[0.03] dark:bg-white/[0.02] border-border hover:border-border"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-primary"
      />
      <div>
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>
      </div>
    </label>
  );
}

function CandidateRow({
  c,
  selected,
  onToggle,
}: {
  c: AntibotCandidate;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition",
        selected
          ? "bg-red-500/[0.07] border-red-500/30"
          : "bg-foreground/[0.02] dark:bg-white/[0.02] border-border hover:border-border"
      )}
    >
      <input type="checkbox" checked={selected} onChange={onToggle} className="accent-red-500" />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs truncate">
          {c.email || c.telegramUsername || c.telegramId || c.id}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
          {c.registrationIp && (
            <span className="font-mono">
              <Globe className="inline h-2.5 w-2.5 mr-0.5" />
              {c.registrationIp}
            </span>
          )}
          {c.registrationSource && <span>· {c.registrationSource}</span>}
          <span>· {fmtMsk(c.createdAt)}</span>
          {c.balance > 0 && (
            <span className="text-amber-500">· баланс {c.balance}</span>
          )}
          {c.remnawaveUuid && <span className="text-amber-500">· активен в remna</span>}
        </div>
      </div>
    </label>
  );
}
