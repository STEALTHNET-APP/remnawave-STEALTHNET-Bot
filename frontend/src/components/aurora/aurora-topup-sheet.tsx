/**
 * AuroraTopUpSheet — шторка пополнения баланса в дизайне Aurora.
 *
 * Поддерживает:
 *   • ввод произвольной суммы или выбор быстрых пресетов (100, 300, 500, 1000 ₽ / $);
 *   • выбор платёжного провайдера (YooKassa/СБП, ЮMoney, CryptoBot, Telegram Stars, Platega, Heleket, RollyPay, ParityPay, LAVA, Overpay);
 *   • создание платежа и показ PayNowPanel (прямой переход или открытие в новой вкладке);
 *   • полная адаптация под светлую и тёмную темы Aurora.
 */

import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wallet, CreditCard, Zap, Star, Loader2, AlertCircle, Coins,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { getPublicConfigCached } from "@/lib/public-config";
import { api } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { PayNowPanel } from "@/components/payment/pay-now-panel";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface PaymentMethodItem {
  id: string;
  kind: "yookassa" | "yoomoney" | "cryptopay" | "telegram_stars" | "platega" | "heleket" | "rollypay" | "paritypay" | "cloudpayments" | "lava" | "overpay";
  label: string;
  subLabel?: string;
  plategaId?: number;
  icon: typeof CreditCard;
}

export function AuroraTopUpSheet({ open, onClose }: Props) {
  const { state, refreshProfile } = useClientAuth();
  const navigate = useNavigate();

  const client = state.client;
  const token = state.token;
  const currency = (client?.preferredCurrency ?? "rub").toLowerCase();
  const isRub = currency === "rub";

  const [amount, setAmount] = useState<string>("300");
  const [selectedMethodId, setSelectedMethodId] = useState<string>("");
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readyUrl, setReadyUrl] = useState<{ url: string; provider: string; paymentId?: string } | null>(null);

  useEffect(() => {
    getPublicConfigCached()
      .then((c) => setConfig(c as unknown as Record<string, unknown>))
      .catch(() => {});
  }, []);

  // Список доступных методов
  const availableMethods = useMemo(() => {
    if (!config) return [];
    const list: PaymentMethodItem[] = [];

    const paymentProviders = (config.paymentProviders as { id: string; label: string }[]) ?? [];
    const providerLabel = (id: string, fallback: string) =>
      paymentProviders.find((p) => p.id === id)?.label || fallback;

    // Telegram Stars
    if (Boolean(config.telegramStarsEnabled) && isRub) {
      list.push({
        id: "telegram_stars",
        kind: "telegram_stars",
        label: "⭐ Telegram Stars",
        subLabel: "Оплата звёздами Telegram",
        icon: Star,
      });
    }

    // CryptoPay (CryptoBot)
    if (Boolean(config.cryptopayEnabled)) {
      list.push({
        id: "cryptopay",
        kind: "cryptopay",
        label: providerLabel("cryptopay", "Crypto Bot"),
        subLabel: "USDT, TON, BTC и др.",
        icon: Zap,
      });
    }

    // YooKassa (СБП и банковские карты)
    if (Boolean(config.yookassaEnabled) && isRub) {
      list.push({
        id: "yookassa",
        kind: "yookassa",
        label: providerLabel("yookassa", "Карта/СБП (Юкасса)"),
        subLabel: "МИР, Visa, Mastercard, СБП",
        icon: CreditCard,
      });
    }

    // ЮMoney
    if (Boolean(config.yoomoneyEnabled) && isRub) {
      list.push({
        id: "yoomoney",
        kind: "yoomoney",
        label: providerLabel("yoomoney", "ЮMoney"),
        subLabel: "Кошелёк или привязанная карта",
        icon: CreditCard,
      });
    }

    // Heleket
    if (Boolean(config.heleketEnabled)) {
      list.push({
        id: "heleket",
        kind: "heleket",
        label: providerLabel("heleket", "Heleket"),
        subLabel: "Криптовалютные платежи",
        icon: Coins,
      });
    }

    // RollyPay
    if (Boolean(config.rollypayEnabled) && isRub) {
      list.push({
        id: "rollypay",
        kind: "rollypay",
        label: providerLabel("rollypay", "RollyPay"),
        subLabel: "Банковские карты",
        icon: CreditCard,
      });
    }

    // ParityPay
    if (Boolean(config.cloudpaymentsEnabled) && isRub) {
      list.push({
        id: "cloudpayments",
        kind: "cloudpayments",
        label: providerLabel("cloudpayments", "CloudPayments"),
        subLabel: "Банковские карты",
        icon: CreditCard,
      });
    }
if (Boolean(config.paritypayEnabled) && isRub) {
      list.push({
        id: "paritypay",
        kind: "paritypay",
        label: providerLabel("paritypay", "ParityPay"),
        subLabel: "Банковские карты",
        icon: CreditCard,
      });
    }

    // LAVA
    if (Boolean(config.lavaEnabled) && isRub) {
      list.push({
        id: "lava",
        kind: "lava",
        label: providerLabel("lava", "LAVA"),
        subLabel: "Карты и кошельки",
        icon: CreditCard,
      });
    }

    // Overpay
    if (Boolean(config.overpayEnabled)) {
      list.push({
        id: "overpay",
        kind: "overpay",
        label: providerLabel("overpay", "Overpay"),
        subLabel: "Карты и платежные системы",
        icon: CreditCard,
      });
    }

    // Platega методы
    const plategaMethods = (config.plategaMethods as { id: number; label: string }[]) ?? [];
    for (const m of plategaMethods) {
      list.push({
        id: `platega_${m.id}`,
        kind: "platega",
        label: m.label,
        plategaId: m.id,
        icon: CreditCard,
      });
    }

    const order = new Map(paymentProviders.map((provider, index) => [provider.id, index]));
    return list.sort((a, b) => (order.get(a.kind) ?? 999) - (order.get(b.kind) ?? 999));
  }, [config, isRub]);

  // Выбираем первый метод по умолчанию
  useEffect(() => {
    if (availableMethods.length > 0 && !availableMethods.some((m) => m.id === selectedMethodId)) {
      setSelectedMethodId(availableMethods[0].id);
    }
  }, [availableMethods, selectedMethodId]);

  function handleClose() {
    if (loading) return;
    setLoading(false);
    setError(null);
    setReadyUrl(null);
    onClose();
  }

  const presets = isRub ? [100, 300, 500, 1000] : [5, 10, 20, 50];

  const currencySymbol = isRub ? "₽" : currency.toUpperCase() === "USD" ? "$" : currency.toUpperCase();

  async function handlePay() {
    if (!token || !client || loading) return;
    const num = Number(amount.replace(",", "."));
    if (!Number.isFinite(num) || num <= 0) {
      setError("Введите корректную сумму пополнения");
      return;
    }

    const method = availableMethods.find((m) => m.id === selectedMethodId);
    if (!method) {
      setError("Выберите способ оплаты");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      if (method.kind === "yookassa") {
        const res = await api.yookassaCreatePayment(token, { amount: num, currency: "RUB" });
        if (res.confirmationUrl) {
          setReadyUrl({ url: res.confirmationUrl, provider: "ЮKassa", paymentId: res.paymentId });
        }
      } else if (method.kind === "yoomoney") {
        const res = await api.yoomoneyCreateFormPayment(token, { amount: num, paymentType: "AC" });
        if (res.paymentUrl) {
          setReadyUrl({ url: res.paymentUrl, provider: "ЮMoney", paymentId: res.paymentId });
        } else if (res.form) {
          const f = res.form;
          const yoomoneyUrl = `https://yoomoney.ru/quickpay/confirm.xml?quickpay-form=shop&receiver=${encodeURIComponent(f.receiver)}&sum=${f.sum}&label=${encodeURIComponent(f.label)}&paymentType=${f.paymentType}&successURL=${encodeURIComponent(f.successURL)}`;
          setReadyUrl({ url: yoomoneyUrl, provider: "ЮMoney" });
        }
      } else if (method.kind === "telegram_stars") {
        const res = await api.starsCreatePayment(token, { amount: num, currency });
        if (res.payUrl) {
          setReadyUrl({ url: res.payUrl, provider: "Telegram Stars", paymentId: res.paymentId });
        }
      } else if (method.kind === "cryptopay") {
        const res = await api.cryptopayCreatePayment(token, { amount: num, currency });
        if (res.payUrl) {
          setReadyUrl({ url: res.payUrl, provider: "Crypto Bot", paymentId: res.paymentId });
        }
      } else if (method.kind === "platega" && method.plategaId) {
        const res = await api.clientCreatePlategaPayment(token, {
          amount: num,
          currency,
          paymentMethod: method.plategaId,
          description: "Пополнение баланса",
        });
        if (res.paymentUrl) {
          setReadyUrl({ url: res.paymentUrl, provider: method.label, paymentId: res.paymentId });
        }
      } else if (method.kind === "heleket") {
        const res = await api.heleketCreatePayment(token, { amount: num, currency });
        if (res.payUrl) {
          setReadyUrl({ url: res.payUrl, provider: "Heleket", paymentId: res.paymentId });
        }
      } else if (method.kind === "rollypay") {
        const res = await api.rollypayCreatePayment(token, { amount: num, currency });
        if (res.payUrl) {
          setReadyUrl({ url: res.payUrl, provider: "RollyPay", paymentId: res.paymentId });
        }
      } else if (method.kind === "cloudpayments") {
        const res = await api.cloudpaymentsCreatePayment(token, { amount: num, currency });
        if (res.payUrl) {
          setReadyUrl({ url: res.payUrl, provider: "CloudPayments", paymentId: res.paymentId });
        }
      } else if (method.kind === "paritypay") {
        const res = await api.paritypayCreatePayment(token, { amount: num, currency });
        if (res.payUrl) {
          setReadyUrl({ url: res.payUrl, provider: "ParityPay", paymentId: res.paymentId });
        }
      } else if (method.kind === "lava") {
        const res = await api.lavaCreatePayment(token, { amount: num, currency });
        if (res.payUrl) {
          setReadyUrl({ url: res.payUrl, provider: "LAVA", paymentId: res.paymentId });
        }
      } else if (method.kind === "overpay") {
        const res = await api.overpayCreatePayment(token, { amount: num, currency });
        if (res.payUrl) {
          setReadyUrl({ url: res.payUrl, provider: "Overpay", paymentId: res.paymentId });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать платёж");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuroraSheet
      open={open}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
            <Wallet className="h-4 w-4" />
          </span>
          <span>Пополнить баланс</span>
        </div>
      }
      footer={
        !readyUrl && (
          <button
            type="button"
            onClick={handlePay}
            disabled={loading || availableMethods.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-5 py-4 text-[16px] font-bold text-white shadow-md transition-transform enabled:active:scale-[0.99] disabled:opacity-45"
          >
            {loading && <Loader2 className="h-[18px] w-[18px] animate-spin" />}
            {loading ? "Создаём платёж…" : `Пополнить на ${amount || "0"} ${currencySymbol}`}
          </button>
        )
      }
    >
      {readyUrl ? (
        <div className="py-2">
          <PayNowPanel
            url={readyUrl.url}
            provider={readyUrl.provider}
            onBack={() => setReadyUrl(null)}
            onPaid={() => {
              const pid = readyUrl.paymentId;
              const u = readyUrl.url;
              const prov = readyUrl.provider;
              handleClose();
              refreshProfile().catch(() => {});
              if (pid) {
                navigate(`/cabinet/payment-wait?id=${encodeURIComponent(pid)}&kind=topup`, {
                  state: { url: u, provider: prov },
                });
              }
            }}
          />
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          {/* ── Текущий баланс ── */}
          <div className="flex items-center justify-between rounded-[20px] bg-[var(--au-surface)] p-4 text-[var(--au-ink)]">
            <span className="text-[14px] font-semibold text-[var(--au-muted)]">Текущий баланс</span>
            <span className="text-[17px] font-extrabold tabular-nums">
              {new Intl.NumberFormat("ru-RU", {
                style: "currency",
                currency: currency.toUpperCase(),
                minimumFractionDigits: 0,
              }).format(client?.balance ?? 0)}
            </span>
          </div>

          {/* ── Выбор суммы ── */}
          <div className="space-y-2">
            <label className="px-1 text-[13px] font-semibold text-[var(--au-muted)]">
              Сумма пополнения, {currencySymbol}
            </label>
            <div className="relative">
              <input
                type="number"
                inputMode="decimal"
                min="1"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                }}
                placeholder="0"
                className="w-full rounded-[18px] border-2 border-transparent bg-[var(--au-surface)] px-4 py-3.5 text-[20px] font-extrabold tabular-nums text-[var(--au-ink)] outline-none transition-colors placeholder:text-[var(--au-muted)] focus:border-[var(--au-from)]"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[17px] font-bold text-[var(--au-muted)]">
                {currencySymbol}
              </span>
            </div>

            {/* Быстрые чипы пресетов */}
            <div className="flex gap-2 pt-1">
              {presets.map((p) => {
                const isSelected = amount === String(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setAmount(String(p));
                      setError(null);
                    }}
                    className={cn(
                      "flex-1 rounded-[14px] border-2 py-2.5 text-[13.5px] font-bold tabular-nums transition-all active:scale-95",
                      isSelected
                        ? "border-[var(--au-from)] bg-[var(--au-surface)] text-[var(--au-from)] shadow-sm"
                        : "border-transparent bg-[var(--au-surface)] text-[var(--au-ink)] hover:border-black/5 dark:hover:border-white/10",
                    )}
                  >
                    {p} {currencySymbol}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Способы оплаты ── */}
          <div className="space-y-2 pt-1">
            <p className="px-1 text-[13px] font-semibold text-[var(--au-muted)]">Способ оплаты</p>
            {availableMethods.length > 0 ? (
              <div className="space-y-2">
                {availableMethods.map((m) => {
                  const isSelected = m.id === selectedMethodId;
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setSelectedMethodId(m.id);
                        setError(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[18px] border-2 p-3 text-left transition-all active:scale-[0.99]",
                        isSelected
                          ? "border-[var(--au-from)] bg-[var(--au-surface)]"
                          : "border-transparent bg-[var(--au-surface)] hover:border-black/5 dark:hover:border-white/10",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
                          isSelected
                            ? "bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white"
                            : "bg-[var(--au-bg)] text-[var(--au-muted)]",
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14.5px] font-bold text-[var(--au-ink)]">{m.label}</div>
                        {m.subLabel && (
                          <div className="truncate text-[12px] text-[var(--au-muted)]">{m.subLabel}</div>
                        )}
                      </div>
                      <div
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          isSelected ? "border-[var(--au-from)] bg-[var(--au-from)]" : "border-[var(--au-muted)]",
                        )}
                      >
                        {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[18px] bg-[var(--au-surface)] p-4 text-center text-[13px] text-[var(--au-muted)]">
                Платёжные методы временно недоступны.
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-[16px] border border-red-500/25 bg-red-500/10 p-3.5 text-[13px] text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </AuroraSheet>
  );
}
