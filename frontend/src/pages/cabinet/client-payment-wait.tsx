import { useEffect, useRef, useState } from "react";
import { useSearchParams, useLocation, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2, ExternalLink, ArrowRight, Clock, XCircle, Home } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

type WaitState = "pending" | "paid" | "failed";

// Тексты по типу покупки (передаётся через ?kind=)
const KIND_TEXT: Record<string, { paidTitle: string; paidDesc: string }> = {
  topup: { paidTitle: "Баланс пополнен! ✨", paidDesc: "Средства уже зачислены на ваш счёт." },
  tariff: { paidTitle: "Оплата прошла! ✨", paidDesc: "Подписка активируется автоматически в течение минуты." },
  proxy: { paidTitle: "Оплата прошла! ✨", paidDesc: "Доступ активируется автоматически в течение минуты." },
  singbox: { paidTitle: "Оплата прошла! ✨", paidDesc: "Доступ активируется автоматически в течение минуты." },
  option: { paidTitle: "Оплата прошла! ✨", paidDesc: "Опция применяется автоматически в течение минуты." },
  generic: { paidTitle: "Оплата прошла! ✨", paidDesc: "Спасибо за покупку! Если что-то не появилось сразу — обновите кабинет через минуту." },
};

export function ClientPaymentWaitPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { state, refreshProfile } = useClientAuth();
  const token = state.token ?? null;

  const paymentId = searchParams.get("id");
  const kind = searchParams.get("kind") || "generic";
  // URL провайдера передаётся через navigate state при первом переходе (для кнопки «открыть оплату снова»).
  const providerUrl = (location.state as { url?: string } | null)?.url ?? null;
  const provider = (location.state as { provider?: string } | null)?.provider ?? null;

  const [waitState, setWaitState] = useState<WaitState>("pending");
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const text = KIND_TEXT[kind] ?? KIND_TEXT.generic;

  // Polling статуса платежа
  useEffect(() => {
    if (!paymentId || !token) return;
    let active = true;

    const check = async () => {
      try {
        const res = await api.getPaymentStatus(token, paymentId);
        if (!active) return;
        if (res.status === "PAID") {
          setWaitState("paid");
          refreshProfile().catch(() => {});
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (res.status === "FAILED") {
          setWaitState("failed");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch { /* сеть моргнула — продолжаем поллить */ }
    };

    check();
    pollRef.current = setInterval(check, 3000);
    return () => {
      active = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [paymentId, token, refreshProfile]);

  // Счётчик ожидания (для подсказки «всё ещё ждём»)
  useEffect(() => {
    if (waitState !== "pending") return;
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(iv);
  }, [waitState]);

  // Нет id — некорректный заход, возвращаем на дашборд
  useEffect(() => {
    if (!paymentId) navigate("/cabinet/dashboard", { replace: true });
  }, [paymentId, navigate]);

  return (
    <div className="relative flex min-h-[80vh] items-center justify-center px-4 py-10">
      {/* Декоративные blobs (onboarding-стиль) — fixed на весь экран, чтобы не было прямоугольной обрезки */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.7, 0.5] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute -top-20 -left-10 h-72 w-72 rounded-full blur-[100px] ${waitState === "paid" ? "bg-emerald-500/25" : waitState === "failed" ? "bg-rose-500/20" : "bg-primary/25"}`}
        />
        <motion.div
          animate={{ scale: [1.1, 1, 1.1], opacity: [0.4, 0.6, 0.4] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute -bottom-24 -right-10 h-80 w-80 rounded-full blur-[110px] ${waitState === "paid" ? "bg-green-500/20" : "bg-fuchsia-500/20"}`}
        />
      </div>

      <div className="relative w-full max-w-md">
        <div className="overflow-hidden rounded-[2.5rem] border border-white/10 bg-card/70 p-8 text-center shadow-2xl backdrop-blur-3xl sm:p-10">
          <AnimatePresence mode="wait">
            {/* ── ОЖИДАНИЕ ── */}
            {waitState === "pending" && (
              <motion.div key="pending" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="flex flex-col items-center">
                <div className="relative mb-6 flex h-28 w-28 items-center justify-center">
                  <motion.span
                    animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                    className="absolute inset-0 rounded-full bg-primary/30"
                  />
                  <motion.span
                    animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.4 }}
                    className="absolute inset-0 rounded-full bg-primary/20"
                  />
                  <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 via-fuchsia-500/20 to-purple-500/30 shadow-inner">
                    <Loader2 className="h-9 w-9 animate-spin text-primary" />
                  </div>
                </div>
                <h1 className="text-2xl font-black tracking-tight text-foreground">Ожидаем оплату…</h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {provider ? <>Завершите оплату в окне <span className="font-semibold text-foreground">{provider}</span>. </> : "Завершите оплату в открывшемся окне. "}
                  Эта страница обновится автоматически, как только платёж пройдёт.
                </p>

                {providerUrl && (
                  <Button asChild size="lg" className="mt-6 h-13 w-full rounded-2xl bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500 text-base font-bold text-white shadow-lg hover:opacity-90">
                    <a href={providerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 py-3.5">
                      <ExternalLink className="h-5 w-5" /> Открыть оплату снова
                    </a>
                  </Button>
                )}

                <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground/70">
                  <Clock className="h-3.5 w-3.5" />
                  {elapsed < 45
                    ? "Обычно занимает несколько секунд"
                    : "Всё ещё ждём подтверждение от платёжной системы…"}
                </div>

                <Link to="/cabinet/dashboard" className="mt-4 inline-block text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                  Вернуться в кабинет
                </Link>
              </motion.div>
            )}

            {/* ── УСПЕХ ── */}
            {waitState === "paid" && (
              <motion.div key="paid" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
                {/* всполохи-частицы */}
                <div className="relative mb-6 flex h-28 w-28 items-center justify-center">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <motion.span
                      key={i}
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: [0, 1, 0], scale: [0, 1, 0.5], x: Math.cos((i / 8) * Math.PI * 2) * 70, y: Math.sin((i / 8) * Math.PI * 2) * 70 }}
                      transition={{ duration: 1.1, delay: 0.15, ease: "easeOut" }}
                      className="absolute h-2.5 w-2.5 rounded-full bg-emerald-400"
                    />
                  ))}
                  <motion.div
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 240, damping: 14 }}
                    className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-green-600 shadow-xl shadow-emerald-500/40"
                  >
                    <CheckCircle2 className="h-12 w-12 text-white" strokeWidth={2.5} />
                  </motion.div>
                </div>
                <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-2xl font-black tracking-tight text-foreground">
                  {text.paidTitle}
                </motion.h1>
                <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {text.paidDesc}
                </motion.p>
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mt-6 w-full">
                  <Button asChild size="lg" className="h-13 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 text-base font-bold text-white shadow-lg hover:opacity-90">
                    <Link to="/cabinet/dashboard" className="inline-flex items-center justify-center gap-2 py-3.5">
                      Перейти в кабинет <ArrowRight className="h-5 w-5" />
                    </Link>
                  </Button>
                </motion.div>
              </motion.div>
            )}

            {/* ── ОШИБКА ── */}
            {waitState === "failed" && (
              <motion.div key="failed" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
                <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-rose-500/15">
                  <XCircle className="h-12 w-12 text-rose-500" />
                </div>
                <h1 className="text-2xl font-black tracking-tight text-foreground">Платёж не прошёл</h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Оплата была отклонена или отменена. Попробуйте ещё раз — деньги не списались.
                </p>
                <div className="mt-6 flex w-full flex-col gap-2">
                  <Button asChild size="lg" className="h-12 w-full rounded-2xl text-base font-bold">
                    <Link to="/cabinet/tariffs" className="inline-flex items-center justify-center gap-2">Попробовать снова</Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="h-11 w-full rounded-2xl">
                    <Link to="/cabinet/dashboard" className="inline-flex items-center justify-center gap-2"><Home className="h-4 w-4" /> В кабинет</Link>
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
