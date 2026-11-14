import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useClientAuth } from "@/contexts/client-auth";
import { Button } from "@/components/ui/button";

export function TelegramSignIn({ botUsername, disabled, registration = false }: { botUsername: string; disabled?: boolean; registration?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loginByTelegramDeepLink } = useClientAuth();
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const attempt = useRef(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const expiryTimer = useRef<ReturnType<typeof setTimeout>>();

  function stop() {
    attempt.current++;
    busy.current = false;
    clearTimeout(timer.current);
    clearTimeout(expiryTimer.current);
  }

  useEffect(() => stop, []);

  function cancel() {
    stop();
    setPending(false);
    setLink("");
  }

  async function start() {
    if (disabled || busy.current) return;
    stop();
    const current = attempt.current;
    busy.current = true;
    setPending(true);
    setError("");
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const { token, expiresAt } = await api.clientTelegramLoginToken();
      if (current !== attempt.current) { popup?.close(); return; }
      const url = `https://t.me/${encodeURIComponent(botUsername.replace(/^@/, "").trim())}?start=auth_${encodeURIComponent(token)}`;
      const remaining = Math.min(300_000, Date.parse(expiresAt) - Date.now());
      if (!Number.isFinite(remaining) || remaining <= 0) throw new Error(t("cabinet.login.error_timeout"));
      setLink(url);
      if (popup && !popup.closed) popup.location.href = url;
      expiryTimer.current = setTimeout(() => {
        if (current !== attempt.current) return;
        cancel();
        setError(t("cabinet.login.error_timeout"));
      }, remaining);
      let failures = 0;
      const poll = async () => {
        if (current !== attempt.current) return;
        try {
          const result = await api.clientTelegramLoginCheck(token);
          if (current !== attempt.current) return;
          failures = 0;
          if (result.confirmed) {
            stop();
            setPending(false);
            setLink("");
            loginByTelegramDeepLink(result);
            navigate("/cabinet", { replace: true });
            return;
          }
        } catch (err) {
          if (current !== attempt.current) return;
          if (++failures >= 3) {
            cancel();
            setError(err instanceof Error ? err.message : t("cabinet.login.error_telegram"));
            return;
          }
        }
        timer.current = setTimeout(poll, 2000);
      };
      timer.current = setTimeout(poll, 1500);
    } catch (err) {
      popup?.close();
      if (current !== attempt.current) return;
      cancel();
      setError(err instanceof Error ? err.message : t("cabinet.login.error_telegram"));
    }
  }

  return <div className="cabinet-telegram-sign-in space-y-3">
    <Button type="button" variant="outline" className="w-full min-h-12 gap-2" onClick={start} disabled={disabled || pending} aria-busy={pending}>
      {pending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
      {t(pending ? "cabinet.login.telegram_pending_short" : registration ? "cabinet.register.telegram" : "cabinet.login.telegram")}
    </Button>
    {pending && <div className="space-y-2 text-sm text-muted-foreground">
      <p role="status">{t("cabinet.login.telegram_instructions")}</p>
      <div className="flex flex-wrap items-center gap-4">
        {link && <a href={link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{t("cabinet.login.telegram_reopen")}</a>}
        <button type="button" onClick={cancel} className="underline underline-offset-4">{t("cabinet.tariffs.cancel")}</button>
      </div>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
