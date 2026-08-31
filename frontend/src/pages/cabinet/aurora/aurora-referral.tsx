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

import { useEffect, useMemo, useState } from "react";
import { Copy, Check, Send, Users } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientReferralStats, type PublicConfig } from "@/lib/api";
import { cn } from "@/lib/utils";

function fmtMoney(n: number, currency: string) {
  const sym = currency === "rub" || currency === "RUB" ? "₽" : currency === "usd" || currency === "USD" ? "$" : "";
  return `${Math.round(n)}${sym}`;
}

/** «3 друга» с правильным окончанием. */
function pluralFriends(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "друг";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "друга";
  return "друзей";
}

const SHARE_TEXT = "Пользуюсь этим VPN — присоединяйся по моей ссылке";

export function AuroraReferral() {
  const { state } = useClientAuth();
  const [stats, setStats] = useState<ClientReferralStats | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!state.token) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      api.getClientReferralStats(state.token).catch(() => null),
      api.getPublicConfig().catch(() => null),
    ]).then(([s, c]) => {
      if (!alive) return;
      setStats(s);
      setConfig(c);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [state.token]);

  // Ссылка на бота предпочтительнее сайтовой: друг попадает сразу в мини-апп.
  const link = useMemo(() => {
    if (!stats?.referralCode) return null;
    if (config?.telegramBotUsername) {
      return `https://t.me/${config.telegramBotUsername.replace(/^@/, "")}?start=ref_${stats.referralCode}`;
    }
    if (typeof window !== "undefined") {
      return `${window.location.origin}/cabinet/register?ref=${encodeURIComponent(stats.referralCode)}`;
    }
    return null;
  }, [stats, config]);

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
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(SHARE_TEXT)}`,
      );
      return;
    }
    if (typeof navigator !== "undefined" && "share" in navigator) {
      navigator.share({ url: link, title: SHARE_TEXT }).catch(() => {});
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
        { n: 1, percent: stats.referralPercent, note: "с оплат тех, кого пригласили вы" },
        { n: 2, percent: stats.referralPercentLevel2, note: "с оплат тех, кого пригласили ваши друзья" },
        { n: 3, percent: stats.referralPercentLevel3, note: "с оплат третьего уровня" },
      ].filter((l) => l.percent > 0)
    : [];

  return (
    <div className="space-y-3">
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Друзья</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">Приглашайте — получайте процент с их оплат</p>
      </header>

      {/* ── Накоплено и друзья ── */}
      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] p-5 text-white">
        <div className="text-[13px] text-white/75">Накоплено на балансе</div>
        <div className="mt-1 text-[40px] font-extrabold leading-none tracking-tight tabular-nums">
          {fmtMoney(stats?.totalEarnings ?? 0, currency)}
        </div>

        <div className="mt-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Users className="h-[18px] w-[18px]" />
          </span>
          <div>
            <div className="text-[17px] font-bold leading-tight tabular-nums">
              {friends} {pluralFriends(friends)}
            </div>
            <div className="text-[13px] text-white/75">
              {friends === 0 ? "пока никого не пригласили" : "пришли по вашей ссылке"}
            </div>
          </div>
        </div>
      </section>

      {/* ── Ссылка ── */}
      <section className="rounded-[22px] bg-[var(--au-surface)] p-4">
        <p className="text-[13px] font-semibold text-[var(--au-muted)]">Ваша ссылка</p>
        <div className="mt-2.5 rounded-[16px] bg-white p-3.5">
          <p className="break-all font-mono text-[13px] leading-relaxed">
            {link ?? "Ссылка появится после привязки аккаунта"}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={copy}
            disabled={!link}
            className={cn(
              "flex items-center justify-center gap-2 rounded-[16px] border-2 bg-white px-4 py-3.5 text-[15px] font-bold transition-colors disabled:opacity-45",
              copied ? "border-[#0F9D58] text-[#0F9D58]" : "border-transparent text-[var(--au-ink)] enabled:active:scale-[0.97]",
            )}
          >
            {copied ? <Check className="h-[18px] w-[18px]" /> : <Copy className="h-[18px] w-[18px]" />}
            {copied ? "Готово" : "Скопировать"}
          </button>
          <button
            type="button"
            onClick={share}
            disabled={!link}
            className="flex items-center justify-center gap-2 rounded-[16px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-4 py-3.5 text-[15px] font-bold text-white transition-transform enabled:active:scale-[0.97] disabled:opacity-45"
          >
            <Send className="h-[18px] w-[18px]" />
            Поделиться
          </button>
        </div>
      </section>

      {/* ── Как это работает ── */}
      <section className="rounded-[22px] bg-[var(--au-surface)] p-4">
        <p className="text-[13px] font-semibold text-[var(--au-muted)]">Как это работает</p>
        <ol className="mt-3 space-y-3.5">
          {[
            "Отправьте ссылку другу — в чат, сторис или куда удобно.",
            "Друг переходит по ней и оформляет подписку.",
            "Процент с его оплаты падает вам на баланс — им можно платить за свою подписку.",
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
          <p className="text-[13px] font-semibold text-[var(--au-muted)]">Сколько начисляем</p>
          <div className="mt-2.5 space-y-2">
            {levels.map((l) => (
              <div key={l.n} className="flex items-center gap-3 rounded-[16px] bg-white px-3.5 py-3">
                <span className="shrink-0 text-[19px] font-extrabold tabular-nums text-[var(--au-from)]">
                  {Math.round(l.percent)}%
                </span>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">{l.n}-й уровень</div>
                  <div className="text-[12.5px] leading-snug text-[var(--au-muted)]">{l.note}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--au-muted)]">
            Начисления приходят автоматически после успешной оплаты другом.
          </p>
        </section>
      )}
    </div>
  );
}
