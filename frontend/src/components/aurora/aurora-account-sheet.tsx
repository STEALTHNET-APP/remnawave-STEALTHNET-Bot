import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { AuroraSheet } from "./aurora-sheet";

export function AuroraAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const client = state.client;
  const token = state.token;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<{ code: string; expiresAt: string; botUsername: string | null } | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setMessage("");
    setConfirmUnlink(false);
    void refreshProfile();
    const onFocus = () => void refreshProfile();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [open, refreshProfile]);

  async function linkEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!token || busy || !email.trim()) return;
    setBusy("email"); setError(""); setMessage("");
    try {
      if (config?.smtpConfigured) {
        await api.clientLinkEmailRequest(token, { email: email.trim() });
        setMessage(t("cabinet.profile.link_email_sent"));
      } else {
        await api.clientLinkEmailDirect(token, { email: email.trim() });
        await refreshProfile();
        setMessage(t("aurora.email_linked"));
      }
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cabinet.profile.link_email_error"));
    } finally { setBusy(null); }
  }

  async function linkTelegram() {
    if (!token || busy) return;
    setBusy("telegram"); setError(""); setMessage("");
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (initData?.trim()) {
        await api.clientLinkTelegram(token, { initData });
        setLink(null);
        await refreshProfile();
        setMessage(t("aurora.telegram_linked"));
      } else {
        setLink(await api.clientLinkTelegramRequest(token));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cabinet.profile.link_telegram_error"));
    } finally { setBusy(null); }
  }

  async function unlinkPayment() {
    if (!token || busy) return;
    setBusy("payment"); setError(""); setMessage("");
    try {
      await api.yookassaUnlinkPaymentMethod(token);
      await refreshProfile();
      setConfirmUnlink(false);
      setMessage(t("aurora.payment_unlinked"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.payment_unlink_error"));
    } finally { setBusy(null); }
  }

  const buttonClass = "w-full rounded-2xl bg-[var(--au-surface)] px-4 py-3 font-semibold disabled:opacity-50";
  const inputClass = "w-full rounded-xl border border-[var(--au-muted)]/30 bg-[var(--au-bg)] px-3 py-3 text-[var(--au-ink)]";
  return <AuroraSheet open={open} onClose={onClose} title={t("aurora.account_details")}>
    <div className="space-y-5 pb-4">
      <dl className="space-y-3 text-sm break-words">
        <div><dt className="text-[var(--au-muted)]">{t("aurora.account_id")}</dt><dd className="select-all break-all">{client?.id}</dd></div>
        <div><dt>Email</dt><dd>{client?.email || t("aurora.not_linked")}</dd></div>
        <div><dt>Telegram</dt><dd>{client?.telegramUsername ? `@${client.telegramUsername}` : t("aurora.no_username")}</dd></div>
        <div><dt>Telegram ID</dt><dd className="select-all">{client?.telegramId || t("aurora.not_linked")}</dd></div>
      </dl>
      {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
      {message && <p role="status" className="text-[var(--au-ink)] text-sm">{message}</p>}
      {!client?.email && <form onSubmit={linkEmail} className="space-y-3">
        <label htmlFor="aurora-link-email" className="block font-semibold">{t("aurora.link_email")}</label>
        <input id="aurora-link-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} disabled={!!busy} />
        <button type="submit" className={buttonClass} disabled={!!busy || !email.trim()}>{busy === "email" ? t("aurora.sending") : t("aurora.send_link")}</button>
      </form>}
      {!client?.telegramId && <section className="space-y-3">
        <button type="button" onClick={() => void linkTelegram()} disabled={!!busy} className={buttonClass}>{busy === "telegram" ? t("aurora.linking") : t("aurora.link_telegram")}</button>
        {link && <div className="space-y-2 text-sm">
          <p>{t("cabinet.profile.link_code_hint")} <code className="select-all">/link {link.code}</code></p>
          {link.botUsername && <a className="block text-[var(--au-from)] underline" href={`https://t.me/${link.botUsername.replace(/^@/, "")}?start=link_${encodeURIComponent(link.code)}`} target="_blank" rel="noopener noreferrer">{t("aurora.open_bot")}</a>}
          <p className="text-[var(--au-muted)]">{t("cabinet.profile.link_code_expires")}</p>
        </div>}
      </section>}
      {client?.yookassaPaymentMethodTitle && <section className="space-y-3 border-t border-[var(--au-muted)]/20 pt-4">
        <h3 className="font-semibold">{t("aurora.saved_payment")}</h3>
        <p>{client.yookassaPaymentMethodTitle}</p>
        {confirmUnlink ? <>
          <p className="text-sm">{t("aurora.unlink_warning")}</p>
          <button type="button" onClick={() => void unlinkPayment()} disabled={!!busy} className={buttonClass}>{t("aurora.confirm_unlink")}</button>
          <button type="button" onClick={() => setConfirmUnlink(false)} disabled={!!busy} className={buttonClass}>{t("cabinet.profile.cancel")}</button>
        </> : <button type="button" onClick={() => setConfirmUnlink(true)} disabled={!!busy} className={buttonClass}>{t("aurora.unlink_payment")}</button>}
      </section>}
      <button type="button" onClick={() => void refreshProfile()} disabled={!!busy} className={buttonClass}>{t("aurora.refresh_account")}</button>
    </div>
  </AuroraSheet>;
}
