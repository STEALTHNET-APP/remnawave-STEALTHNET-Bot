import { ReferralRewardSummary, referralRewardDescription } from "@/components/referral-reward-summary";
import { ReferralQrLinks } from "@/components/referral-qr";
import { buildReferralLinks } from "@/lib/referral-links";
/**
 * AuroraReferral — вкладка «Друзья» третьего дизайна мини-аппа.
 *
 * Композиция (в стиле остальных экранов Aurora):
 *   • градиентная карточка-близнец дашборда: накоплено и число друзей;
 *   • карточка ссылки: сама ссылка + «Скопировать» и «Поделиться»;
 *   • «Как это работает» — три пронумерованных шага;
 *   • «Сколько начисляем» — проценты по уровням (2-й и 3-й показываем,
 *     только если владелец их включил).
 *
 * Данные те же, что у остальных дизайнов: `getClientReferralStats` +
 * `getPublicConfig` (из конфига берём юзернейм бота для t.me-ссылки).
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, Copy, Check, Send, Users } from "lucide-react";
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

export function AuroraReferral() {
  const { t } = useTranslation();
  const { state } = useClientAuth();
  const cabinetConfig = useCabinetConfig();
  const [stats, setStats] = useState<ClientReferralStats | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

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

  // Ссылка на бота предпочтительнее сайтовой: друг попадает сразу в мини-апп.
  const links = buildReferralLinks(stats?.referralCode, config?.publicAppUrl || window.location.origin, config?.telegramBotUsername);
  const link = links.find((item) => item.kind === "bot")?.url ?? links[0]?.url ?? null;

  const currency = state.client?.preferredCurrency ?? "rub";
  const friends = stats?.referralCount ?? 0;

  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => { /* буфер недоступен — молча игнорируем */ },
    );
  }

  function share() {
    if (!link) return;
    // Внутри Telegram открываем родной диалог «Переслать» — он показывает
    // список чатов, в отличие от системного меню share.
    const tg = window.Telegram?.WebApp;
    if (tg?.initData?.trim() && typeof tg.openTelegramLink === "function") {
      tg.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t("aurora.referral_share_text"))}`,
      );
      return;
    }
    if (typeof navigator !== "undefined" && "share" in navigator) {
      navigator.share({ url: link, title: t("aurora.referral_share_text") }).catch(() => {});
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
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">{t("aurora.referral")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{stats ? referralRewardDescription(stats) : t("aurora.referral_subtitle")}</p>
      </header>

      {stats && <ReferralRewardSummary stats={stats} />}

      {/* ── Накоплено и друзья ── */}
      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] p-5 text-white">
        <div className="text-[13px] text-white/75">{t("aurora.referral_earned")}</div>
        <div className="mt-1 text-[40px] font-extrabold leading-none tracking-tight tabular-nums">
          {fmtMoney(stats?.totalEarnings ?? 0, currency)}
        </div>

        <div className="mt-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)]/20">
            <Users className="h-[18px] w-[18px]" />
          </span>
          <div>
            <div className="text-[17px] font-bold leading-tight tabular-nums">
              {t("aurora.referral_friends", { count: friends })}
            </div>
            <div className="text-[13px] text-white/75">
              {friends === 0 ? t("aurora.referral_no_friends") : t("aurora.referral_joined")}
            </div>
          </div>
        </div>
      </section>

      {/* ── Ссылка ── */}
      <section className="rounded-[22px] bg-[var(--au-surface)] p-4">
        {stats?.referralCode && links.length > 0
          ? <ReferralQrLinks code={stats.referralCode} links={links} />
          : <p className="text-sm">{t("aurora.referral_links_unavailable")}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={copy}
            disabled={!link}
            className={cn(
              "flex items-center justify-center gap-2 rounded-[16px] border-2 bg-[var(--au-bg)] px-4 py-3.5 text-[15px] font-bold transition-colors disabled:opacity-45",
              copied ? "border-[#0F9D58] text-[#0F9D58]" : "border-transparent text-[var(--au-ink)] enabled:active:scale-[0.97]",
            )}
          >
            {copied ? <Check className="h-[18px] w-[18px]" /> : <Copy className="h-[18px] w-[18px]" />}
            {copied ? t("aurora.copied") : t("aurora.referral_copy")}
          </button>
          <button
            type="button"
            onClick={share}
            disabled={!link}
            className="flex items-center justify-center gap-2 rounded-[16px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-4 py-3.5 text-[15px] font-bold text-white transition-transform enabled:active:scale-[0.97] disabled:opacity-45"
          >
            <Send className="h-[18px] w-[18px]" />
            {t("aurora.share")}
          </button>
        </div>
      </section>

      {/* ── Как это работает ── */}
      <section className="rounded-[22px] bg-[var(--au-surface)] p-4">
        <p className="text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.referral_how")}</p>
        <ol className="mt-3 space-y-3.5">
          {[
            t("aurora.referral_step_1"),
            t("aurora.referral_step_2"),
            stats ? referralRewardDescription(stats) : t("aurora.referral_step_3"),
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-[13px] font-bold text-white">
                {i + 1}
              </span>
              <span className="text-[14px] leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Проценты по уровням ── */}
      {levels.length > 0 && (
        <section className="rounded-[22px] bg-[var(--au-surface)] p-4">
          <p className="text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.referral_levels")}</p>
          <div className="mt-2.5 space-y-2">
            {levels.map((l) => (
              <div key={l.n} className="flex items-center gap-3 rounded-[16px] bg-[var(--au-bg)] px-3.5 py-3">
                <span className="shrink-0 text-[19px] font-extrabold tabular-nums text-[var(--au-from)]">
                  {Math.round(l.percent)}%
                </span>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">{t("aurora.referral_level", { level: l.n })}</div>
                  <div className="text-[12.5px] leading-snug text-[var(--au-muted)]">{l.note}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--au-muted)]">
            {t("aurora.referral_levels_note")}
          </p>
        </section>
      )}

      {cabinetConfig?.withdrawalsEnabled !== false && (
        <button
          type="button"
          onClick={() => setWithdrawOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--au-surface)] px-4 py-3.5 text-[13.5px] font-bold text-[var(--au-ink)] active:scale-[0.99]"
        >
          <Banknote className="h-4 w-4" />
          {t("aurora.withdraw_request")}
        </button>
      )}

      <AuroraWithdrawSheet open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </div>
  );
}
