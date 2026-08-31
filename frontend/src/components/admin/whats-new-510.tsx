/**
 * What's New 5.1.0 — одноразовый онбординг для админов.
 *
 * При первом входе в админку на версии 5.1.0 показывает стеклянный визард
 * со слайдами новых фич: анимированные орбы, stagger-списки, конфетти на финале.
 * Факт просмотра хранится в localStorage (per-browser) — не надоедает.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, RefreshCw, Gift, Gem, Wrench, ShieldCheck, Bot,
  ChevronRight, ChevronLeft, X, Rocket, PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "stealthnet_whatsnew_5.1.0_seen";

interface Slide {
  icon: typeof Sparkles;
  accent: string; // tailwind text-цвет иконки
  glow: string;   // tailwind bg-цвет орба
  title: string;
  items: string[];
}

const SLIDES: Slide[] = [
  {
    icon: RefreshCw,
    accent: "text-violet-400",
    glow: "bg-violet-500/30",
    title: "Умные подписки и конвертация",
    items: [
      "Режим «одна подписка из категории»: покупка конвертирует существующую вместо создания второй",
      "Pro-rata перенос остатка дней по цене нового тарифа",
      "Выбор судьбы доп. устройств: сохранить или превратить в дни",
      "Тот же тариф = честное продление, с подсказкой «продлить или купить ещё»",
    ],
  },
  {
    icon: Gift,
    accent: "text-rose-400",
    glow: "bg-rose-500/30",
    title: "Триал 2.0",
    items: [
      "Триал из тарифа ИЛИ standalone из сквада — псевдо-тариф, невидимый в каталоге",
      "Конвертация в платный с сохранением дней и остатка трафика",
      "Тогглы: разрешить конвертацию, «в любой тариф» или список",
      "Покупка заменяет триал — с выбором, какой именно",
    ],
  },
  {
    icon: Gem,
    accent: "text-fuchsia-400",
    glow: "bg-fuchsia-500/30",
    title: "Stealth-кабинет: glass-редизайн",
    items: [
      "Полная мультиподписочность — паритет с классик-кабинетом",
      "Глубокий glassmorphism + framer-motion анимации",
      "Левитирующая стеклянная нижняя панель",
      "Триалы, модалка оплаты и автосписание прямо в миниаппке",
    ],
  },
  {
    icon: Wrench,
    accent: "text-amber-400",
    glow: "bg-amber-500/30",
    title: "Инструменты админа",
    items: [
      "Продление выданных ключей прямо из карточки клиента",
      "Привязка существующего Remna-юзера как подписки",
      "Заявки на вывод: вкл/выкл и мин. сумма",
      "Email-шаблоны теперь реально применяются к письмам",
      "Онбординг What's New при первом входе (вы на нём )",
      "Больше уведомлений в TG-группу админов: триалы, конвертации, выводы, промокоды, подарки",
      "Расширенные права менеджеров",
    ],
  },
  {
    icon: ShieldCheck,
    accent: "text-emerald-400",
    glow: "bg-emerald-500/30",
    title: "Надёжность",
    items: [
      "Автосписание с баланса починено (тот самый «Платёж не найден»)",
      "Честные уведомления Platega: алерт при упавшей активации",
      "Метки маркетинга /start c_... считаются корректно",
      "TG/email привязываются к Remna-юзерам при любой покупке",
    ],
  },
  {
    icon: Bot,
    accent: "text-cyan-400",
    glow: "bg-cyan-500/30",
    title: "Бот",
    items: [
      "Кнопка «Конвертировать» у триалов + скрытие по тогглу",
      "Выбор устройств и заменяемого триала прямо в боте",
      "Больше редактируемых текстов («Тексты бота»)",
      "Тогглы кнопок экрана тарифов",
    ],
  },
];

/** Конфетти-частица для финального слайда. */
function ConfettiPiece({ i }: { i: number }) {
  const colors = ["bg-rose-500", "bg-violet-500", "bg-amber-400", "bg-emerald-400", "bg-fuchsia-500", "bg-cyan-400"];
  const left = (i * 37) % 100;
  const delay = (i % 10) * 0.12;
  const duration = 2.2 + (i % 5) * 0.35;
  const size = 5 + (i % 3) * 3;
  return (
    <motion.span
      className={cn("absolute top-[-5%] rounded-[2px]", colors[i % colors.length])}
      style={{ left: `${left}%`, width: size, height: size * 1.6 }}
      initial={{ y: 0, opacity: 0, rotate: 0 }}
      animate={{ y: "115vh", opacity: [0, 1, 1, 0.6], rotate: 360 + (i % 4) * 180 }}
      transition={{ duration, delay, ease: "easeIn", repeat: Infinity, repeatDelay: 1.2 }}
    />
  );
}

export function WhatsNew510() {
  const [open, setOpen] = useState(false);
  // step: 0 = приветствие, 1..SLIDES.length = фичи, SLIDES.length+1 = финал
  const [step, setStep] = useState(0);
  const lastStep = SLIDES.length + 1;

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch { /* private mode — просто не показываем */ }
  }, []);

  const close = () => {
    try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch { /* ignore */ }
    setOpen(false);
  };

  const confetti = useMemo(() => Array.from({ length: 26 }, (_, i) => i), []);

  if (!open) return null;

  const slide = step >= 1 && step <= SLIDES.length ? SLIDES[step - 1] : null;

  return (
    <AnimatePresence>
      <motion.div
        key="wn-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70"
      >
        {/* ambient-орбы под карточкой */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <motion.div
            className={cn("absolute -top-24 -left-24 h-96 w-96 rounded-full blur-3xl", slide?.glow ?? "bg-primary/25")}
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-primary/20 blur-3xl"
            animate={{ scale: [1.1, 1, 1.1], opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <motion.div
          initial={{ y: 32, scale: 0.95, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 22 }}
          className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card"
        >
          {/* верхний блик */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-transparent" />

          {/* конфетти на финале */}
          {step === lastStep && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {confetti.map((i) => <ConfettiPiece key={i} i={i} />)}
            </div>
          )}

          <button
            onClick={close}
            className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative px-7 pt-10 pb-7 min-h-[430px] flex flex-col">
            <AnimatePresence mode="wait">
              {step === 0 && (
                <motion.div
                  key="welcome"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-1 flex-col items-center justify-center text-center gap-5"
                >
                  <motion.div
                    initial={{ scale: 0, rotate: -20 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.15 }}
                    className="relative flex h-24 w-24 items-center justify-center rounded-[1.75rem] bg-primary shadow-primary/60"
                  >
                    <Sparkles className="h-12 w-12 text-white" />
                    <motion.span
                      className="absolute inset-0 rounded-[1.75rem] border-2 border-border"
                      animate={{ scale: [1, 1.25, 1.45], opacity: [0.7, 0.3, 0] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                    />
                  </motion.div>
                  <div className="space-y-2">
                    <motion.p
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="text-xs font-bold uppercase tracking-[0.3em] text-primary"
                    >
                      Обновление установлено
                    </motion.p>
                    <motion.h2
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="text-4xl font-black tracking-tight text-foreground"
                    >
                      STEALTHNET 5.1.0
                    </motion.h2>
                    <motion.p
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                      className="text-sm text-muted-foreground max-w-sm leading-relaxed"
                    >
                      Добро пожаловать! Это крупнейший релиз: умные подписки, триал 2.0,
                      glass-редизайн и десятки фиксов. Покажем главное за минуту.
                    </motion.p>
                  </div>
                </motion.div>
              )}

              {slide && (
                <motion.div
                  key={`slide-${step}`}
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-1 flex-col gap-5"
                >
                  <div className="flex items-center gap-4">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 16 }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-white/[0.06]"
                    >
                      <slide.icon className={cn("h-7 w-7", slide.accent)} />
                    </motion.div>
                    <h3 className="text-xl font-bold leading-tight">{slide.title}</h3>
                  </div>
                  <ul className="space-y-3">
                    {slide.items.map((item, i) => (
                      <motion.li
                        key={item}
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.15 + i * 0.1 }}
                        className="flex items-start gap-3 rounded-xl border border-border bg-white/[0.04] px-4 py-3"
                      >
                        <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", slide.accent.replace("text-", "bg-"))} />
                        <span className="text-sm leading-relaxed text-foreground/90">{item}</span>
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
              )}

              {step === lastStep && (
                <motion.div
                  key="finale"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-1 flex-col items-center justify-center text-center gap-5"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1, rotate: [0, -8, 8, 0] }}
                    transition={{ type: "spring", stiffness: 240, damping: 12 }}
                    className="flex h-24 w-24 items-center justify-center rounded-full bg-primary shadow-emerald-500/60"
                  >
                    <PartyPopper className="h-12 w-12 text-white" />
                  </motion.div>
                  <div className="space-y-2">
                    <h2 className="text-3xl font-black tracking-tight">Всё готово!</h2>
                    <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                      Загляните в «Тарифы» (режим одной подписки), «Триалы» (новые тогглы)
                      и «Настройки  Рефералка» (заявки на вывод). Хорошего релиза! 
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* прогресс-дотс + навигация */}
            <div className="mt-6 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                {Array.from({ length: lastStep + 1 }, (_, i) => (
                  <motion.span
                    key={i}
                    layout
                    className={cn(
                      "h-1.5 rounded-full transition-colors duration-300",
                      i === step ? "w-6 bg-primary" : "w-1.5 bg-card",
                    )}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                {step > 0 && step <= SLIDES.length && (
                  <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)} className="rounded-xl gap-1">
                    <ChevronLeft className="h-4 w-4" /> Назад
                  </Button>
                )}
                {step < lastStep ? (
                  <Button
                    size="sm"
                    onClick={() => setStep((s) => s + 1)}
                    className="rounded-xl gap-1 bg-primary text-white border-0 shadow-primary/30 hover:opacity-90"
                  >
                    {step === 0 ? "Показать новое" : "Далее"} <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={close}
                    className="rounded-xl gap-2 bg-primary text-white border-0 shadow-emerald-500/30 hover:opacity-90"
                  >
                    <Rocket className="h-4 w-4" /> Поехали!
                  </Button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
