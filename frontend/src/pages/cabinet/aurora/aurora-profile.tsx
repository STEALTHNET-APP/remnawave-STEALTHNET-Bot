import { useTranslation } from "react-i18next";
import { AuroraAccountSheet } from "@/components/aurora/aurora-account-sheet";
import { auroraProfileTab, formatAuroraBalance, type AuroraProfileTab } from "@/lib/aurora-profile";
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Globe, HelpCircle, CreditCard, FileText, Wallet, ChevronRight,
  User, Shield, LogOut, Lock, Wifi, Smartphone, Gift, PlusCircle, KeyRound, Send, type LucideIcon,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { getPublicConfigCached } from "@/lib/public-config";
import { cn } from "@/lib/utils";
import { AuroraTopUpSheet } from "@/components/aurora/aurora-topup-sheet";
import { AuroraPaymentsSheet } from "@/components/aurora/aurora-payments-sheet";
import { AuroraSecuritySheet } from "@/components/aurora/aurora-security-sheet";
import { AuroraLanguageSheet } from "@/components/aurora/aurora-language-sheet";
import { AuroraDevicesSheet } from "@/components/aurora/aurora-devices-sheet";
import { api } from "@/lib/api";

interface MenuRow {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Правый лейбл (текущее значение). */
  right?: string;
  to?: string;
  href?: string;
  onClick?: () => void;
  /** Красная строка (опасное действие). */
  danger?: boolean;
}

interface MenuGroup {
  title?: string;
  rows: MenuRow[];
}

function avatarLetter(s?: string | null): string {
  if (!s) return "?";
  const ch = s.trim().charAt(0).toUpperCase();
  return ch || "?";
}

const KNOWN_LANG_NAMES: Record<string, string> = {
  ru: "Русский",
  en: "English",
  uz: "Oʻzbekcha",
  kk: "Қазақша",
  uk: "Українська",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  tr: "Türkçe",
  zh: "中文",
  fa: "فارسی",
};

export function AuroraProfile() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { state, logout } = useClientAuth();
  const navigate = useNavigate();
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);

  const activeTab = auroraProfileTab(location.search, location.hash);
  const openTab = (tab: AuroraProfileTab) => {
    const params = new URLSearchParams(location.search);
    params.set("tab", tab);
    navigate({ search: params.toString(), hash: "" });
  };
  const closeTab = () => {
    const params = new URLSearchParams(location.search);
    params.delete("tab");
    navigate({ search: params.toString(), hash: "" }, { replace: true });
  };

  useEffect(() => {
    getPublicConfigCached()
      .then((c) => setConfig(c as unknown as Record<string, unknown>))
      .catch(() => {});
  }, []);

  const [devicesTotal, setDevicesTotal] = useState<number | null>(null);
  const token = state.token;

  useEffect(() => {
    if (!token) return;
    api.getMyAllDevices(token)
      .then((r) => setDevicesTotal(r.total ?? (r.items ?? []).length))
      .catch(() => {});
  }, [token]);

  const client = state.client;
  const display = client?.email?.trim() || (client?.telegramUsername ? `@${client.telegramUsername}` : t("aurora.profile"));
  const currency = (client?.preferredCurrency ?? "rub").toLowerCase();
  const balanceText = formatAuroraBalance(client?.balance ?? 0, currency, i18n.language);

  const langCode = (client?.preferredLang ?? "ru").toLowerCase();
  const langLabel = KNOWN_LANG_NAMES[langCode] || langCode.toUpperCase();

  const serviceName = (config?.serviceName as string | null)?.trim() || "STEALTHNET";
  const agreementUrl = (config?.agreementLink as string | null)?.trim() || null;
  const offerUrl = (config?.offerLink as string | null)?.trim() || null;
  const instructionsUrl = (config?.instructionsLink as string | null)?.trim() || null;

  const groups: MenuGroup[] = [
    {
      title: t("aurora.app"),
      rows: [
        { id: "connect", label: t("aurora.connect"), icon: Wifi, to: "/cabinet/subscribe" },
        {
          id: "devices",
          label: t("aurora.devices"),
          icon: Smartphone,
          right: devicesTotal != null ? String(devicesTotal) : undefined,
          onClick: () => openTab("devices"),
        },
        { id: "payments", label: t("aurora.payments"), icon: CreditCard, onClick: () => openTab("payments") },
        { id: "history", label: t("aurora.history"), icon: Wallet, to: "/cabinet/history" },
        ...(config?.giftSubscriptionsEnabled ? [{ id: "gifts", label: t("aurora.gifts"), icon: Gift, to: "/cabinet/gifts" } as MenuRow] : []),
        ...(config?.sellOptionsEnabled ? [{ id: "options", label: t("aurora.extra_options"), icon: PlusCircle, to: "/cabinet/extra-options" } as MenuRow] : []),
        ...(config?.showProxyEnabled ? [{ id: "proxy", label: t("aurora.proxy"), icon: Globe, to: "/cabinet/proxy" } as MenuRow] : []),
        ...(config?.showSingboxEnabled ? [{ id: "singbox", label: "Sing-box / AmneziaWG", icon: KeyRound, to: "/cabinet/singbox" } as MenuRow] : []),
        { id: "help", label: t("aurora.help"), icon: HelpCircle, to: "/cabinet/help" },
      ],
    },
    {
      title: t("aurora.account"),
      rows: [
        { id: "account", label: t("aurora.account_details"), icon: User, onClick: () => openTab("account") },
        {
          id: "telegram",
          label: t("aurora.telegram"),
          icon: Send,
          right: client?.telegramUsername ? `@${client.telegramUsername}` : client?.telegramId ? t("aurora.telegram_status_linked") : t("aurora.telegram_status_missing"),
          onClick: () => openTab("account"),
        },
        { id: "language", label: t("aurora.language"), icon: Globe, right: langLabel, onClick: () => openTab("language") },
        { id: "security", label: t("aurora.security"), icon: Lock, onClick: () => openTab("security") },
      ],
    },
    ...(agreementUrl || offerUrl || instructionsUrl
      ? [{
          title: t("aurora.documents"),
          rows: [
            ...(agreementUrl ? [{ id: "tos", label: t("aurora.agreement"), icon: FileText, href: agreementUrl }] : []),
            ...(offerUrl ? [{ id: "offer", label: t("aurora.offer"), icon: FileText, href: offerUrl }] : []),
            ...(instructionsUrl ? [{ id: "docs", label: t("aurora.instructions"), icon: FileText, href: instructionsUrl }] : []),
          ] as MenuRow[],
        }]
      : []),
  ];

  function openRow(r: MenuRow): void {
    if (r.onClick) r.onClick();
    else if (r.href) window.open(r.href, "_blank", "noopener,noreferrer");
    else if (r.to) navigate(r.to);
  }

  return (
    <div className="space-y-3">
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.profile")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{serviceName} {t("aurora.profile_subtitle")}</p>
      </header>

      {/* ── Карточка клиента: аватар + имя + баланс ── */}
      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] p-5 text-white shadow-sm">
        <div className="flex items-center gap-3.5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 text-[22px] font-extrabold">
            {avatarLetter(display)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[17px] font-bold leading-tight">{display}</div>
            <div className="mt-0.5 text-[13px] text-white/75">
              {t("aurora.account_id_label")}<span className="font-mono break-all select-all">{client?.id || "—"}</span>
            </div>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Wallet className="h-[18px] w-[18px]" />
          </span>
          <div>
            <div className="text-[17px] font-bold leading-tight tabular-nums">{balanceText}</div>
            <div className="text-[13px] text-white/75">{t("aurora.balance_hint")}</div>
          </div>
        </div>
      </section>

      {/* ── Пополнить баланс ── */}
      <button
        type="button"
        onClick={() => openTab("topup")}
        className="flex w-full items-center gap-3 rounded-[22px] bg-[var(--au-surface)] p-4 text-left transition-transform active:scale-[0.99]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-from)] shadow-sm">
          <Wallet className="h-5 w-5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-semibold text-[var(--au-ink)]">{t("aurora.topup")}</span>
          <span className="block text-[12.5px] text-[var(--au-muted)]">{t("aurora.topup_methods")}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--au-muted)]" />
      </button>

      {/* ── Меню-группы ── */}
      {groups.map((g, gi) => (
        <section key={gi} className="rounded-[22px] bg-[var(--au-surface)] p-2.5">
          {g.title && (
            <p className="px-2.5 pb-1.5 pt-1.5 text-[13px] font-semibold text-[var(--au-muted)]">{g.title}</p>
          )}
          <div className={cn(g.title && "space-y-1")}>
            {g.rows.map((r) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openRow(r)}
                  disabled={!r.to && !r.href && !r.onClick}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[16px] px-2.5 py-3 text-left transition-transform active:scale-[0.99] disabled:opacity-45",
                    !g.title && "bg-[var(--au-surface)]",
                  )}
                >
                  <span className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    r.danger ? "bg-red-500/15 text-red-500" : "bg-[var(--au-bg)]",
                  )}>
                    <Icon className={cn("h-[18px] w-[18px]", r.danger ? "text-red-500" : "text-[var(--au-muted)]")} />
                  </span>
                  <span className="flex-1 min-w-0 text-[14.5px] font-semibold text-[var(--au-ink)]">{r.label}</span>
                  {r.right && <span className="max-w-[35%] break-words text-[13px] text-[var(--au-muted)]">{r.right}</span>}
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--au-muted)]" />
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {/* ── Выйти ── */}
      <button
        type="button"
        onClick={() => { logout(); navigate("/cabinet/login"); }}
        className="flex w-full items-center justify-center gap-2 rounded-[22px] border-2 border-red-500/25 bg-red-500/10 px-4 py-3.5 text-[15px] font-bold text-red-600 dark:text-red-400 transition-colors hover:bg-red-500/15 active:scale-[0.98]"
      >
        <LogOut className="h-[18px] w-[18px]" />
        {t("aurora.logout")}</button>

      <AuroraDevicesSheet
        open={activeTab === "devices"}
        onClose={closeTab}
        onChanged={() => {
          if (token) {
            api.getMyAllDevices(token)
              .then((r) => setDevicesTotal(r.total ?? (r.items ?? []).length))
              .catch(() => {});
          }
        }}
      />

      {/* ── Сервисная подпись ── */}
      <div className="pb-2 pt-1 text-center text-[11px] text-[var(--au-muted)]">
        <Shield className="mr-1 inline h-3 w-3" />
        {serviceName}
      </div>

      {/* ── Шторки действий ── */}
      <AuroraAccountSheet open={activeTab === "account"} onClose={closeTab} />
      <AuroraTopUpSheet open={activeTab === "topup"} onClose={closeTab} />
      <AuroraPaymentsSheet open={activeTab === "payments"} onClose={closeTab} />
      <AuroraSecuritySheet open={activeTab === "security"} onClose={closeTab} />
      <AuroraLanguageSheet open={activeTab === "language"} onClose={closeTab} />
    </div>
  );
}
