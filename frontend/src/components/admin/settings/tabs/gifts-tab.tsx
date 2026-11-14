import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Gift, Settings2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import type { AdminSettings } from "@/lib/api";


export function GiftsTab({
  settings,
  setSettings,
  saving,
  message,
  handleSubmit,
}: {
  settings: AdminSettings;
  setSettings: Dispatch<SetStateAction<AdminSettings | null>>;
  saving: boolean;
  message: string;
  handleSubmit: (e: FormEvent) => void;
}) {
  const { t } = useTranslation();

  return (
        <TabsContent value="gifts">
          <Card className="overflow-hidden border-border">
            <div className="relative bg-muted p-4 border-b border-border">
              <div className="absolute inset-0 bg-transparent pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    Подарки и доп. подписки
                  </h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1">Настройки системы подарков, кодов и дополнительных подписок</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-4">
              <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <Switch
                  id="multi-subscriptions-enabled"
                  checked={settings.multiSubscriptionsEnabled ?? false}
                  onCheckedChange={(checked: boolean) =>
                    setSettings((s) => (s ? { ...s, multiSubscriptionsEnabled: checked === true } : s))
                  }
                />
                <div>
                  <Label htmlFor="multi-subscriptions-enabled" className="text-base font-medium cursor-pointer">
                    Мульти-подписки
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Вкл: у клиента может быть несколько подписок одновременно. Выкл (по умолчанию): одна подписка — при покупке другого тарифа старая заменяется новой (остаток дней сгорает, VPN-ссылка сохраняется), клиенту показывается предупреждение.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="gift-subscriptions-enabled"
                  checked={!!settings.giftSubscriptionsEnabled}
                  onCheckedChange={(checked: boolean) =>
                    setSettings((s) => (s ? { ...s, giftSubscriptionsEnabled: checked === true } : s))
                  }
                />
                <div>
                  <Label htmlFor="gift-subscriptions-enabled" className="text-base font-medium cursor-pointer">
                    Включить систему подарков
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Разрешить клиентам покупать дополнительные подписки и дарить их другим пользователям
                  </p>
                </div>
              </div>

              {settings.giftSubscriptionsEnabled && (
                <div className="space-y-6 pl-4 border-l-2 border-border">
                  <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Gift className="h-4 w-4 text-primary shrink-0" />
                      <Label className="text-base font-medium">Основные настройки</Label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="gift-code-expiry-hours">Срок действия кода (часы)</Label>
                        <Input
                          id="gift-code-expiry-hours"
                          type="number"
                          min={1}
                          value={settings.giftCodeExpiryHours ?? 72}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, giftCodeExpiryHours: parseInt(e.target.value, 10) || 72 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Через сколько часов истекает неиспользованный подарочный код
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="max-additional-subscriptions">Макс. доп. подписок</Label>
                        <Input
                          id="max-additional-subscriptions"
                          type="number"
                          min={1}
                          value={settings.maxAdditionalSubscriptions ?? 5}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, maxAdditionalSubscriptions: parseInt(e.target.value, 10) || 5 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Максимальное количество дополнительных подписок на одного клиента
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Settings2 className="h-4 w-4 text-primary shrink-0" />
                      <Label className="text-base font-medium">Коды и лимиты</Label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="gift-code-format-length">Длина кода</Label>
                        <Input
                          id="gift-code-format-length"
                          type="number"
                          min={6}
                          max={24}
                          value={settings.giftCodeFormatLength ?? 12}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, giftCodeFormatLength: parseInt(e.target.value, 10) || 12 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Количество символов в подарочном коде (формат XXXX-XXXX-XXXX)
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="gift-rate-limit">Лимит попыток/мин</Label>
                        <Input
                          id="gift-rate-limit"
                          type="number"
                          min={1}
                          max={60}
                          value={settings.giftRateLimitPerMinute ?? 5}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, giftRateLimitPerMinute: parseInt(e.target.value, 10) || 5 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Максимум попыток активации подарочного кода в минуту (защита от перебора)
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="gift-message-max-length">Макс. длина сообщения</Label>
                        <Input
                          id="gift-message-max-length"
                          type="number"
                          min={0}
                          max={1000}
                          value={settings.giftMessageMaxLength ?? 200}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, giftMessageMaxLength: parseInt(e.target.value, 10) || 200 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Максимальная длина персонального сообщения к подарку
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="h-4 w-4 text-primary shrink-0" />
                      <Label className="text-base font-medium">Уведомления и рефералы</Label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="gift-expiry-notification-days">Уведомление за (дни)</Label>
                        <Input
                          id="gift-expiry-notification-days"
                          type="number"
                          min={0}
                          max={30}
                          value={settings.giftExpiryNotificationDays ?? 3}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, giftExpiryNotificationDays: parseInt(e.target.value, 10) || 3 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          За сколько дней до истечения подарочной подписки уведомлять пользователя
                        </p>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                        <Switch
                          id="gift-referral-enabled"
                          checked={settings.giftReferralEnabled !== false}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, giftReferralEnabled: checked === true } : s))
                          }
                        />
                        <div>
                          <Label htmlFor="gift-referral-enabled" className="text-sm font-medium cursor-pointer">
                            Реферальная связь через подарки
                          </Label>
                          <p className="text-xs text-muted-foreground mt-1">
                            При активации подарка новым пользователем, отправитель становится его рефералом
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {message && <p className="text-sm text-muted-foreground">{message}</p>}
              <Button
                type="button"
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault();
                  handleSubmit(e as unknown as React.FormEvent);
                }}
              >
                {saving ? t("admin.settings.saving") : t("admin.settings.save")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
  );
}
