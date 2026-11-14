import { useEffect, useMemo } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useTranslation } from "react-i18next";

export function AnimatedMoney({ amount, currency, perDay = false }: { amount: number; currency: string; perDay?: boolean }) {
  const { i18n } = useTranslation();
  const reduced = useReducedMotion();
  const value = useMotionValue(amount);
  const formatter = useMemo(() => new Intl.NumberFormat(i18n.language, {
    style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: perDay ? 2 : 0, maximumFractionDigits: 2,
  }), [i18n.language, currency, perDay]);
  const text = useTransform(value, current => formatter.format(current));
  useEffect(() => {
    if (reduced) { value.set(amount); return; }
    const animation = animate(value, amount, { duration: .34, ease: [.22, 1, .36, 1] });
    return () => animation.stop();
  }, [amount, reduced, value]);
  return <span className="cabinet-animated-money"><span className="sr-only">{formatter.format(amount)}</span><motion.span aria-hidden="true">{text}</motion.span></span>;
}
