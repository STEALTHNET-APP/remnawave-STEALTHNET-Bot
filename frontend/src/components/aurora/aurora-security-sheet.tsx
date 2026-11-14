import { useTranslation } from "react-i18next";
/**
 * AuroraSecuritySheet — управление паролем и 2FA в стиле Aurora.
 *
 * Поддерживает:
 *   • Смена пароля (если пароль уже есть);
 *   • Первичная установка пароля (для пользователей, вошедших через Telegram);
 *   • Включение 2FA (TOTP): генерация секрета, показ QR-кода, ввод 6-значного кода;
 *   • Отключение 2FA по коду подтверждения;
 *   • Полная адаптация под светлую и тёмную темы Aurora.
 */

import { useState } from "react";
import {
  Lock, KeyRound, Shield, Check, Copy, Loader2, AlertCircle, CheckCircle2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AuroraSecuritySheet({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const client = state.client;
  const token = state.token;

  const hasPassword = Boolean(client?.hasPassword);
  const totpEnabled = Boolean(client?.totpEnabled);

  // Состояния смены пароля
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Состояния 2FA
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [twoFaSuccess, setTwoFaSuccess] = useState<string | null>(null);
  const [twoFaSetupData, setTwoFaSetupData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaDisabling, setTwoFaDisabling] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  function resetAll() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordLoading(false);
    setPasswordError(null);
    setPasswordSuccess(null);

    setTwoFaLoading(false);
    setTwoFaError(null);
    setTwoFaSuccess(null);
    setTwoFaSetupData(null);
    setTwoFaCode("");
    setTwoFaDisabling(false);
    setCopiedSecret(false);
    onClose();
  }

  // Сабмит формы пароля (смена или установка)
  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (hasPassword && !currentPassword.trim()) {
      setPasswordError(t("aurora.enter_current_password"));
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError(t("aurora.password_min"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("aurora.password_mismatch"));
      return;
    }

    setPasswordError(null);
    setPasswordSuccess(null);
    setPasswordLoading(true);

    try {
      if (hasPassword) {
        await api.clientChangePassword(token, {
          currentPassword,
          newPassword,
        });
        setPasswordSuccess(t("aurora.password_changed"));
      } else {
        await api.clientSetPassword(token, {
          newPassword,
        });
        setPasswordSuccess(t("aurora.password_set"));
      }

      await refreshProfile().catch(() => {});
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      setTimeout(() => {
        setPasswordSuccess(null);
      }, 3500);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : t("aurora.password_error"));
    } finally {
      setPasswordLoading(false);
    }
  }

  // Запуск процесса включения 2FA
  async function startTwoFaSetup() {
    if (!token) return;
    setTwoFaError(null);
    setTwoFaSuccess(null);
    setTwoFaLoading(true);

    try {
      const data = await api.client2FASetup(token);
      setTwoFaSetupData(data);
      setTwoFaCode("");
    } catch (err) {
      setTwoFaError(err instanceof Error ? err.message : t("aurora.setup_error"));
    } finally {
      setTwoFaLoading(false);
    }
  }

  // Подтверждение включения 2FA кодом
  async function confirmTwoFa() {
    if (!token) return;
    const cleanCode = twoFaCode.replace(/\s+/g, "");
    if (cleanCode.length !== 6) {
      setTwoFaError(t("aurora.enter_code"));
      return;
    }

    setTwoFaError(null);
    setTwoFaLoading(true);

    try {
      await api.client2FAConfirm(token, cleanCode);
      await refreshProfile().catch(() => {});
      setTwoFaSetupData(null);
      setTwoFaCode("");
      setTwoFaSuccess(t("aurora.twofa_enabled"));

      setTimeout(() => {
        setTwoFaSuccess(null);
      }, 3500);
    } catch (err) {
      setTwoFaError(err instanceof Error ? err.message : t("aurora.invalid_code"));
    } finally {
      setTwoFaLoading(false);
    }
  }

  // Отключение 2FA
  async function disableTwoFa() {
    if (!token) return;
    const cleanCode = twoFaCode.replace(/\s+/g, "");
    if (cleanCode.length !== 6) {
      setTwoFaError(t("aurora.enter_disable_code"));
      return;
    }

    setTwoFaError(null);
    setTwoFaLoading(true);

    try {
      await api.client2FADisable(token, cleanCode);
      await refreshProfile().catch(() => {});
      setTwoFaDisabling(false);
      setTwoFaCode("");
      setTwoFaSuccess(t("aurora.twofa_disabled"));

      setTimeout(() => {
        setTwoFaSuccess(null);
      }, 3500);
    } catch (err) {
      setTwoFaError(err instanceof Error ? err.message : t("aurora.invalid_code"));
    } finally {
      setTwoFaLoading(false);
    }
  }

  function copySecretToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  }

  return (
    <AuroraSheet
      open={open}
      onClose={resetAll}
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
            <Lock className="h-4 w-4" />
          </span>
          <span>{t("aurora.security")}</span>
        </div>
      }
    >
      <div className="space-y-5 pb-3">
        {/* ── Секция 1: Пароль ── */}
        <section className="space-y-3 rounded-[22px] bg-[var(--au-surface)] p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-from)]">
              <KeyRound className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-[15px] font-bold text-[var(--au-ink)]">
                {hasPassword ? t("aurora.change_password") : t("aurora.set_password")}
              </h3>
              <p className="text-[12px] text-[var(--au-muted)]">
                {hasPassword
                  ? t("aurora.change_password_hint")
                  : t("aurora.set_password_hint")}
              </p>
            </div>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-3 pt-1">
            {hasPassword && (
              <div>
                <label className="px-1 text-[12.5px] font-semibold text-[var(--au-muted)]">
                  {t("aurora.current_password")}</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="mt-1 w-full rounded-[16px] border-2 border-transparent bg-[var(--au-bg)] px-3.5 py-3 text-[16px] text-[var(--au-ink)] outline-none transition-colors placeholder:text-[var(--au-muted)] focus:border-[var(--au-from)]"
                />
              </div>
            )}

            <div>
              <label className="px-1 text-[12.5px] font-semibold text-[var(--au-muted)]">
                {hasPassword ? t("aurora.new_password") : t("aurora.create_password")}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPasswordError(null);
                }}
                placeholder={t("aurora.password_placeholder")}
                autoComplete="new-password"
                className="mt-1 w-full rounded-[16px] border-2 border-transparent bg-[var(--au-bg)] px-3.5 py-3 text-[16px] text-[var(--au-ink)] outline-none transition-colors placeholder:text-[var(--au-muted)] focus:border-[var(--au-from)]"
              />
            </div>

            <div>
              <label className="px-1 text-[12.5px] font-semibold text-[var(--au-muted)]">
                {t("aurora.repeat_new_password")}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setPasswordError(null);
                }}
                placeholder={t("aurora.repeat_password")}
                autoComplete="new-password"
                className="mt-1 w-full rounded-[16px] border-2 border-transparent bg-[var(--au-bg)] px-3.5 py-3 text-[16px] text-[var(--au-ink)] outline-none transition-colors placeholder:text-[var(--au-muted)] focus:border-[var(--au-from)]"
              />
            </div>

            {passwordError && (
              <div className="flex items-start gap-2 rounded-[14px] border border-red-500/25 bg-red-500/10 p-3 text-[13px] text-red-600 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            {passwordSuccess && (
              <div className="flex items-center gap-2 rounded-[14px] border border-emerald-500/25 bg-emerald-500/10 p-3 text-[13px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{passwordSuccess}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={passwordLoading || !newPassword || !confirmPassword || (hasPassword && !currentPassword)}
              className="flex w-full items-center justify-center gap-2 rounded-[18px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] py-3.5 text-[15px] font-bold text-white shadow-sm transition-transform enabled:active:scale-[0.99] disabled:opacity-45"
            >
              {passwordLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {passwordLoading
                ? t("aurora.saving")
                : hasPassword
                  ? t("aurora.save_password")
                  : t("aurora.set_password_button")}
            </button>
          </form>
        </section>

        {/* ── Секция 2: Двухфакторная аутентификация (2FA) ── */}
        <section className="space-y-3 rounded-[22px] bg-[var(--au-surface)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-from)]">
                <Shield className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-[15px] font-bold text-[var(--au-ink)]">
                  {t("aurora.twofa")}</h3>
                <p className="text-[12px] text-[var(--au-muted)]">
                  {t("aurora.twofa_hint")}</p>
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-wide",
                totpEnabled
                  ? "border-emerald-500/25 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "border-black/5 bg-black/5 text-[var(--au-muted)] dark:border-white/10 dark:bg-white/5",
              )}
            >
              {totpEnabled ? t("aurora.enabled") : t("aurora.disabled")}
            </span>
          </div>

          {twoFaError && (
            <div className="flex items-start gap-2 rounded-[14px] border border-red-500/25 bg-red-500/10 p-3 text-[13px] text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{twoFaError}</span>
            </div>
          )}

          {twoFaSuccess && (
            <div className="flex items-center gap-2 rounded-[14px] border border-emerald-500/25 bg-emerald-500/10 p-3 text-[13px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{twoFaSuccess}</span>
            </div>
          )}

          {/* Режим настройки нового 2FA (QR-код + ключ + подтверждение) */}
          {twoFaSetupData ? (
            <div className="space-y-3.5 rounded-[18px] bg-[var(--au-bg)] p-4">
              <p className="text-[13px] font-semibold text-[var(--au-ink)]">
                {t("aurora.scan_qr")}</p>
              <div className="flex justify-center rounded-[18px] bg-white p-3.5 shadow-sm">
                <QRCodeSVG value={twoFaSetupData.otpauthUrl} size={180} />
              </div>

              <div>
                <p className="text-[12px] text-[var(--au-muted)]">
                  {t("aurora.manual_key")}</p>
                <div className="mt-1 flex items-center justify-between gap-2 rounded-[14px] bg-[var(--au-surface)] px-3 py-2">
                  <code className="select-all font-mono text-[12px] font-bold text-[var(--au-ink)]">
                    {twoFaSetupData.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => copySecretToClipboard(twoFaSetupData.secret)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--au-bg)] text-[var(--au-muted)] transition-colors hover:text-[var(--au-ink)] active:scale-95"
                    aria-label={t("aurora.copy_key")}
                  >
                    {copiedSecret ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-[13px] font-semibold text-[var(--au-ink)]">
                  {t("aurora.confirm_code")}</p>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={twoFaCode}
                  onChange={(e) => {
                    setTwoFaCode(e.target.value);
                    setTwoFaError(null);
                  }}
                  placeholder="000 000"
                  className="mt-1.5 w-full rounded-[16px] border-2 border-transparent bg-[var(--au-surface)] px-4 py-3 text-center font-mono text-[20px] font-extrabold tracking-widest text-[var(--au-ink)] outline-none transition-colors placeholder:text-[var(--au-muted)] focus:border-[var(--au-from)]"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setTwoFaSetupData(null);
                    setTwoFaCode("");
                    setTwoFaError(null);
                  }}
                  className="flex-1 rounded-[16px] bg-[var(--au-surface)] py-3 text-[14px] font-bold text-[var(--au-muted)] transition-transform active:scale-95"
                >
                  {t("aurora.cancel")}</button>
                <button
                  type="button"
                  onClick={confirmTwoFa}
                  disabled={twoFaLoading || twoFaCode.length < 6}
                  className="flex-1 rounded-[16px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] py-3 text-[14px] font-bold text-white shadow-sm transition-transform enabled:active:scale-95 disabled:opacity-45"
                >
                  {twoFaLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t("aurora.confirm")}
                </button>
              </div>
            </div>
          ) : totpEnabled ? (
            /* Если 2FA уже включена */
            twoFaDisabling ? (
              <div className="space-y-3 rounded-[18px] bg-[var(--au-bg)] p-3.5">
                <p className="text-[13px] font-semibold text-[var(--au-ink)]">
                  {t("aurora.disable_code_hint")}</p>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={twoFaCode}
                  onChange={(e) => {
                    setTwoFaCode(e.target.value);
                    setTwoFaError(null);
                  }}
                  placeholder="000 000"
                  className="w-full rounded-[16px] border-2 border-transparent bg-[var(--au-surface)] px-4 py-3 text-center font-mono text-[20px] font-extrabold tracking-widest text-[var(--au-ink)] outline-none transition-colors placeholder:text-[var(--au-muted)] focus:border-red-500"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTwoFaDisabling(false);
                      setTwoFaCode("");
                      setTwoFaError(null);
                    }}
                    className="flex-1 rounded-[16px] bg-[var(--au-surface)] py-3 text-[14px] font-bold text-[var(--au-muted)] transition-transform active:scale-95"
                  >
                    {t("aurora.cancel")}</button>
                  <button
                    type="button"
                    onClick={disableTwoFa}
                    disabled={twoFaLoading || twoFaCode.length < 6}
                    className="flex-1 rounded-[16px] border border-red-500/30 bg-red-500/15 py-3 text-[14px] font-bold text-red-600 dark:text-red-400 transition-transform enabled:active:scale-95 disabled:opacity-45"
                  >
                    {twoFaLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t("aurora.disable_twofa")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTwoFaDisabling(true);
                  setTwoFaCode("");
                  setTwoFaError(null);
                }}
                className="w-full rounded-[16px] border border-red-500/20 bg-red-500/10 py-3 text-[14px] font-bold text-red-600 dark:text-red-400 transition-colors hover:bg-red-500/20 active:scale-[0.99]"
              >
                {t("aurora.disable_twofa")}</button>
            )
          ) : (
            /* Если 2FA не включена */
            <button
              type="button"
              onClick={startTwoFaSetup}
              disabled={twoFaLoading}
              className="flex w-full items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-[var(--au-from)]/40 bg-[var(--au-bg)] py-3 text-[14px] font-bold text-[var(--au-from)] transition-colors hover:border-[var(--au-from)] active:scale-[0.99]"
            >
              {twoFaLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {twoFaLoading ? t("aurora.loading") : t("aurora.enable_twofa")}
            </button>
          )}
        </section>
      </div>
    </AuroraSheet>
  );
}
