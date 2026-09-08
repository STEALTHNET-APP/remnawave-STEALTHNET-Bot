import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { KeyRound, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// T-pwd-reset (портировано из WolfVPN): установка нового пароля по токену из письма.
export function ClientResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Пароль минимум 8 символов");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setLoading(true);
    try {
      await api.clientResetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/cabinet/login", { replace: true }), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить пароль");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-svh flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="w-full max-w-md">
        <div className="relative rounded-[2.5rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl shadow-2xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="p-8 sm:p-10 relative z-10">
            <div className="flex justify-center mb-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 border border-primary/20">
                {done ? <CheckCircle2 className="h-10 w-10 text-emerald-500" /> : <KeyRound className="h-10 w-10 text-primary" />}
              </div>
            </div>
            {!token ? (
              <div className="text-center space-y-3">
                <h2 className="text-2xl font-extrabold tracking-tight">Ссылка недействительна</h2>
                <p className="text-muted-foreground text-sm">Токен сброса отсутствует. Запросите сброс заново.</p>
                <Link to="/cabinet/forgot-password" className="inline-flex items-center gap-1.5 text-primary hover:underline text-sm pt-2">
                  Запросить сброс
                </Link>
              </div>
            ) : done ? (
              <div className="text-center space-y-3">
                <h2 className="text-2xl font-extrabold tracking-tight">Пароль изменён!</h2>
                <p className="text-muted-foreground text-sm">Сейчас перенаправим на страницу входа…</p>
              </div>
            ) : (
              <>
                <div className="space-y-1 text-center mb-8">
                  <h2 className="text-2xl font-extrabold tracking-tight mb-2">Новый пароль</h2>
                  <p className="text-muted-foreground text-sm">Задайте новый пароль для входа</p>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">{error}</div>}
                  <div className="space-y-2">
                    <Label htmlFor="pwd">Новый пароль</Label>
                    <Input
                      id="pwd"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="h-12 rounded-xl bg-card border-muted-foreground/75 text-base shadow-sm dark:bg-background/50 dark:border-white/15 focus-visible:ring-primary/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pwd2">Повторите пароль</Label>
                    <Input
                      id="pwd2"
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="h-12 rounded-xl bg-card border-muted-foreground/75 text-base shadow-sm dark:bg-background/50 dark:border-white/15 focus-visible:ring-primary/50"
                    />
                  </div>
                  <Button type="submit" className="w-full h-14 rounded-2xl text-base font-bold shadow-xl gap-2" disabled={loading}>
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Сменить пароль"}
                  </Button>
                  <Link to="/cabinet/login" className="flex items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground text-sm pt-1">
                    <ArrowLeft className="h-4 w-4" /> Назад ко входу
                  </Link>
                </form>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
