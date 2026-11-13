import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import type { AdminSettings } from "@/lib/api";


export function ReferralsTab({
  settings,
  setSettings,
  saving,
  message,
}: {
  settings: AdminSettings;
  setSettings: Dispatch<SetStateAction<AdminSettings | null>>;
  saving: boolean;
  message: string;
}) {
  const { t } = useTranslation();

  return (
          <TabsContent value="referral">
            <Card className="overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border">
                <div className="absolute inset-0 bg-transparent pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      {t("admin.settings.referral_title")}
                    </h2>
                    <p className="text-[12.5px] text-muted-foreground mt-1">{(settings.referralRewardMode ?? "percent") === "percent" ? t("admin.settings.referral_subtitle") : "Выберите награду за первую успешную оплату приглашённого друга."}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-5 p-4 sm:p-4">
                <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="referral-reward-mode">Награда за реферала</Label>
                    <select id="referral-reward-mode" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={settings.referralRewardMode ?? "percent"} onChange={e => setSettings(s => s ? { ...s, referralRewardMode: e.target.value as "percent" | "balance" | "days" } : s)}>
                      <option value="percent">Процент от оплат</option>
                      <option value="balance">Фиксированная сумма на баланс</option>
                      <option value="days">Дни подписки</option>
                    </select>
                  </div>
                  {(settings.referralRewardMode ?? "percent") !== "percent" && <p className="text-xs text-muted-foreground">Разовый бонус за первую успешную оплату прямого реферала. Повторные оплаты бонус не дают. Проценты 2-го и 3-го уровней в этом режиме не начисляются.</p>}
                  {settings.referralRewardMode === "balance" && <div className="space-y-2">
                    <Label htmlFor="referral-reward-amount">Сумма бонуса ({settings.defaultCurrency?.toUpperCase()})</Label>
                    <Input id="referral-reward-amount" type="number" min={0.01} max={1000000} step={0.01} value={settings.referralRewardAmount ?? 50} onChange={e => setSettings(s => s ? { ...s, referralRewardAmount: Number(e.target.value) } : s)} />
                  </div>}
                  {settings.referralRewardMode === "days" && <div className="space-y-2">
                    <Label htmlFor="referral-reward-days">Дней за одного реферала</Label>
                    <Input id="referral-reward-days" type="number" min={1} max={365} step={1} value={settings.referralRewardDays ?? 3} onChange={e => setSettings(s => s ? { ...s, referralRewardDays: Number(e.target.value) } : s)} />
                    <p className="text-xs text-muted-foreground">Дни добавляются к основной подписке. Если подписки ещё нет, бонус сохранится и применится после её появления.</p>
                  </div>}
                </div>
                {(settings.referralRewardMode ?? "percent") === "percent" && <>
                <div className="rounded-xl border border-violet-500/20 bg-muted p-4 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold">3-уровневая реферальная сеть</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Процент с каждого пополнения, который начисляется на баланс реферера. Уровень 1 — прямой реф; уровень 2 — реф вашего рефа; уровень 3 — реф второго уровня.</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-violet-500/30 bg-card/40 p-4 space-y-2 relative overflow-hidden">
                      <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-muted blur-xl" />
                      <div className="relative flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-violet-500/15 text-violet-500 text-xs font-bold">L1</span>
                        <Label className="text-sm font-medium">{t("admin.settings.referral_level_1")}</Label>
                      </div>
                      <div className="relative flex items-baseline gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="text-[13.5px] font-bold tabular-nums h-14"
                          value={settings.defaultReferralPercent ?? 30}
                          onChange={(e) => setSettings((s) => (s ? { ...s, defaultReferralPercent: Number(e.target.value) || 0 } : s))}
                        />
                        <span className="text-[13.5px] font-bold text-violet-500">%</span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-purple-500/30 bg-card/40 p-4 space-y-2 relative overflow-hidden">
                      <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-muted blur-xl" />
                      <div className="relative flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-purple-500/15 text-purple-500 text-xs font-bold">L2</span>
                        <Label className="text-sm font-medium">{t("admin.settings.referral_level_2")}</Label>
                      </div>
                      <div className="relative flex items-baseline gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="text-[13.5px] font-bold tabular-nums h-14"
                          value={settings.referralPercentLevel2 ?? 10}
                          onChange={(e) => setSettings((s) => (s ? { ...s, referralPercentLevel2: Number(e.target.value) || 0 } : s))}
                        />
                        <span className="text-[13.5px] font-bold text-purple-500">%</span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-fuchsia-500/30 bg-card/40 p-4 space-y-2 relative overflow-hidden">
                      <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-muted blur-xl" />
                      <div className="relative flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-fuchsia-500/15 text-fuchsia-500 text-xs font-bold">L3</span>
                        <Label className="text-sm font-medium">{t("admin.settings.referral_level_3")}</Label>
                      </div>
                      <div className="relative flex items-baseline gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="text-[13.5px] font-bold tabular-nums h-14"
                          value={settings.referralPercentLevel3 ?? 10}
                          onChange={(e) => setSettings((s) => (s ? { ...s, referralPercentLevel3: Number(e.target.value) || 0 } : s))}
                        />
                        <span className="text-[13.5px] font-bold text-fuchsia-500">%</span>
                      </div>
                    </div>
                  </div>
                </div>

                </>}

                {/* заявки на вывод реф. баланса: вкл/выкл + мин. сумма.
                    Выключение прячет кнопку в боте и блок в кабинете/на сайте. */}
                <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <Label className="text-base font-semibold"> Заявки на вывод</Label>
                      <p className="text-sm text-muted-foreground">
                        Вывод реферального баланса (СБП, банковская карта или USDT TRC20). Выключено — кнопка в боте и блок
                        в кабинете/на сайте скрываются, API отклоняет новые заявки.
                      </p>
                    </div>
                    <Switch
                      checked={settings.withdrawalsEnabled ?? true}
                      onCheckedChange={(v) => setSettings((s) => (s ? { ...s, withdrawalsEnabled: v } : s))}
                    />
                  </div>
                  {(settings.withdrawalsEnabled ?? true) && (
                    <>
                      <div className="grid gap-1.5 max-w-xs">
                        <Label className="text-xs text-muted-foreground">Минимальная сумма заявки (₽)</Label>
                        <Input
                          type="number"
                          min={1}
                          className="h-9 rounded-xl tabular-nums"
                          value={settings.withdrawalMinAmount ?? 3000}
                          onChange={(e) => setSettings((s) => (s ? { ...s, withdrawalMinAmount: Math.max(1, Number(e.target.value) || 1) } : s))}
                        />
                      </div>
                      <div className="space-y-3 border-t border-border pt-4">
                        <Label className="text-xs text-muted-foreground">Доступные способы вывода</Label>
                        {([
                          ["withdrawalMethodsSbp", "СБП (по номеру телефона)"],
                          ["withdrawalMethodsCard", "Банковская карта"],
                          ["withdrawalMethodsUsdt", "USDT TRC20"],
                        ] as const).map(([key, label]) => (
                          <div key={key} className="flex items-center justify-between gap-4">
                            <span className="text-sm">{label}</span>
                            <Switch
                              checked={settings[key] ?? true}
                              onCheckedChange={(v) => setSettings((s) => (s ? { ...s, [key]: v } : s))}
                            />
                          </div>
                        ))}
                        {!(settings.withdrawalMethodsSbp ?? true) && !(settings.withdrawalMethodsCard ?? true) && !(settings.withdrawalMethodsUsdt ?? true) && (
                          <p className="text-xs text-amber-500">Все способы выключены — заявки на вывод будут недоступны.</p>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving} className="w-full sm:w-auto h-9 px-6 rounded-xl bg-primary hover:opacity-90 text-white font-semibold shadow-violet-500/20">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
  );
}
