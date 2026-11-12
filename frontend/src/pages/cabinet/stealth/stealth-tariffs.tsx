import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { motion } from "framer-motion";
import { Wallet, Check, AlertCircle, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { StadiumButton } from "@/components/stealth/stadium-button";
import { cn } from "@/lib/utils";
import {
  currencySymbol,
  formatMoney,
  formatMoneyPerDay,
  useCabinetTariffPurchase,
} from "../use-cabinet-tariff-purchase";

export function StealthTariffs() {
  const { state } = useClientAuth();
  const navigate = useNavigate();
  const [balConfirm, setBalConfirm] = useState<{ title: string; body: string } | null>(null);

  const {
    categories,
    displayCategories,
    currentCat,
    selectedTariff: currentTariff,
    priceOptions,
    selectedCatId,
    setSelectedCatId,
    selectedTariffId,
    setSelectedTariffId,
    selectedPriceOptionId,
    setSelectedPriceOptionId,
    days,
    finalPrice,
    pricePerDay,
    currency,
    balance,
    canPayWithBalance: canPayByBalance,
    availableMethods,
    selectedMethod,
    setSelectedMethod,
    paying,
    payError,
    extendTarget,
    extKeepExtras,
    setExtKeepExtras,
    keepExtrasCost,
    mySubs,
    duplicateSubscription,
    replaceTrialChoice,
    setReplaceTrialChoice,
    convPreview,
    convKeepExtras,
    setConvKeepExtras,
    promoInput,
    setPromoInput,
    promoApplied,
    promoMsg,
    setPromoMsg,
    promoBusy,
    applyPromo,
    doPay,
    prepareBalancePayment,
    loading,
  } = useCabinetTariffPurchase({ autoSelectFirst: true, autoSelectExtended: "tariffOnly", requirePriceOption: true });

  const currentTariffDeviceLimit = Math.max(currentTariff?.includedDevices ?? 0, currentTariff?.deviceLimit ?? 0) || null;
  const trialsOwned = mySubs.filter((sub) => sub.isTrial);

  async function pay() {
    if (selectedMethod?.kind === "balance") {
      const info = await prepareBalancePayment();
      if (info?.willReplace && info.preview) {
        const preview = info.preview;
        const subName = preview.subscription?.tariffName ? `«${preview.subscription.tariffName}»` : "текущую подписку";
        const bodyMain = preview.mode === "replace"
          ? `Старая подписка удалится, остаток ${preview.remainingDays ?? 0} дн. сгорит — создастся новая на выбранный тариф (${preview.purchasedDays ?? 0} дн. с нуля). VPN-ссылка сохранится.`
          : preview.mode === "extend"
            ? `Этот тариф у вас уже есть — он будет продлён.`
            : `Текущая подписка будет переведена на новый тариф. Остаток ${preview.remainingDays ?? 0} дн. пересчитается в ${preview.convertedDays ?? 0} дн. по цене нового тарифа.`;
        const othersLine = (preview.othersToRemove ?? 0) > 0 ? `\n⚠️ Остальные ${preview.othersToRemove} ваши подписки будут удалены — останется одна.` : "";
        setBalConfirm({
          title: preview.mode === "extend" ? `Продление затронет ${subName}` : `Покупка заменит ${subName}`,
          body: bodyMain + othersLine,
        });
        return;
      }
    }
    await doPay();
  }

  if (loading) {
    // Shimmer-скелетоны вместо спиннера — силуэт будущего контента.
    return (
      <div className="px-4 pt-2 space-y-4 pb-2">
        <div className="flex gap-2">
          {[88, 104, 96].map((w, i) => (
            <div
              key={i}
              className="h-9 rounded-full bg-white/[0.04] border border-white/[0.06] overflow-hidden relative"
              style={{ width: w }}
            >
              <div
                className="shimmer-bar absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            </div>
          ))}
        </div>
        {[164, 56, 120].map((h, i) => (
          <div
            key={i}
            className="rounded-3xl bg-white/[0.03] border border-white/[0.06] overflow-hidden relative"
            style={{ height: h }}
          >
            <div
              className="shimmer-bar-lg absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
              style={{ animationDelay: `${0.2 + i * 0.2}s` }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="px-4 pt-10 text-center text-zinc-400 text-sm">
        Тарифы пока не настроены.
      </div>
    );
  }

  return (
    <div className="px-4 pt-2 space-y-4 pb-2">
      {/* Режим продления: бейдж с подпиской, каталог сужен до её тарифа */}
      {extendTarget && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="relative overflow-hidden rounded-2xl border border-saccent-500/25 bg-saccent-500/[0.07] backdrop-blur-xl p-3.5 shadow-[0_0_36px_-14px_rgb(var(--stealth-accent)_/_0.4)]"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-saccent-500/10 to-transparent pointer-events-none" />
          <div className="relative flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-saccent-500/15 shrink-0">
              <RefreshCw className="h-3.5 w-3.5 text-saccent-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold">Продление подписки</p>
              <p className="text-[11px] text-zinc-400 truncate">{extendTarget.label} — выберите срок и способ оплаты</p>
            </div>
          </div>
          {/* доп. устройства подписки: сохранить (доплата) или убрать. */}
          {extendTarget.extraDevices > 0 && (
            <div className="relative mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setExtKeepExtras(true)}
                className={cn(
                  "rounded-xl border p-2.5 text-left transition-all",
                  extKeepExtras ? "border-saccent-500/50 bg-saccent-500/10" : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                )}
              >
                <p className="text-[11px] font-bold">📱 +{extendTarget.extraDevices} устройств</p>
                <p className="text-[10px] text-zinc-400">сохранить (+{formatMoney(keepExtrasCost, currency, "stealth")})</p>
              </button>
              <button
                type="button"
                onClick={() => setExtKeepExtras(false)}
                className={cn(
                  "rounded-xl border p-2.5 text-left transition-all",
                  !extKeepExtras ? "border-saccent-500/50 bg-saccent-500/10" : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                )}
              >
                <p className="text-[11px] font-bold">⚡ Убрать</p>
                <p className="text-[10px] text-zinc-400">без доплаты, устройства отключатся</p>
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* Category tabs (только если >1) */}
      {displayCategories.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {displayCategories.map((c) => {
            const active = c.id === selectedCatId;
            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedCatId(c.id);
                  const firstT = c.tariffs[0];
                  if (firstT) {
                    setSelectedTariffId(firstT.id);
                    const opts = firstT.priceOptions ?? [];
                    setSelectedPriceOptionId((opts.find((o) => o.durationDays === 30) ?? opts[0])?.id ?? null);
                  }
                }}
                className={cn(
                  "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300 active:scale-95",
                  active
                    ? "bg-white text-black border-white shadow-[0_0_28px_-8px_rgba(255,255,255,0.5)]"
                    : "bg-white/[0.03] text-zinc-300 border-white/[0.08] backdrop-blur-xl hover:border-white/25 hover:bg-white/[0.06]",
                )}
              >
                {c.emoji ? `${c.emoji} ` : ""}{c.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Tariff tabs (если >1 в категории) */}
      {currentCat && currentCat.tariffs.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {currentCat.tariffs.map((t) => {
            const active = t.id === selectedTariffId;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedTariffId(t.id);
                  const opts = t.priceOptions ?? [];
                  setSelectedPriceOptionId((opts.find((o) => o.durationDays === 30) ?? opts[0])?.id ?? null);
                }}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-300 active:scale-95",
                  active
                    ? "bg-white/[0.06] text-white border-saccent-500/45 backdrop-blur-xl shadow-[0_0_24px_-4px_rgb(var(--stealth-accent)_/_0.45)]"
                    : "bg-white/[0.02] text-zinc-400 border-white/[0.06] backdrop-blur-xl hover:border-white/20 hover:bg-white/[0.04]",
                )}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Period selector card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
        className="relative rounded-3xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-2xl p-5 space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_48px_-24px_rgba(0,0,0,0.8)] before:absolute before:inset-0 before:rounded-3xl before:bg-gradient-to-b before:from-white/[0.04] before:to-transparent before:pointer-events-none"
      >
        {priceOptions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {priceOptions.sort((a, b) => a.durationDays - b.durationDays).map((opt) => {
              const active = opt.id === selectedPriceOptionId;
              return (
                <button
                  key={opt.id}
                  onClick={() => setSelectedPriceOptionId(opt.id)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-300 min-w-[58px] active:scale-[0.94]",
                    active
                      ? "bg-white text-black border-white shadow-[0_0_24px_-6px_rgba(255,255,255,0.45)]"
                      : "bg-white/[0.03] text-zinc-300 border-white/[0.08] backdrop-blur-xl hover:border-white/25 hover:bg-white/[0.06]",
                  )}
                >
                  {opt.durationDays} дн.
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-end justify-between gap-4 pt-1">
          <div>
            <div className="text-3xl font-bold leading-none">{days}</div>
            <div className="text-xs text-zinc-500 mt-1.5">дн.</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{formatMoneyPerDay(pricePerDay, currency, "stealth")}</div>
            <div className="text-xs text-zinc-500">/день</div>
          </div>
        </div>

        <div className="border-t border-white/[0.06] pt-3 flex items-center justify-between">
          <span className="text-sm text-zinc-400">Итого:</span>
          <motion.span
            key={finalPrice}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="text-2xl font-bold tabular-nums bg-gradient-to-r from-saccent-400 via-saccent-300 to-fuchsia-400 bg-clip-text text-transparent drop-shadow-[0_0_18px_rgb(var(--stealth-accent)_/_0.35)]"
          >
            {formatMoney(finalPrice, currency, "stealth")}
          </motion.span>
        </div>
      </motion.div>

      {/* покупка заменяет активный триал (выбор при нескольких). */}
      {!extendTarget && !convPreview?.willConvert && (() => {
        if (trialsOwned.length === 0) return null;
        const chosen = replaceTrialChoice ?? trialsOwned[0].id;
        return (
          <div className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-4">
            <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 to-transparent pointer-events-none" />
            <div className="relative space-y-2">
              <p className="text-sm font-bold">
                {trialsOwned.length === 1 ? "Пробная подписка будет заменена этой покупкой" : "Покупка заменит один из пробных периодов"}
              </p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Триал удалится полностью (дни и трафик пробного периода не переносятся).
              </p>
              {trialsOwned.length > 1 && (
                <div className="space-y-1.5">
                  {trialsOwned.map((tr) => (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => setReplaceTrialChoice(tr.id)}
                      className={cn(
                        "w-full text-left rounded-xl border px-3 py-2 text-xs transition-all",
                        chosen === tr.id ? "border-amber-500/50 bg-amber-500/10 font-bold" : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                      )}
                    >
                      🎁 {tr.trialName ?? tr.label}
                      {tr.expireAt ? ` — до ${new Date(tr.expireAt).toLocaleDateString("ru-RU")}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* без single-режима: подписка с этим тарифом уже есть —
          предлагаем продлить её, либо продолжить покупку ещё одной. */}
      {!extendTarget && !convPreview?.willConvert && (() => {
        const dup = duplicateSubscription;
        if (!dup) return null;
        return (
          <div className="relative overflow-hidden rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.07] p-4">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-transparent pointer-events-none" />
            <div className="relative space-y-2">
              <p className="text-sm font-bold">У вас уже есть подписка с этим тарифом</p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                «{dup.label}»{dup.expireAt ? ` — до ${new Date(dup.expireAt).toLocaleDateString("ru-RU")}` : ""}.
                Можно продлить её (дни сложатся) — или продолжить ниже и купить ещё одну отдельную подписку.
              </p>
              <button
                onClick={() => navigate(`/cabinet/tariffs?extend=${encodeURIComponent(dup.id)}`)}
                className="rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 px-3.5 py-2 text-xs font-bold text-indigo-300 transition inline-flex items-center gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Продлить «{dup.label}»
              </button>
            </div>
          </div>
        );
      })()}

      {/* Конвертация: покупка из single-категории обновляет существующую подписку */}
      {convPreview?.willConvert && convPreview.subscription && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.1 }}
          className="relative overflow-hidden rounded-2xl border border-saccent-500/20 bg-saccent-500/[0.06] backdrop-blur-xl p-4 shadow-[0_0_36px_-14px_rgb(var(--stealth-accent)_/_0.35)]"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-saccent-500/10 via-transparent to-transparent pointer-events-none" />
          <div className="relative flex items-start gap-3">
            <div className="p-2 rounded-xl bg-saccent-500/15 shrink-0">
              <RefreshCw className="h-4 w-4 text-saccent-400" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-bold">
                {convPreview.mode === "extend"
                  ? "Этот тариф у вас уже есть — подписка будет продлена"
                  : convPreview.mode === "replace"
                    ? "Текущая подписка будет заменена новым тарифом"
                    : convPreview.subscription.isTrial ? "Пробная подписка станет платной" : "Подписка будет обновлена"}
              </p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {convPreview.mode === "extend"
                  ? `Вторая подписка не создастся — дни сложатся: остаток ${convPreview.remainingDays ?? 0} дн. + покупка ${convPreview.purchasedDays ?? 0} дн. = ${convPreview.totalDays ?? 0} дн. Устройства и серверы останутся как есть.`
                  : convPreview.mode === "replace"
                  ? `Старая подписка${convPreview.subscription.tariffName ? ` «${convPreview.subscription.tariffName}»` : ""} удалится, остаток ${convPreview.remainingDays ?? 0} дн. сгорит. Создастся новая на выбранный тариф — ${convPreview.purchasedDays ?? 0} дн. с нуля (VPN-ссылка сохранится).`
                  : <>Покупка не создаст вторую подписку — она обновит
                {convPreview.subscription.tariffName ? ` «${convPreview.subscription.tariffName}»` : " текущую"} до нового тарифа.
                {(convPreview.convertedDays ?? 0) > 0 && (convPreview.remainingDays ?? 0) > 0 && !(convPreview.extras && convPreview.extras.extraDevices > 0)
                  ? ` Остаток ${convPreview.remainingDays} дн. превратится в ${convPreview.convertedDays} дн. по цене нового тарифа.`
                  : ""}</>}
              </p>
              {(convPreview.othersToRemove ?? 0) > 0 && (
                <p className="text-xs font-bold text-amber-400">⚠️ Остальные {convPreview.othersToRemove} ваши подписки будут удалены — останется одна.</p>
              )}
              {convPreview.mode !== "extend" && (convPreview.extras?.extraDevices ?? 0) === 0 && (convPreview.totalDays ?? 0) > 0 && (
                <p className="text-xs font-bold text-saccent-400">Итого: {convPreview.totalDays} дн. нового тарифа</p>
              )}

              {/* same-tariff продление: устройства — сохранить (доплата) или убрать. */}
              {convPreview.mode === "extend" && convPreview.extras && convPreview.extras.extraDevices > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-bold">
                    У вас докуплено +{convPreview.extras.extraDevices} доп. устройств — что с ними сделать?
                  </p>
                  <button
                    type="button"
                    onClick={() => setConvKeepExtras(true)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-all",
                      convKeepExtras ? "border-saccent-500/50 bg-saccent-500/10" : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                    )}
                  >
                    <p className="text-xs font-bold">📱 Сохранить устройства (+{formatMoney(convPreview.extras.keep.extraCost ?? 0, currency, "stealth")})</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Всего {convPreview.extras.keep.totalDevices} устройств. Доплата за устройства
                      добавится к «Итого» выше.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConvKeepExtras(false)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-all",
                      !convKeepExtras ? "border-saccent-500/50 bg-saccent-500/10" : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                    )}
                  >
                    <p className="text-xs font-bold">⚡ Убрать устройства — без доплаты</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Останется {convPreview.extras.drop.totalDevices} устройств (только из тарифа).
                    </p>
                  </button>
                </div>
              )}

              {/* выбор судьбы доп. устройств при конвертации. */}
              {convPreview.mode !== "extend" && convPreview.extras && convPreview.extras.extraDevices > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-bold">
                    У вас докуплено +{convPreview.extras.extraDevices} доп. устройств — что с ними сделать?
                  </p>
                  <button
                    type="button"
                    onClick={() => setConvKeepExtras(true)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-all",
                      convKeepExtras
                        ? "border-saccent-500/50 bg-saccent-500/10"
                        : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                    )}
                  >
                    <p className="text-xs font-bold">📱 Оставить устройства</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Всего {convPreview.extras.keep.totalDevices} устройств
                      ({convPreview.extras.newIncludedDevices} в тарифе + {convPreview.extras.extraDevices} доп.).
                      Конвертация остатка: +{convPreview.extras.keep.convertedDays} дн. —
                      итого {convPreview.extras.keep.totalDays} дн.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConvKeepExtras(false)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-all",
                      !convKeepExtras
                        ? "border-saccent-500/50 bg-saccent-500/10"
                        : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                    )}
                  >
                    <p className="text-xs font-bold">⚡ Убрать устройства — больше дней</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Останется {convPreview.extras.drop.totalDevices} устройств (только из тарифа).
                      Стоимость устройств тоже превратится в дни: +{convPreview.extras.drop.convertedDays} дн. —
                      итого {convPreview.extras.drop.totalDays} дн.
                    </p>
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Promo */}
      {/* min-w-0 на input обязателен: flex-item с дефолтным min-width:auto
          не сжимался на узких экранах и выталкивал кнопку за край контейнера. */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-2 flex items-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] focus-within:border-saccent-500/35 focus-within:shadow-[0_0_28px_-10px_rgb(var(--stealth-accent)_/_0.4),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-300">
        <input
          value={promoInput}
          onChange={(e) => { setPromoInput(e.target.value); setPromoMsg(null); }}
          placeholder="Введите промокод"
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm placeholder-zinc-500 outline-none"
        />
        <button
          onClick={applyPromo}
          disabled={promoBusy || !promoInput.trim()}
          className="shrink-0 whitespace-nowrap rounded-xl bg-zinc-800/80 hover:bg-zinc-800 px-4 py-2 text-xs font-medium border border-white/[0.06] disabled:opacity-50 transition"
        >
          {promoBusy ? "..." : promoApplied ? <Check className="h-4 w-4 inline" /> : "Активировать"}
        </button>
      </div>
      {promoMsg && (
        <div className={cn("text-xs px-1", promoApplied ? "text-emerald-400" : "text-saccent-400")}>{promoMsg}</div>
      )}

      {/* Payment method tiles */}
      {availableMethods.length > 0 ? (
        <div className="grid grid-cols-2 gap-2.5">
          {availableMethods.map((m) => {
            const active = selectedMethod && (
              (selectedMethod.kind === "platega" && m.kind === "platega" && selectedMethod.id === m.id) ||
              (selectedMethod.kind === m.kind && m.kind !== "platega" && selectedMethod.kind !== "platega")
            );
            const Icon = m.icon;
            return (
              <button
                key={`${m.kind}-${m.kind === "platega" ? m.id : ""}`}
                onClick={() => setSelectedMethod(m)}
                className={cn(
                  "rounded-2xl border p-4 transition-colors duration-300 flex flex-col items-center gap-2 backdrop-blur-xl hover:scale-[1.02] active:scale-[0.97]",
                  active
                    ? "bg-white/[0.06] border-saccent-500/45 shadow-[0_0_36px_-10px_rgb(var(--stealth-accent)_/_0.5),inset_0_1px_0_rgba(255,255,255,0.08)]"
                    : "bg-white/[0.02] border-white/[0.06] hover:border-white/20 hover:bg-white/[0.04]",
                )}
              >
                <Icon className={cn("h-5 w-5 transition-colors duration-300", active ? "text-saccent-400 drop-shadow-[0_0_8px_rgb(var(--stealth-accent)_/_0.6)]" : "text-zinc-500")} />
                <span className="text-[11px] font-bold uppercase tracking-wider">{m.label}</span>
              </button>
            );
          })}
          {/* Тайл «Баланс» виден всегда (раньше прятался при нехватке средств,
              и юзеры думали, что оплаты с баланса в приложении нет вовсе). */}
          {state.client && (
            <button
              onClick={() => canPayByBalance && setSelectedMethod({ kind: "balance", label: `Баланс (${balance.toFixed(0)}${currencySymbol(currency)})`, icon: Wallet })}
              disabled={!canPayByBalance}
              className={cn(
                "rounded-2xl border p-4 transition-colors duration-300 flex flex-col items-center gap-1.5 backdrop-blur-xl",
                canPayByBalance && "hover:scale-[1.02] active:scale-[0.97]",
                selectedMethod?.kind === "balance"
                  ? "bg-emerald-500/[0.08] border-emerald-500/35 shadow-[0_0_32px_-10px_rgba(52,211,153,0.45),inset_0_1px_0_rgba(255,255,255,0.07)]"
                  : canPayByBalance
                    ? "bg-white/[0.02] border-white/[0.06] hover:border-white/20 hover:bg-white/[0.04]"
                    : "bg-zinc-900/20 border-white/[0.04] opacity-60 cursor-not-allowed",
              )}
            >
              <Wallet className={cn("h-5 w-5", selectedMethod?.kind === "balance" ? "text-emerald-400" : canPayByBalance ? "text-zinc-500" : "text-zinc-600")} />
              <span className="text-[11px] font-bold uppercase tracking-wider">Баланс</span>
              <span className={cn(
                "text-[10px] font-medium tabular-nums",
                canPayByBalance ? "text-emerald-400/90" : "text-zinc-500",
              )}>
                {canPayByBalance ? formatMoney(balance, currency, "stealth") : `${formatMoney(balance, currency, "stealth")} — не хватает`}
              </span>
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-zinc-900/40 p-3 text-xs text-zinc-400 text-center">
          Способы оплаты не настроены.
        </div>
      )}

      {/* Benefits */}
      <div className="space-y-2 pt-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Преимущества</p>
        <ul className="space-y-1.5">
          {[
            currentTariffDeviceLimit ? `До ${currentTariffDeviceLimit} устройств` : "Поддержка нескольких устройств",
            Number(currentTariff?.trafficLimitBytes) > 0 ? "Ограниченный трафик" : "Безлимитный трафик",
            "Минимальные задержки",
          ].map((b, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="h-4 w-4 rounded-full bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
                <Check className="h-2.5 w-2.5 text-sky-400" strokeWidth={3} />
              </span>
              <span className="text-zinc-200">{b}</span>
            </li>
          ))}
        </ul>
      </div>

      {payError && (
        <div className="rounded-xl bg-saccent-500/10 border border-saccent-500/30 p-3 flex items-start gap-2 text-xs">
          <AlertCircle className="h-4 w-4 text-saccent-400 shrink-0 mt-0.5" />
          <span className="text-saccent-300">{payError}</span>
        </div>
      )}

      {balConfirm && (
        <div data-pwa-block-update className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setBalConfirm(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-saccent-500/40 p-5 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <AlertCircle className="h-6 w-6 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-sm font-bold text-white">{balConfirm.title}</p>
                <p className="text-xs text-zinc-300 whitespace-pre-line leading-relaxed">{balConfirm.body}</p>
              </div>
            </div>
            <p className="text-xs text-zinc-400">Списать {formatMoney(finalPrice, currency, "stealth")} с баланса и продолжить?</p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setBalConfirm(null)} className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-zinc-300 active:scale-95 transition">Отмена</button>
              <button type="button" onClick={() => { setBalConfirm(null); void doPay(); }} className="flex-1 rounded-xl bg-saccent-500 py-2.5 text-sm font-bold text-white active:scale-95 transition">Да, продолжить</button>
            </div>
          </div>
        </div>
      )}
      {/* Big white CTA */}
      <div className="pt-2">
        <StadiumButton
          variant="white"
          size="lg"
          onClick={pay}
          disabled={paying || !selectedMethod || !currentTariff}
          iconLeft={paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        >
          {paying ? "Создаём платёж…" : `Оплатить ${formatMoney(finalPrice, currency, "stealth")}`}
        </StadiumButton>
      </div>
    </div>
  );
}
