import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Shield, Loader2 } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ClientVerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "ok" | "already_verified" | "error">("loading");
  const [message, setMessage] = useState("");
  const { verifyEmail, state } = useClientAuth();
  const navigate = useNavigate();
  const hasSession = Boolean(state.token);
  // Один запрос на токен (StrictMode/повторный рендер не должны дёргать verify дважды).
  const requestedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Ссылка недействительна");
      return;
    }
    if (requestedTokenRef.current === token) return;
    requestedTokenRef.current = token;
    verifyEmail(token)
      .then((result) => {
        if (result === "already_verified") {
          setStatus("already_verified");
          return;
        }
        setStatus("ok");
        setTimeout(() => navigate("/cabinet/dashboard", { replace: true }), 1500);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Ссылка недействительна или истекла");
      });
  }, [token, verifyEmail, navigate]);

  return (
    <div className="min-h-svh flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Shield className="h-6 w-6" />
          </span>
        </div>
        <Card className="border shadow-lg">
          <CardHeader>
            <div className="flex justify-center mb-2">
              <div className="rounded-lg bg-primary/10 p-3">
                <Mail className="h-10 w-10 text-primary" />
              </div>
            </div>
            <CardTitle className="text-center">Подтверждение email</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            {status === "loading" && (
              <p className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Проверка ссылки…
              </p>
            )}
            {status === "ok" && (
              <p className="text-green-600">Регистрация завершена. Перенаправление в кабинет…</p>
            )}
            {status === "already_verified" && (
              <div className="space-y-3">
                <p className="text-green-600">Email уже подтверждён.</p>
                {hasSession ? (
                  <Link to="/cabinet/dashboard" replace className="text-primary hover:underline">Перейти в кабинет</Link>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    <Link to="/cabinet/login" replace className="text-primary hover:underline">Войдите в аккаунт</Link>
                    . Если пароль ещё не задан —{" "}
                    <Link to="/cabinet/forgot-password" className="text-primary hover:underline">восстановите доступ</Link>.
                  </p>
                )}
              </div>
            )}
            {status === "error" && (
              <p className="text-destructive">{message}</p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
