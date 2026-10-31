import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Gift, Loader2, Plus, Share2, Ticket, Trash2 } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api, type PublicTariff, type PublicTariffCategory } from "@/lib/api";
import { usePublicTariffs } from "@/lib/queries";
import { formatAuroraBalance } from "@/lib/aurora-profile";
import { cn } from "@/lib/utils";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuroraConfirmSheet } from "@/components/aurora/aurora-confirm-sheet";
import { AuroraPaymentSheet } from "@/components/aurora/aurora-payment-sheet";
import { checkoutMethods } from "@/lib/cabinet-checkout";
import { AuBadge, AuButton, AuEmpty, AuInput, AuLoading, AuNotice, AuPage, AuSection, CopyButton } from "@/components/aurora/aurora-ui";
import { toast } from "@/components/ui/toast";

type GiftSubscription = Awaited<ReturnType<typeof api.giftListSubscriptions>>["subscriptions"][number];
type GiftCode = Awaited<ReturnType<typeof api.giftListCodes>>["codes"][number];

type ConfirmState =
  | { kind: "cancel-code"; code: GiftCode }
  | { kind: "delete-sub"; subscription: GiftSubscription }
  | null;

function extrasPrice(
  tariff: PublicTariff,
  option: { durationDays: number } | undefined,
  extras: number,
): number {
  if (extras <= 0 || tariff.pricePerExtraDevice <= 0) return 0;
  const tiers = [...(tariff.deviceDiscountTiers ?? [])].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
  const tier = tiers.find((t) => extras >= t.minExtraDevices);
  const percent = tier?.discountPercent ?? 0;
  const monthly = (tariff.pricePerExtraDevice * extras * (100 - percent)) / 100;
  const days = option?.durationDays ?? tariff.durationDays;
  return Math.round(monthly * (Math.max(1, days) / 30) * 100) / 100;
}

export function AuroraGifts() {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const client = state.client;
  const currency = (client?.preferredCurrency ?? "rub").toUpperCase();
  const locale = i18n.language || "ru";

  const [subscriptions, setSubscriptions] = useState<GiftSubscription[]>([]);
  const [codes, setCodes] = useState<GiftCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [buyOpen, setBuyOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const tariffsQuery = usePublicTariffs();

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [subs, giftCodes] = await Promise.all([
        api.giftListSubscriptions(token),
        api.giftListCodes(token),
      ]);
      setSubscriptions(subs.subscriptions ?? []);
      setCodes(giftCodes.codes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.gifts_load_error"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const codeBySubscription = useMemo(() => {
    const map = new Map<string, GiftCode>();
    for (const code of codes) {
      if (code.status === "ACTIVE" && !map.has(code.subscriptionId)) map.set(code.subscriptionId, code);
    }
    return map;
  }, [codes]);

  function giftLink(code: string): string | null {
    const base = config?.publicAppUrl?.replace(/\/$/, "") || window.location.origin;
    return `${base}/gift/${encodeURIComponent(code)}`;
  }

  function telegramLink(code: string): string | null {
    const bot = config?.telegramBotUsername?.replace(/^@/, "");
    return bot ? `https://t.me/${bot}?start=gift_${code}` : null;
  }

  async function createCode(subscription: GiftSubscription) {
    if (!token) return;
    setBusy(`code-${subscription.id}`);
    try {
      await api.giftCreateCode(token, subscription.id);
      toast.success(t("aurora.gift_code_created"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("aurora.gift_code_error"));
    } finally {
      setBusy(null);
    }
  }

  async function activateForSelf(subscription: GiftSubscription) {
    if (!token) return;
    setBusy(`self-${subscription.id}`);
    try {
      await api.giftActivateForSelf(token, subscription.id);
      toast.success(t("aurora.gift_self_done"));
      await Promise.all([load(), refreshProfile().catch(() => {})]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("aurora.gift_self_error"));
    } finally {
      setBusy(null);
    }
  }

  async function submitRedeem() {
    if (!token || !redeemCode.trim() || redeemBusy) return;
    setRedeemBusy(true);
    setRedeemError(null);
    try {
      await api.giftRedeemCode(token, redeemCode.trim());
      toast.success(t("aurora.gift_redeemed"));
      setRedeemCode("");
      await Promise.all([load(), refreshProfile().catch(() => {})]);
    } catch (e) {
      setRedeemError(e instanceof Error ? e.message : t("aurora.gift_redeem_error"));
    } finally {
      setRedeemBusy(false);
    }
  }

  async function runConfirm() {
    if (!token || !confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.kind === "cancel-code") {
        await api.giftCancelCode(token, confirm.code.id);
        toast.success(t("aurora.gift_code_canceled"));
      } else {
        await api.giftDeleteSubscription(token, confirm.subscription.id);
        toast.success(t("aurora.gift_deleted"));
      }
      setConfirm(null);
      await Promise.all([load(), refreshProfile().catch(() => {})]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("aurora.action_error"));
    } finally {
      setConfirmBusy(false);
    }
  }

  function statusLabel(subscription: GiftSubscription): { label: string; tone: "neutral" | "success" | "danger" | "accent" } {
    if (subscription.giftStatus === "GIFTED") return { label: t("aurora.gift_status_gifted"), tone: "danger" };
    if (subscription.giftStatus === "ACTIVATED_SELF") return { label: t("aurora.gift_status_self"), tone: "success" };
    if (codeBySubscription.has(subscription.id)) return { label: t("aurora.gift_status_code"), tone: "accent" };
    return { label: t("aurora.gift_status_new"), tone: "neutral" };
  }

  if (loading) return <AuLoading rows={4} />;

  return (
    <AuPage>
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.gifts")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{t("aurora.gifts_subtitle")}</p>
      </header>

      {error && <AuNotice tone="error">{error}</AuNotice>}

      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] p-5 text-white">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Gift className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[16px] font-bold">{t("aurora.gift_buy_title")}</div>
            <div className="text-[12.5px] text-white/80">{t("aurora.gift_buy_hint")}</div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] bg-white/15 px-3.5 py-2.5 text-[13px]">
          <span>{t("aurora.balance")}</span>
          <span className="font-bold tabular-nums">{formatAuroraBalance(client?.balance ?? 0, currency, locale)}</span>
        </div>
        <button
          type="button"
          onClick={() => setBuyOpen(true)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-[16px] bg-white px-4 py-3.5 text-[15px] font-bold text-[#352b89]"
        >
          <Plus className="h-4 w-4" />
          {t("aurora.gift_buy")}
        </button>
      </section>

      <AuSection title={t("aurora.gift_redeem_title")}>
        <div className="space-y-2">
          <AuInput
            value={redeemCode}
            onChange={(e) => {
              setRedeemCode(e.target.value.toUpperCase());
              setRedeemError(null);
            }}
            placeholder={t("aurora.gift_redeem_placeholder")}
            autoComplete="off"
            maxLength={40}
          />
          {redeemError && <AuNotice tone="error">{redeemError}</AuNotice>}
          <AuButton variant="surface" onClick={submitRedeem} disabled={redeemBusy || !redeemCode.trim()}>
            {redeemBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("aurora.gift_redeem")}
          </AuButton>
        </div>
      </AuSection>

      <AuSection title={t("aurora.gift_my_gifts")}>
        {subscriptions.length === 0 ? (
          <AuEmpty icon={<Gift className="h-6 w-6" />} title={t("aurora.gift_empty_title")} hint={t("aurora.gift_empty_hint")} />
        ) : (
          <div className="space-y-2">
            {subscriptions.map((subscription) => {
              const status = statusLabel(subscription);
              const activeCode = codeBySubscription.get(subscription.id);
              const isGifted = subscription.giftStatus === "GIFTED";
              const isSelf = subscription.giftStatus === "ACTIVATED_SELF";
              const link = activeCode ? giftLink(activeCode.code) : null;
              const tgLink = activeCode ? telegramLink(activeCode.code) : null;
              return (
                <article key={subscription.id} className="rounded-[18px] bg-[var(--au-bg)] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14.5px] font-bold text-[var(--au-ink)]">
                        {t("aurora.gift_subscription", { index: subscription.subscriptionIndex })}
                      </div>
                      <div className="mt-0.5 text-[12px] text-[var(--au-muted)]">
                        {new Date(subscription.createdAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}
                      </div>
                    </div>
                    <AuBadge tone={status.tone}>{status.label}</AuBadge>
                  </div>

                  {activeCode && (
                    <div className="mt-2.5 rounded-[14px] bg-[var(--au-surface)] p-2.5">
                      <div className="text-center font-mono text-[16px] font-bold tracking-[0.12em] text-[var(--au-ink)]">{activeCode.code}</div>
                      <div className="mt-1 text-center text-[11.5px] text-[var(--au-muted)]">
                        {t("aurora.gift_code_until", { date: new Date(activeCode.expiresAt).toLocaleDateString(locale, { day: "numeric", month: "short" }) })}
                      </div>
                    </div>
                  )}

                  {!isGifted && !isSelf && (
                    <div className="mt-2.5 grid gap-2">
                      {activeCode ? (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <CopyButton
                              value={link ?? activeCode.code}
                              label={t("aurora.gift_copy_link")}
                              copiedLabel={t("aurora.copied")}
                              copied={copied === `link-${subscription.id}`}
                              onCopied={() => setCopied(`link-${subscription.id}`)}
                            />
                            <CopyButton
                              value={activeCode.code}
                              label={t("aurora.gift_copy_code")}
                              copiedLabel={t("aurora.copied")}
                              copied={copied === `code-${subscription.id}`}
                              onCopied={() => setCopied(`code-${subscription.id}`)}
                            />
                          </div>
                          {tgLink && (
                            <a
                              href={`https://t.me/share/url?url=${encodeURIComponent(link ?? tgLink)}&text=${encodeURIComponent(t("aurora.gift_share_text"))}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-center gap-2 rounded-[14px] bg-[var(--au-surface)] px-4 py-2.5 text-[13.5px] font-bold text-[var(--au-ink)]"
                            >
                              <Share2 className="h-4 w-4" />
                              {t("aurora.share")}
                            </a>
                          )}
                          <AuButton variant="ghost" onClick={() => setConfirm({ kind: "cancel-code", code: activeCode })}>
                            {t("aurora.gift_cancel_code")}
                          </AuButton>
                        </>
                      ) : (
                        <>
                          <AuButton onClick={() => createCode(subscription)} disabled={busy !== null}>
                            {busy === `code-${subscription.id}` && <Loader2 className="h-4 w-4 animate-spin" />}
                            {t("aurora.gift_create_code")}
                          </AuButton>
                          <div className="grid grid-cols-2 gap-2">
                            <AuButton variant="surface" onClick={() => activateForSelf(subscription)} disabled={busy !== null}>
                              {t("aurora.gift_take_self")}
                            </AuButton>
                            <AuButton variant="ghost" onClick={() => setConfirm({ kind: "delete-sub", subscription })}>
                              <Trash2 className="h-4 w-4" />
                              {t("aurora.delete")}
                            </AuButton>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </AuSection>

      {codes.length > 0 && (
        <AuSection title={t("aurora.gift_my_codes")}>
          <div className="space-y-2">
            {codes.map((code) => {
              const active = code.status === "ACTIVE";
              const tone = code.status === "ACTIVE" ? "accent" : code.status === "REDEEMED" ? "success" : "neutral";
              return (
                <div key={code.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--au-bg)] px-3.5 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
                    <Ticket className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[13.5px] font-bold tracking-wider text-[var(--au-ink)]">{code.code}</div>
                    <div className="text-[11.5px] text-[var(--au-muted)]">
                      {new Date(code.expiresAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                  </div>
                  <AuBadge tone={tone}>
                    {code.status === "ACTIVE" ? t("aurora.gift_code_active") : code.status === "REDEEMED" ? t("aurora.gift_code_used") : t("aurora.gift_code_expired")}
                  </AuBadge>
                  {active && (
                    <button
                      type="button"
                      onClick={() => setConfirm({ kind: "cancel-code", code })}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500"
                      aria-label={t("aurora.gift_cancel_code")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </AuSection>
      )}

      <AuroraGiftBuySheet
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        categories={tariffsQuery.data?.items ?? []}
        balance={client?.balance ?? 0}
        currency={currency}
        onBought={() => {
          setBuyOpen(false);
          void Promise.all([load(), refreshProfile().catch(() => {})]);
        }}
      />

      <AuroraConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "delete-sub" ? t("aurora.gift_delete_title") : t("aurora.gift_cancel_code")}
        description={confirm?.kind === "delete-sub" ? t("aurora.gift_delete_text") : t("aurora.gift_cancel_code_text")}
        confirmLabel={t("aurora.confirm")}
        danger
        loading={confirmBusy}
        onConfirm={() => void runConfirm()}
      />
    </AuPage>
  );
}

function AuroraGiftBuySheet({
  open,
  onClose,
  categories,
  balance,
  currency,
  onBought,
}: {
  open: boolean;
  onClose: () => void;
  categories: PublicTariffCategory[];
  balance: number;
  currency: string;
  onBought: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { state } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const client = state.client;
  const locale = i18n.language || "ru";
  const [tariffId, setTariffId] = useState<string | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [extras, setExtras] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const tariffs = useMemo(() => categories.flatMap((category) => category.tariffs.map((tariff) => ({ category, tariff }))), [categories]);
  const selected = tariffs.find((entry) => entry.tariff.id === tariffId)?.tariff ?? tariffs[0]?.tariff ?? null;
  const option = selected?.priceOptions.find((p) => p.id === optionId) ?? selected?.priceOptions[0];
  const total = (option?.price ?? selected?.price ?? 0) + (selected ? extrasPrice(selected, option, extras) : 0);
  const checkoutCurrency = (selected?.currency ?? currency).toUpperCase();
  const methods = useMemo(
    () =>
      checkoutMethods(config, checkoutCurrency, {
        balanceAvailable: false,
        hasTelegram: Boolean(client?.telegramId),
      }),
    [config, checkoutCurrency, client?.telegramId],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    const first = tariffs[0]?.tariff ?? null;
    setTariffId((current) => (current && tariffs.some((entry) => entry.tariff.id === current) ? current : first?.id ?? null));
  }, [open, tariffs]);

  useEffect(() => {
    if (!selected) return;
    setOptionId((current) => (current && selected.priceOptions.some((p) => p.id === current) ? current : selected.priceOptions[0]?.id ?? null));
    setExtras((current) => Math.min(current, selected.maxExtraDevices ?? 0));
  }, [selected]);

  async function buy() {
    if (!token || !selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.giftBuySubscription(token, {
        tariffId: selected.id,
        tariffPriceOptionId: optionId ?? undefined,
        extraDevices: extras,
      });
      toast.success(t("aurora.gift_bought"));
      onBought();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.gift_buy_error"));
    } finally {
      setBusy(false);
    }
  }

  const notEnough = total > balance;

  return (
    <>
    <AuroraSheet open={open} onClose={busy ? () => {} : onClose} title={t("aurora.gift_buy")}>
      <div className="space-y-3 pb-2">
        {tariffs.length === 0 ? (
          <AuEmpty title={t("aurora.tariffs_empty")} />
        ) : (
          <>
            <div className="space-y-2">
              {tariffs.map(({ category, tariff }) => {
                const active = tariff.id === selected?.id;
                return (
                  <button
                    key={`${category.id}-${tariff.id}`}
                    type="button"
                    onClick={() => setTariffId(tariff.id)}
                    className={cn(
                      "w-full rounded-[18px] border-2 p-3.5 text-left transition-colors",
                      active ? "border-[var(--au-from)] bg-[var(--au-surface)]" : "border-transparent bg-[var(--au-surface)]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[14.5px] font-bold text-[var(--au-ink)]">
                          {tariff.menuEmoji ? `${tariff.menuEmoji} ` : ""}{tariff.name}
                        </div>
                        <div className="text-[12px] text-[var(--au-muted)]">{category.name}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[14px] font-extrabold tabular-nums text-[var(--au-ink)]">
                          {formatAuroraBalance(tariff.price, tariff.currency.toUpperCase(), locale)}
                        </div>
                        <div className="text-[11.5px] text-[var(--au-muted)]">{t("aurora.days_short", { count: tariff.durationDays })}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {selected && selected.priceOptions.length > 1 && (
              <div className="space-y-1.5">
                <p className="px-1 text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.period")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {selected.priceOptions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setOptionId(p.id)}
                      className={cn(
                        "rounded-[14px] border-2 px-3 py-2.5 text-[13px] font-bold tabular-nums",
                        p.id === optionId ? "border-[var(--au-from)] bg-[var(--au-surface)] text-[var(--au-from)]" : "border-transparent bg-[var(--au-surface)] text-[var(--au-ink)]",
                      )}
                    >
                      {t("aurora.days_short", { count: p.durationDays })}
                      <span className="ml-1 font-semibold opacity-70">{formatAuroraBalance(p.price, selected.currency.toUpperCase(), locale)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(selected?.maxExtraDevices ?? 0) > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-[16px] bg-[var(--au-surface)] px-4 py-3">
                <span className="text-[13.5px] font-semibold text-[var(--au-ink)]">{t("aurora.extra_devices")}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExtras((v) => Math.max(0, v - 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-bg)] text-[16px] font-bold"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-[14px] font-bold tabular-nums">{extras}</span>
                  <button
                    type="button"
                    onClick={() => setExtras((v) => Math.min(selected?.maxExtraDevices ?? 0, v + 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-bg)] text-[16px] font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-[16px] bg-[var(--au-surface)] px-4 py-3 text-[14px]">
              <span className="text-[var(--au-muted)]">{t("aurora.total")}</span>
              <span className="text-[17px] font-extrabold tabular-nums text-[var(--au-ink)]">
                {formatAuroraBalance(total, (selected?.currency ?? currency).toUpperCase(), locale)}
              </span>
            </div>
            {notEnough && <AuNotice tone="error">{t("aurora.insufficient_balance")}</AuNotice>}
            {error && <AuNotice tone="error">{error}</AuNotice>}
            <AuButton onClick={buy} disabled={busy || notEnough || !selected} variant={notEnough ? "surface" : "primary"}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("aurora.gift_pay_balance")}
            </AuButton>
            <AuButton variant={notEnough ? "primary" : "surface"} onClick={() => setPayOpen(true)} disabled={!selected}>
              {t("aurora.gift_pay_external")}
            </AuButton>
          </>
        )}
      </div>
    </AuroraSheet>
    <AuroraPaymentSheet
      open={payOpen}
      onClose={() => setPayOpen(false)}
      title={t("aurora.gift_buy")}
      methods={methods}
      amountText={formatAuroraBalance(total, checkoutCurrency, locale)}
      product={
        selected
          ? {
              kind: "tariff",
              amount: total,
              currency: selected.currency,
              tariffId: selected.id,
              tariffPriceOptionId: optionId ?? undefined,
              deviceCount: extras,
              asGift: true,
              asAdditional: true,
            }
          : { kind: "tariff", amount: 0, currency: checkoutCurrency, tariffId: "" }
      }
      onSuccess={onBought}
    />
    </>
  );
}
