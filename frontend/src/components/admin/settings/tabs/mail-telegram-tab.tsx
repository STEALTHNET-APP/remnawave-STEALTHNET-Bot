import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Link2, Shield } from "lucide-react";
import { MailTest } from "@/components/admin/mail-test";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import type { Admin, AdminSettings } from "@/lib/api";


export function MailTelegramTab({
  settings,
  setSettings,
  saving,
  message,
  token,
  admin,
}: {
  settings: AdminSettings;
  setSettings: Dispatch<SetStateAction<AdminSettings | null>>;
  saving: boolean;
  message: string;
  token: string;
  admin: Admin | null;
}) {
  const { t } = useTranslation();

  return (
          <TabsContent value="mail-telegram">
            <Card className="overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border">
                <div className="absolute inset-0 bg-transparent pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      {t("admin.settings.smtp_title")}
                    </h2>
                    <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.smtp_subtitle")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-5 p-4 sm:p-4">

                {/*  Happ Crypto Link  */}
                <div className="rounded-xl border border-violet-500/20 bg-muted p-4 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-violet-500/20 flex items-center justify-center">
                      <Link2 className="h-4 w-4" aria-hidden="true"/>
                    </div>
                    <h3 className="text-base font-semibold">Happ Crypto Link</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Шифрует ссылки подписки в формат <code className="text-xs">happ://crypt4/...</code> через
                    встроенный API Remnawave. <b>Скрывает оригинальный URL подписки</b> от пользователя.
                    Минус: зашифрованная ссылка длиннее (~1500 символов) — в Telegram-сообщениях выглядит
                    как простыня. Рекомендуется только если у вас публичная панель и важно скрыть домен подписки.
                  </p>
                  <label className="flex items-center gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.happCryptEnabled === true}
                      onChange={(e) => setSettings((s) => (s ? { ...s, happCryptEnabled: e.target.checked } : s))}
                      className="rounded border w-4 h-4"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium">Шифровать ссылки подписки (Happ Crypto)</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Выкл по умолчанию. После изменения нажмите «Сохранить» и подождите 60 сек (кэш бэкенда).
                      </p>
                    </div>
                  </label>
                </div>

                {/*  Антибот-защита регистраций  */}
                <div className="rounded-xl border border-red-500/20 bg-muted p-4 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-red-500/20 flex items-center justify-center">
                      <Shield className="h-4 w-4" aria-hidden="true"/>
                    </div>
                    <h3 className="text-base font-semibold">Антибот-защита регистраций</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Блокирует регистрации с одноразовых email-доменов (example.com, mailinator и др.),
                    подозрительных паттернов (test_xxxxxxxx@) и массовых регистраций с одного IP.
                    Просмотр и удаление уже накопленных ботов — на странице{" "}
                    <a href="/admin/antibot" className="text-primary underline hover:no-underline">Антибот</a>.
                  </p>
                  <label className="flex items-center gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.signupProtectionEnabled !== false}
                      onChange={(e) => setSettings((s) => (s ? { ...s, signupProtectionEnabled: e.target.checked } : s))}
                      className="rounded border w-4 h-4"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium">Включить защиту</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Master switch. Если выключить — никакие фильтры ниже не сработают.
                      </p>
                    </div>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Лимит регистраций с одного IP в час</Label>
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        value={settings.signupMaxPerIpPerHour ?? 3}
                        onChange={(e) =>
                          setSettings((s) =>
                            s ? { ...s, signupMaxPerIpPerHour: Math.max(1, parseInt(e.target.value, 10) || 3) } : s
                          )
                        }
                      />
                      <p className="text-[11px] text-muted-foreground">
                        По умолчанию 3. Семья с одним IP не пострадает, ботнет — отсечётся.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Дополнительный список заблокированных доменов</Label>
                    <textarea
                      rows={3}
                      value={settings.emailDomainBlocklist ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, emailDomainBlocklist: e.target.value } : s))}
                      placeholder="badmail.ru, fake-domain.com"
                      className="w-full rounded-xl border border-border bg-card/40 px-3 py-2 text-sm font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Через запятую или с новой строки. Расширяет встроенный список (example.com, mailinator,
                      tempmail и др.).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Regex-паттерны для блокировки email</Label>
                    <textarea
                      rows={3}
                      value={settings.emailPatternBlocklist ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, emailPatternBlocklist: e.target.value } : s))}
                      placeholder={"^junk\\d+@\n^fake_"}
                      className="w-full rounded-xl border border-border bg-card/40 px-3 py-2 text-sm font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      По одному regex на строку (без флагов, регистр игнорируется). Встроенные:{" "}
                      <code className="text-xs">test_xxxxxxxx@</code>, <code className="text-xs">bot_NNN@</code>,
                      последовательности цифр.
                    </p>
                  </div>
                </div>

                {/*  Провайдер отправки писем (SMTP / Resend)  */}
                <div className="rounded-xl border border-emerald-500/20 bg-muted p-4 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold">Провайдер отправки писем</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Чем отправлять письма регистрации, подтверждения почты и восстановления пароля: классический SMTP-сервер или Resend API (проще — только API-ключ и верифицированный домен).</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setSettings((s) => (s ? { ...s, mailProvider: "smtp" } : s))}
                      className={`rounded-xl border p-3 text-sm font-medium transition ${(settings.mailProvider ?? "smtp") !== "resend" ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-border bg-card/40 text-muted-foreground hover:border-border"}`}>
                      SMTP-сервер
                    </button>
                    <button type="button" onClick={() => setSettings((s) => (s ? { ...s, mailProvider: "resend" } : s))}
                      className={`rounded-xl border p-3 text-sm font-medium transition ${settings.mailProvider === "resend" ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-border bg-card/40 text-muted-foreground hover:border-border"}`}>
                      Resend API
                    </button>
                  </div>
                  {settings.mailProvider === "resend" && (
                    <div className="space-y-4 pt-1">
                      <div className="space-y-2">
                        <Label>Resend API-ключ</Label>
                        <Input type="password" value={settings.resendApiKey ?? ""} onChange={(e) => setSettings((s) => (s ? { ...s, resendApiKey: e.target.value || null } : s))} placeholder="re_..." />
                        <p className="text-[11px] text-muted-foreground">Панель Resend  API Keys. Домен отправителя должен быть верифицирован в Resend.</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Resend: адрес отправителя (From)</Label>
                        <Input type="email" value={settings.resendFromEmail ?? ""} onChange={(e) => setSettings((s) => (s ? { ...s, resendFromEmail: e.target.value || null } : s))} placeholder="noreply@yourdomain.com" />
                        <p className="text-[11px] text-muted-foreground">На верифицированном в Resend домене. Имя отправителя — из поля «Имя отправителя» ниже. Если пусто — берётся SMTP From-email.</p>
                      </div>
                    </div>
                  )}
                  <label className="flex items-center gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                    <input type="checkbox" checked={settings.passwordResetEnabled ?? false} onChange={(e) => setSettings((s) => (s ? { ...s, passwordResetEnabled: e.target.checked } : s))} className="rounded border w-4 h-4" />
                    <div className="flex-1">
                      <span className="text-sm font-medium">Восстановление пароля по email</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Показывает ссылку «Забыли пароль?» на входе в кабинет и включает отправку письма для сброса. Нужен настроенный провайдер почты выше.</p>
                    </div>
                  </label>
                </div>

                <div className="rounded-xl border border-cyan-500/20 bg-muted p-4 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold">SMTP-сервер</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Параметры почтового сервера для отправки email с письмами регистрации, восстановления пароля и системных уведомлений.</p>
                <label className="flex items-center gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                  <input
                    type="checkbox"
                    id="skipEmailVerification"
                    checked={settings.skipEmailVerification ?? false}
                    onChange={(e) => setSettings((s) => (s ? { ...s, skipEmailVerification: e.target.checked } : s))}
                    className="rounded border w-4 h-4"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{t("admin.settings.skip_email")}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t("admin.settings.smtp_no_confirm_hint")}</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                  <input
                    type="checkbox"
                    id="onboardingEmailRequired"
                    checked={settings.onboardingEmailRequired ?? false}
                    onChange={(e) => setSettings((s) => (s ? { ...s, onboardingEmailRequired: e.target.checked } : s))}
                    className="rounded border w-4 h-4"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">Обязательная привязка email при онбординге</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Если выключено — в мини-аппе на шаге «Привяжите email» появляется кнопка «Пропустить». Если включено — email обязателен.</p>
                  </div>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_host")}</Label>
                    <Input
                      value={settings.smtpHost ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpHost: e.target.value || null } : s))}
                      placeholder="smtp.example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_port")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={65535}
                      value={settings.smtpPort ?? 587}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpPort: parseInt(e.target.value, 10) || 587 } : s))}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="smtpSecure"
                    checked={settings.smtpSecure ?? false}
                    onChange={(e) => setSettings((s) => (s ? { ...s, smtpSecure: e.target.checked } : s))}
                    className="rounded border"
                  />
                  <Label htmlFor="smtpSecure">SSL/TLS (secure)</Label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_user")}</Label>
                    <Input
                      value={settings.smtpUser ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpUser: e.target.value || null } : s))}
                      placeholder="user@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_password")}</Label>
                    <Input
                      type="password"
                      value={settings.smtpPassword ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpPassword: e.target.value || null } : s))}
                      placeholder="********"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_from_email")}</Label>
                    <Input
                      type="email"
                      value={settings.smtpFromEmail ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpFromEmail: e.target.value || null } : s))}
                      placeholder="noreply@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_from_name")}</Label>
                    <Input
                      value={settings.smtpFromName ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpFromName: e.target.value || null } : s))}
                      placeholder={t("admin.settings.smtp_service_name_placeholder")}
                    />
                  </div>
                </div>
                </div>
                {admin?.role === "ADMIN" && <MailTest token={token} initialEmail={admin.email} />}
              </CardContent>
            </Card>
            <Card className="mt-6 overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border">
                <div className="absolute inset-0 bg-transparent pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      {t("admin.settings.telegram_title")}
                    </h2>
                    <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.telegram_bot_hint")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-4 p-4 sm:p-4">
                <div className="space-y-2">
                  <Label>{t("admin.settings.telegram_bot_token")}</Label>
                  <Input
                    type="password"
                    value={settings.telegramBotToken ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, telegramBotToken: e.target.value || null } : s))}
                    placeholder="123456:ABC-DEF..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.telegram_bot_username")}</Label>
                  <Input
                    value={settings.telegramBotUsername ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, telegramBotUsername: e.target.value || null } : s))}
                    placeholder="MyStealthNetBot"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.telegram_admins")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.telegram_admins_hint")}
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    {(settings.botAdminTelegramIds ?? []).map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm">
                        {id}
                        <button
                          type="button"
                          onClick={() => setSettings((s) => (s ? { ...s, botAdminTelegramIds: (s.botAdminTelegramIds ?? []).filter((x) => x !== id) } : s))}
                          className="text-muted-foreground hover:text-destructive"
                          title={t("admin.settings.telegram_delete")}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        placeholder="123456789"
                        className="w-36"
                        id="newBotAdminId"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const input = document.getElementById("newBotAdminId") as HTMLInputElement;
                            const v = input?.value?.trim();
                            if (v && /^\d+$/.test(v)) {
                              setSettings((s) => (s ? { ...s, botAdminTelegramIds: [...(s.botAdminTelegramIds ?? []), v] } : s));
                              input.value = "";
                            }
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const input = document.getElementById("newBotAdminId") as HTMLInputElement;
                          const v = input?.value?.trim();
                          if (v && /^\d+$/.test(v)) {
                            setSettings((s) => (s ? { ...s, botAdminTelegramIds: [...(s.botAdminTelegramIds ?? []), v] } : s));
                            input.value = "";
                          }
                        }}
                      >
                        {t("admin.settings.add_id")}
                      </Button>
                    </div>
                  </div>
                </div>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving}>
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
  );
}
