import { useEffect, useState } from "react";
import { Sparkles, Clock, Save, History, Loader2, Plus, Trash2, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { RouletteWheel, type WheelSector } from "./roulette-wheel";

export type RouletteRewardType = "days" | "balance" | "traffic" | "discount" | "empty";

export interface SectorItem {
  id: string;
  type: RouletteRewardType;
  value: number;
  label: string;
  weight: number;
  color: string;
  icon?: string;
}

const REWARD_TYPES: { value: RouletteRewardType; label: string; unit: string; icon: string }[] = [
  { value: "days", label: "📅 Дни подписки", unit: "дн.", icon: "calendar" },
  { value: "balance", label: "💰 Баланс (₽)", unit: "₽", icon: "wallet" },
  { value: "traffic", label: "🚀 Трафик (ГБ)", unit: "ГБ", icon: "wifi" },
  { value: "discount", label: "🏷️ Скидка (%)", unit: "%", icon: "tag" },
  { value: "empty", label: "💨 Пустой сектор", unit: "", icon: "frown" },
];

const DEFAULT_SECTORS: SectorItem[] = [
  { id: "s1", type: "days", value: 1, label: "+1 день подписки", weight: 20, color: "#4f46e5", icon: "calendar" },
  { id: "s2", type: "balance", value: 10, label: "10 ₽ на баланс", weight: 25, color: "#10b981", icon: "wallet" },
  { id: "s3", type: "empty", value: 0, label: "Попробуй завтра 🍀", weight: 35, color: "#64748b", icon: "frown" },
  { id: "s4", type: "days", value: 2, label: "+2 дня подписки", weight: 10, color: "#8b5cf6", icon: "calendar" },
  { id: "s5", type: "balance", value: 25, label: "25 ₽ на баланс", weight: 8, color: "#06b6d4", icon: "wallet" },
  { id: "s6", type: "traffic", value: 5, label: "+5 ГБ трафика", weight: 15, color: "#f59e0b", icon: "wifi" },
  { id: "s7", type: "discount", value: 10, label: "Скидка 10%", weight: 12, color: "#ec4899", icon: "tag" },
  { id: "s8", type: "balance", value: 50, label: "50 ₽ на баланс", weight: 5, color: "#e11d48", icon: "sparkles" },
];

const PALETTE = [
  "#4f46e5", "#0ea5e9", "#10b981", "#f59e0b",
  "#ec4899", "#8b5cf6", "#06b6d4", "#e11d48",
  "#14b8a6", "#f97316", "#a855f7", "#3b82f6",
];

function generateDefaultLabel(type: RouletteRewardType, value: number): string {
  if (type === "empty") return "Попробуй завтра 🍀";
  if (type === "days") {
    const d = Math.round(value);
    return d === 1 ? "+1 день подписки" : d >= 2 && d <= 4 ? `+${d} дня подписки` : `+${d} дней подписки`;
  }
  if (type === "balance") return `${Math.round(value)} ₽ на баланс`;
  if (type === "traffic") return `+${Math.round(value)} ГБ трафика`;
  if (type === "discount") return `Скидка ${Math.round(value)}%`;
  return `Сектор`;
}

export function RouletteAdminTab() {
  const { state } = useAuth();
  const token = state.accessToken;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [cooldownHours, setCooldownHours] = useState(24);
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [totalSpins, setTotalSpins] = useState(0);
  const [spinsByType, setSpinsByType] = useState<any[]>([]);
  const [recentSpins, setRecentSpins] = useState<any[]>([]);

  const loadData = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await api.getAdminRoulette(token);
      if (res) {
        setEnabled(res.settings?.enabled ?? true);
        setCooldownHours(res.settings?.cooldownHours ?? 24);
        setSectors(res.settings?.sectors?.length > 0 ? res.settings.sectors : DEFAULT_SECTORS);
        setTotalSpins(res.totalSpins ?? 0);
        setSpinsByType(res.spinsByType ?? []);
        setRecentSpins(res.recentSpins ?? []);
      }
    } catch (e: any) {
      toast.error("Ошибка", e?.message || "Не удалось загрузить настройки рулетки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  const handleSave = async () => {
    if (!token) return;
    if (sectors.length < 2) {
      toast.error("Мало секторов", "В колесе должно быть как минимум 2 сектора");
      return;
    }
    try {
      setSaving(true);
      await api.updateAdminRoulette(token, {
        enabled,
        cooldownHours,
        sectors,
      });
      toast.success("Сохранено", "Настройки рулетки успешно обновлены");
      loadData();
    } catch (e: any) {
      toast.error("Ошибка сохранения", e?.message || "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  };

  const handleTypeChange = (index: number, newType: RouletteRewardType) => {
    setSectors((prev) => {
      const copy = [...prev];
      const sec = { ...copy[index] };
      sec.type = newType;
      if (newType === "empty") {
        sec.value = 0;
        sec.label = "Попробуй завтра 🍀";
        sec.icon = "frown";
      } else {
        if (sec.value <= 0) {
          sec.value = newType === "days" ? 1 : newType === "balance" ? 25 : newType === "traffic" ? 5 : 10;
        }
        sec.label = generateDefaultLabel(newType, sec.value);
        sec.icon = newType === "days" ? "calendar" : newType === "balance" ? "wallet" : newType === "traffic" ? "wifi" : "tag";
      }
      copy[index] = sec;
      return copy;
    });
  };

  const handleValueChange = (index: number, newVal: number) => {
    setSectors((prev) => {
      const copy = [...prev];
      const sec = { ...copy[index] };
      const val = Math.max(0, newVal);
      sec.value = val;
      // Если название было стандартным — обновим его под новое значение
      sec.label = generateDefaultLabel(sec.type, val);
      copy[index] = sec;
      return copy;
    });
  };

  const updateSectorLabel = (index: number, label: string) => {
    setSectors((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], label };
      return copy;
    });
  };

  const updateSectorWeight = (index: number, weight: number) => {
    setSectors((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], weight: Math.max(0, weight) };
      return copy;
    });
  };

  const updateSectorColor = (index: number, color: string) => {
    setSectors((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], color };
      return copy;
    });
  };

  const handleAddSector = () => {
    if (sectors.length >= 16) {
      toast.error("Лимит секторов", "Максимальное количество секторов — 16");
      return;
    }
    const newIdx = sectors.length;
    const color = PALETTE[newIdx % PALETTE.length];
    const newSector: SectorItem = {
      id: `s_${Date.now()}_${newIdx + 1}`,
      type: "balance",
      value: 15,
      label: "15 ₽ на баланс",
      weight: 10,
      color,
      icon: "wallet",
    };
    setSectors((prev) => [...prev, newSector]);
  };

  const handleDeleteSector = (index: number) => {
    if (sectors.length <= 2) {
      toast.error("Минимум 2 сектора", "В колесе должно оставаться не менее 2 секторов");
      return;
    }
    setSectors((prev) => prev.filter((_, i) => i !== index));
  };

  const handleResetDefaults = () => {
    setSectors(DEFAULT_SECTORS);
    toast.info("Сброшено к эталону", "Не забудьте нажать «Сохранить настройки» для применения на сервере");
  };

  const totalWeight = sectors.reduce((acc, s) => acc + (s.weight || 0), 0);

  if (loading) {
    return (
      <Card className="overflow-hidden border-border p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Загрузка рулетки…</span>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-border">
      <div className="relative bg-muted p-4 border-b border-border">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Рулетка удачи (Колесо фортуны)
            </h2>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              Настройка наград, типов выигрышей, кулдауна и визуального стиля колеса
            </p>
          </div>
        </div>
      </div>

      <CardContent className="space-y-6 p-4 sm:p-6">
        {/* Статистика */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-muted/40 border border-border">
            <div className="text-xs text-muted-foreground font-medium">Всего вращений</div>
            <div className="text-2xl font-black mt-1 text-foreground">{totalSpins}</div>
          </div>
          {spinsByType.map((st) => (
            <div key={st.rewardType} className="p-3.5 rounded-xl bg-muted/40 border border-border">
              <div className="text-xs text-muted-foreground font-medium capitalize">
                {st.rewardType === "days"
                  ? "Дни подписки"
                  : st.rewardType === "balance"
                  ? "Рубли (баланс)"
                  : st.rewardType === "traffic"
                  ? "ГБ трафика"
                  : st.rewardType === "discount"
                  ? "Скидки"
                  : "Пустые секторы"}
              </div>
              <div className="text-xl font-bold mt-1 text-foreground">
                {st._count?.id || 0}{" "}
                <span className="text-xs font-normal text-muted-foreground">раз</span>
              </div>
            </div>
          ))}
        </div>

        {/* Основные параметры */}
        <div className="space-y-4 rounded-xl border border-border p-4 bg-card/40">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base font-semibold cursor-pointer" htmlFor="roulette-enabled-switch">
                Включить рулетку
              </Label>
              <p className="text-xs text-muted-foreground">
                Доступность рулетки в Mini App (Aurora и Stealth) и Telegram-боте
              </p>
            </div>
            <Switch
              id="roulette-enabled-switch"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
            <div className="space-y-1.5">
              <Label htmlFor="cooldown-input">Кулдаун между вращениями (часы)</Label>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <Input
                  id="cooldown-input"
                  type="number"
                  min={1}
                  max={720}
                  value={cooldownHours}
                  onChange={(e) => setCooldownHours(parseInt(e.target.value, 10) || 24)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                По умолчанию 24 часа (одно бесплатное вращение в сутки).
              </p>
            </div>
          </div>
        </div>

        {/* Интерактивный предпросмотр и настройка секторов */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Секторы колеса и призы</h3>
              <p className="text-xs text-muted-foreground">
                Выбирайте тип приза, выпадающее значение, цвет и шанс выпадения (сумма весов: {totalWeight}).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetDefaults}
                className="gap-1.5 text-xs"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Сбросить к стандарту
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddSector}
                className="gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10"
              >
                <Plus className="w-3.5 h-3.5" /> Добавить сектор
              </Button>
            </div>
          </div>

          {/* Превью колеса */}
          <div className="p-4 rounded-2xl bg-muted/30 border border-border flex flex-col sm:flex-row items-center justify-around gap-6">
            <div className="text-center sm:text-left space-y-1 max-w-xs">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Живой предпросмотр</span>
              <h4 className="text-sm font-bold text-foreground">Так колесо выглядит у клиентов</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Секторов: {sectors.length}. Вы можете протестировать анимацию, нажав на кнопку «КРУТИТЬ» в центре колеса.
              </p>
            </div>
            <div className="shrink-0">
              <RouletteWheel
                sectors={sectors as WheelSector[]}
                canSpin={true}
                size="sm"
                variant="aurora"
              />
            </div>
          </div>

          {/* Список секторов */}
          <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
            {sectors.map((sec, idx) => {
              const pct = totalWeight > 0 ? ((sec.weight / totalWeight) * 100).toFixed(1) : "0";
              const curTypeConfig = REWARD_TYPES.find((t) => t.value === sec.type) || REWARD_TYPES[0];
              const isEmp = sec.type === "empty";

              return (
                <div
                  key={sec.id || idx}
                  className="p-3 bg-card/60 flex flex-wrap lg:flex-nowrap items-center gap-2.5 transition-colors hover:bg-muted/20"
                >
                  {/* Номер сектора и колорпикер */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-mono font-bold text-muted-foreground w-4 text-center">
                      {idx + 1}
                    </span>
                    <input
                      type="color"
                      value={sec.color}
                      onChange={(e) => updateSectorColor(idx, e.target.value)}
                      className="w-7 h-7 rounded-lg cursor-pointer border border-border bg-transparent p-0.5"
                      title="Выбрать цвет сектора"
                    />
                  </div>

                  {/* Выбор ТИПА приза */}
                  <div className="w-40 shrink-0">
                    <select
                      value={sec.type}
                      onChange={(e) => handleTypeChange(idx, e.target.value as RouletteRewardType)}
                      className="w-full h-8 text-xs font-semibold rounded-lg border border-input bg-background px-2 focus:ring-1 focus:ring-primary"
                    >
                      {REWARD_TYPES.map((rt) => (
                        <option key={rt.value} value={rt.value}>
                          {rt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Ввод ВЫПАДАЮЩЕГО ЗНАЧЕНИЯ */}
                  <div className="w-28 shrink-0">
                    {!isEmp ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          value={sec.value}
                          onChange={(e) => handleValueChange(idx, Number(e.target.value) || 0)}
                          className="h-8 text-xs font-mono font-bold w-16"
                          title="Значение награды"
                        />
                        <span className="text-xs text-muted-foreground font-semibold">
                          {curTypeConfig.unit}
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic px-2">
                        без приза
                      </div>
                    )}
                  </div>

                  {/* НАЗВАНИЕ сектора (текст на колесе) */}
                  <div className="flex-1 min-w-[150px]">
                    <Input
                      value={sec.label}
                      onChange={(e) => updateSectorLabel(idx, e.target.value)}
                      placeholder="Текст на секторе"
                      className="h-8 text-xs font-medium"
                    />
                  </div>

                  {/* ВЕС / ШАНС выпадения */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-muted-foreground">Вес:</span>
                    <Input
                      type="number"
                      min={0}
                      value={sec.weight}
                      onChange={(e) => updateSectorWeight(idx, parseInt(e.target.value, 10) || 0)}
                      className="h-8 text-xs font-mono w-14"
                      title="Вес вероятности"
                    />
                    <span className="w-14 text-right font-mono font-bold text-xs text-primary shrink-0">
                      ~{pct}%
                    </span>
                  </div>

                  {/* Удаление сектора */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteSector(idx)}
                    disabled={sectors.length <= 2}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                    title="Удалить сектор"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Кнопка сохранения */}
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Сохранить настройки рулетки
          </Button>
        </div>

        {/* Последние 10 выигрышей */}
        {recentSpins.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Последние вращения пользователей</h3>
            </div>
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted text-muted-foreground font-semibold border-b border-border">
                  <tr>
                    <th className="p-2.5">Клиент</th>
                    <th className="p-2.5">Приз</th>
                    <th className="p-2.5">Тип</th>
                    <th className="p-2.5">Дата и время</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentSpins.slice(0, 10).map((sp) => (
                    <tr key={sp.id} className="hover:bg-muted/30">
                      <td className="p-2.5 font-medium">
                        {sp.client?.telegramUsername
                          ? `@${sp.client.telegramUsername}`
                          : sp.client?.email || sp.clientId?.slice(0, 8)}
                      </td>
                      <td className="p-2.5 font-bold">{sp.rewardLabel}</td>
                      <td className="p-2.5 capitalize text-muted-foreground">{sp.rewardType}</td>
                      <td className="p-2.5 text-muted-foreground font-mono">
                        {new Date(sp.createdAt).toLocaleString("ru-RU")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
