import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MailTest({ token, initialEmail }: { token: string; initialEmail: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error: boolean; message: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);

  async function send() {
    if (lock.current || !email.trim() || !input.current?.reportValidity()) return;
    lock.current = true;
    setBusy(true);
    setResult(null);
    try {
      await api.testMail(token, email.trim());
      setResult({ error: false, message: t("mailTest.success") });
    } catch (error) {
      setResult({ error: true, message: error instanceof Error ? error.message : t("mailTest.failed") });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <Label htmlFor="mail-test-recipient">{t("mailTest.title")}</Label>
      <p className="text-xs text-muted-foreground">{t("mailTest.hint")}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input ref={input} id="mail-test-recipient" type="email" value={email} disabled={busy}
          maxLength={254} placeholder="you@example.com"
          onChange={(event) => { setEmail(event.target.value); setResult(null); }} />
        <Button type="button" onClick={send} disabled={busy || !email.trim()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("mailTest.send")}
        </Button>
      </div>
      {result && <p role={result.error ? "alert" : "status"}
        className={result.error ? "text-sm text-destructive" : "text-sm text-foreground"}>{result.message}</p>}
    </div>
  );
}
