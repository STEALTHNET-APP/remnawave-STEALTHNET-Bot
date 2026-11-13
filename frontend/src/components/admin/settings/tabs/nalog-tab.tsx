import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { api, type AdminSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";

export function NalogTab({ settings, setSettings, saving, token, setMessage, handleSubmit }: {
  settings: AdminSettings;
  setSettings: Dispatch<SetStateAction<AdminSettings | null>>;
  saving: boolean;
  token: string | null;
  setMessage: Dispatch<SetStateAction<string>>;
  handleSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  return (
<TabsContent value="nalog-settings">
          <Card className="overflow-hidden border-border">
            <div className="relative bg-muted p-4 border-b border-border">
              <div className="absolute inset-0 bg-transparent pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    {t("admin.settings.nalog_title")}
                  </h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.nalog_subtitle")} {t("admin.settings.nalog_selfemployed_hint")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-4 p-4 sm:p-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-medium">{t("admin.settings.nalog_enabled")}</Label>
                  <p className="text-sm text-muted-foreground">{t("admin.settings.nalog_enabled_hint")}</p>
                </div>
                <Switch
                  checked={settings.nalogEnabled ?? false}
                  onCheckedChange={(v) => setSettings({ ...settings, nalogEnabled: v })}
                />
              </div>

              <div>
                <Label htmlFor="nalog-inn">{t("admin.settings.nalog_inn")}</Label>
                <Input
                  id="nalog-inn"
                  placeholder="123456789012"
                  maxLength={12}
                  value={settings.nalogInn ?? ""}
                  onChange={(e) => setSettings({ ...settings, nalogInn: e.target.value || null })}
                  disabled={!settings.nalogEnabled}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.nalog_inn_hint")}</p>
              </div>

              <div>
                <Label htmlFor="nalog-password">{t("admin.settings.nalog_password")}</Label>
                <Input
                  id="nalog-password"
                  type="password"
                  placeholder="••••••••"
                  value={settings.nalogPassword ?? ""}
                  onChange={(e) => setSettings({ ...settings, nalogPassword: e.target.value || null })}
                  disabled={!settings.nalogEnabled}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.nalog_password_hint")}</p>
              </div>

              <div>
                <Label htmlFor="nalog-service-name">{t("admin.settings.nalog_service_name")}</Label>
                <Input
                  id="nalog-service-name"
                  placeholder="Оплата VPN-подписки"
                  value={settings.nalogServiceName ?? ""}
                  onChange={(e) => setSettings({ ...settings, nalogServiceName: e.target.value || null })}
                  disabled={!settings.nalogEnabled}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.nalog_service_name_hint")}</p>
              </div>

              <div>
                <Label htmlFor="nalog-device-id">{t("admin.settings.nalog_device_id")}</Label>
                <Input
                  id="nalog-device-id"
                  placeholder="stealthnet-bot-nalog"
                  value={settings.nalogDeviceId ?? ""}
                  onChange={(e) => setSettings({ ...settings, nalogDeviceId: e.target.value || null })}
                  disabled={!settings.nalogEnabled}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.nalog_device_id_hint")}</p>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!settings.nalogEnabled || !settings.nalogInn || !settings.nalogPassword}
                  onClick={async () => {
                    setMessage("");
                    try {
                      const result = await api.testNalogConnection(token!);
                      setMessage(result.ok ? t("admin.settings.nalog_test_success", { inn: result.inn }) : t("admin.settings.nalog_test_error", { error: result.error }));
                    } catch {
                      setMessage(t("admin.settings.nalog_test_failed"));
                    }
                  }}
                >
                  {t("admin.settings.nalog_test")}
                </Button>
                <Button
                  onClick={(e) => {
                    handleSubmit(e as unknown as FormEvent);
                  }}
                  disabled={saving}
                >
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </div>

              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-blue-700 dark:text-blue-200 space-y-2">
                <p><strong>{t("admin.settings.nalog_how_title")}</strong></p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>{t("admin.settings.nalog_how_1")}</li>
                  <li>{t("admin.settings.nalog_how_2")}</li>
                  <li>{t("admin.settings.nalog_how_3")}</li>
                  <li>{t("admin.settings.nalog_how_4")}</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
  );
}
