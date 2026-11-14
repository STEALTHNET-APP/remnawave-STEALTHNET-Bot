import { ReferralRewardSummary } from "@/components/referral-reward-summary";
import { ReferralQrButton } from "@/components/referral-qr";
import { buildReferralLinks } from "@/lib/referral-links";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Banknote, Check, Copy, Send, UserPlus } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api, type ClientReferralStats, type PublicConfig } from "@/lib/api";
import { AuroraWithdrawSheet } from "@/components/aurora/aurora-withdraw-sheet";
import { cn } from "@/lib/utils";
import { getPublicConfigCached } from "@/lib/public-config";

function fmtMoney(n: number, currency: string) {
  const sym = currency === "rub" || currency === "RUB" ? "₽" : currency === "usd" || currency === "USD" ? "$" : "";
  return `${Math.round(n)}${sym}`;
}

function rewardDescription(stats: ClientReferralStats | null, t: TFunction) {
  if (!stats || !stats.referralRewardMode || stats.referralRewardMode === "percent") return t("aurora.referral_reward_percent");
  const reward = stats.referralRewardMode === "days"
    ? t("aurora.days_short", { count: stats.referralRewardDays ?? 0 })
    : `${stats.referralRewardAmount ?? 0} ${(stats.referralRewardCurrency ?? "RUB").toUpperCase()}`;
  return t("aurora.referral_reward_fixed", { reward });
}

export function AuroraReferral() {
  const { t } = useTranslation();
  const { state } = useClientAuth();
  const cabinetConfig = useCabinetConfig();
  const [stats, setStats] = useState<ClientReferralStats | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [kind, setKind] = useState<"site" | "bot" | null>(null);

  useEffect(() => {
    if (!state.token) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      api.getClientReferralStats(state.token).catch(() => null),
      getPublicConfigCached().catch(() => null),
    ]).then(([s, c]) => {
      if (!alive) return;
      setStats(s);
      setConfig(c);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [state.token]);

  const links = buildReferralLinks(stats?.referralCode, config?.publicAppUrl || window.location.origin, config?.telegramBotUsername);
  const activeKind = kind && links.some((item) => item.kind === kind)
    ? kind
    : links.find((item) => item.kind === "bot")?.kind ?? links[0]?.kind ?? "site";
  const link = links.find((item) => item.kind === activeKind) ?? links[0] ?? null;

  const currency = state.client?.preferredCurrency ?? "rub";
  const friends = stats?.referralCount ?? 0;

  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link.url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }

  function share() {
    if (!link) return;
    const tg = window.Telegram?.WebApp;
    if (tg?.initData?.trim() && typeof tg.openTelegramLink === "function") {
      tg.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(link.url)}&text=${encodeURIComponent(t("aurora.referral_share_text"))}`,
      );
      return;
    }
    if (typeof navigator !== "undefined" && "share" in navigator) {
      navigator.share({ url: link.url, title: t("aurora.referral_share_text") }).catch(() => {});
      return;
    }
    copy();
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-[150px] animate-pulse rounded-[26px] bg-[var(--au-surface)]" />
        <div className="h-[170px] animate-pulse rounded-[22px] bg-[var(--au-surface)]" />
        <div className="h-[190px] animate-pulse rounded-[22px] bg-[var(--au-surface)]" />
      </div>
    );
  }

  const levels = stats
    ? [
        { n: 1, percent: stats.referralPercent, note: t("aurora.referral_level_1_note") },
        { n: 2, percent: stats.referralPercentLevel2, note: t("aurora.referral_level_2_note") },
        { n: 3, percent: stats.referralPercentLevel3, note: t("aurora.referral_level_3_note") },
      ].filter((l) => l.percent > 0)
    : [];

  return (
    <div className="space-y-3">
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.referral")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{rewardDescription(stats, t)}</p>
      </header>

      <section className="au-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.referral_earned")}</div>
            <div className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight tabular-nums text-[var(--au-ink)]">
              {fmtMoney(stats?.totalEarnings ?? 0, currency)}
            </div>
          </div>
          {cabinetConfig?.withdrawalsEnabled !== false && (
            <button
              type="button"
              onClick={() => setWithdrawOpen(true)}
              className="flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--au-from)_12%,var(--au-bg))] px-3.5 text-[13px] font-bold text-[var(--au-from)] transition-transform active:scale-95"
            >
              <Banknote className="h-4 w-4" />
              {t("aurora.referral_withdraw")}
            </button>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-[16px] bg-[var(--au-bg)] px-3.5 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
            <UserPlus className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-[var(--au-ink)] tabular-nums">
              {t("aurora.referral_friends", { count: friends })}
            </div>
            <div className="text-[12px] text-[var(--au-muted)]">
              {friends === 0 ? t("aurora.referral_no_friends") : t("aurora.referral_joined")}
            </div>
          </div>
        </div>
      </section>

      {stats && <ReferralRewardSummary stats={stats} />}

      <section className="au-card space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.referral_link")}</p>
          {links.length > 1 && (
            <div className="flex shrink-0 gap-0.5 rounded-full bg-[var(--au-bg)] p-0.5" role="group" aria-label={t("aurora.referral_link")}>
              {links.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  aria-pressed={activeKind === item.kind}
                  onClick={() => setKind(item.kind)}
                  className={cn(
                    "rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors",
                    activeKind === item.kind ? "bg-[var(--au-surface)] text-[var(--au-ink)] shadow-sm" : "text-[var(--au-muted)]",
                  )}
                >
                  {item.kind === "site" ? t("aurora.referral_link_site") : t("aurora.referral_link_bot")}
                </button>
              ))}
            </div>
          )}
        </div>

        {stats?.referralCode && links.length > 0 ? (
          <div className="flex items-center gap-2 rounded-[16px] bg-[var(--au-bg)] p-1.5 pl-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--au-ink)] select-all">{link?.url}</span>
            <ReferralQrButton code={stats.referralCode} links={links} iconOnly />
          </div>
        ) : (
          <p className="text-[13px] text-[var(--au-muted)]">{t("aurora.referral_links_unavailable")}</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={copy}
            disabled={!link}
            className={cn(
              "flex min-h-12 items-center justify-center gap-2 rounded-[16px] border-2 bg-[var(--au-bg)] px-3 text-[14px] font-bold transition-colors disabled:opacity-45",
              copied ? "border-emerald-500 text-emerald-600 dark:text-emerald-400" : "border-transparent text-[var(--au-ink)] enabled:active:scale-[0.97]",
            )}
          >
            {copied ? <Check className="h-[18px] w-[18px]" /> : <Copy className="h-[18px] w-[18px]" />}
            {copied ? t("aurora.copied") : t("aurora.referral_copy")}
          </button>
          <button
            type="button"
            onClick={share}
            disabled={!link}
            className="flex min-h-12 items-center justify-center gap-2 rounded-[16px] bg-[var(--au-from)] px-3 text-[14px] font-bold text-white transition-transform enabled:active:scale-[0.97] disabled:opacity-45"
          >
            <Send className="h-[18px] w-[18px]" />
            {t("aurora.referral_share")}
          </button>
        </div>
      </section>

      <section className="au-card p-4">
        <p className="text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.referral_how")}</p>
        <ol className="mt-3 space-y-3.5">
          {[
            t("aurora.referral_step_1"),
            t("aurora.referral_step_2"),
            stats ? rewardDescription(stats, t) : t("aurora.referral_step_3"),
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--au-from)] text-[13px] font-bold text-white">
                {i + 1}
              </span>
              <span className="text-[14px] leading-relaxed text-[var(--au-ink)]">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {levels.length > 0 && (
        <section className="au-card p-4">
          <p className="text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.referral_levels")}</p>
          <div className="mt-2.5 space-y-2">
            {levels.map((l) => (
              <div key={l.n} className="flex items-center gap-3 rounded-[16px] bg-[var(--au-bg)] px-3.5 py-3">
                <span className="shrink-0 text-[19px] font-extrabold tabular-nums text-[var(--au-from)]">
                  {Math.round(l.percent)}%
                </span>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[var(--au-ink)]">{t("aurora.referral_level", { level: l.n })}</div>
                  <div className="text-[12.5px] leading-snug text-[var(--au-muted)]">{l.note}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--au-muted)]">{t("aurora.referral_levels_note")}</p>
        </section>
      )}

      <AuroraWithdrawSheet open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </div>
  );
}
