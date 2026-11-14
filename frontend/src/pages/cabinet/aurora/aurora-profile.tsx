import { useTranslation } from "react-i18next";
import { AuroraAccountSheet } from "@/components/aurora/aurora-account-sheet";
import { auroraProfileTab, formatAuroraBalance, type AuroraProfileTab } from "@/lib/aurora-profile";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Globe, HelpCircle, FileText, Wallet, ChevronRight,
  User, Shield, LogOut, Lock, Wifi, Smartphone, Gift, PlusCircle, KeyRound, Send, Coins, type LucideIcon,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { getPublicConfigCached } from "@/lib/public-config";
import { cn } from "@/lib/utils";
import { AuroraTopUpSheet } from "@/components/aurora/aurora-topup-sheet";
import { AuroraPaymentsSheet } from "@/components/aurora/aurora-payments-sheet";
import { AuroraSecuritySheet } from "@/components/aurora/aurora-security-sheet";
import { AuroraLanguageSheet } from "@/components/aurora/aurora-language-sheet";
import { AuroraCurrencySheet } from "@/components/aurora/aurora-currency-sheet";
import { AuroraDevicesSheet } from "@/components/aurora/aurora-devices-sheet";
import { api } from "@/lib/api";

interface MenuRow {
  id: string;
  label: string;
  icon: LucideIcon;
  right?: ReactNode;
  to?: string;
  href?: string;
  onClick?: () => void;
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
  const telegramLinked = Boolean(client?.telegramUsername || client?.telegramId);

  const groups: MenuGroup[] = [
    {
      title: t("aurora.account"),
      rows: [
        { id: "account", label: t("aurora.account_details"), icon: User, onClick: () => openTab("account") },
        {
          id: "telegram",
          label: t("aurora.telegram"),
          icon: Send,
          right: (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold", telegramLinked ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-[var(--au-bg)] text-[var(--au-muted)]")}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {telegramLinked ? t("aurora.telegram_linked_badge") : t("aurora.telegram_status_missing")}
            </span>
          ),
          onClick: () => openTab("account"),
        },
        { id: "language", label: t("aurora.language"), icon: Globe, right: langLabel, onClick: () => openTab("language") },
        { id: "currency", label: t("aurora.currency"), icon: Coins, right: currency.toUpperCase(), onClick: () => openTab("currency") },
        { id: "security", label: t("aurora.security"), icon: Lock, onClick: () => openTab("security") },
      ],
    },
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
        { id: "history", label: t("aurora.history"), icon: Wallet, to: "/cabinet/history" },
        ...(config?.giftSubscriptionsEnabled ? [{ id: "gifts", label: t("aurora.gifts"), icon: Gift, to: "/cabinet/gifts" } as MenuRow] : []),
        ...(config?.sellOptionsEnabled ? [{ id: "options", label: t("aurora.extra_options"), icon: PlusCircle, to: "/cabinet/extra-options" } as MenuRow] : []),
        ...(config?.showProxyEnabled ? [{ id: "proxy", label: t("aurora.proxy"), icon: Globe, to: "/cabinet/proxy" } as MenuRow] : []),
        ...(config?.showSingboxEnabled ? [{ id: "singbox", label: "Sing-box / AmneziaWG", icon: KeyRound, to: "/cabinet/singbox" } as MenuRow] : []),
        { id: "help", label: t("aurora.help"), icon: HelpCircle, to: "/cabinet/help" },
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
    <div className="space-y-4">
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.profile")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{serviceName} {t("aurora.profile_subtitle")}</p>
      </header>

      <section className="au-card flex items-center gap-3.5 p-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--au-from)_12%,var(--au-bg))] text-[22px] font-extrabold text-[var(--au-from)]">
          {avatarLetter(display)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-bold leading-tight text-[var(--au-ink)]">{display}</div>
          <div className="mt-0.5 truncate text-[12.5px] text-[var(--au-muted)]">
            {t("aurora.account_id_label")}<span className="font-mono select-all">{client?.id || "—"}</span>
          </div>
        </div>
      </section>

      <section className="au-card p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-from)]">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] text-[var(--au-muted)]">{t("aurora.profile_balance_title")}</div>
            <div className="mt-0.5 text-[20px] font-extrabold leading-tight tabular-nums text-[var(--au-ink)]">{balanceText}</div>
          </div>
          <button
            type="button"
            onClick={() => openTab("topup")}
            className="flex min-h-10 shrink-0 items-center rounded-full bg-[var(--au-from)] px-4 text-[13px] font-bold text-white transition-transform active:scale-95"
          >
            {t("aurora.profile_topup_action")}
          </button>
        </div>
      </section>

      {groups.map((g, gi) => (
        <section key={gi}>
          {g.title && <p className="px-4 pb-1.5 text-[12.5px] font-semibold text-[var(--au-muted)]">{g.title}</p>}
          <div className="au-card overflow-hidden p-0">
            {g.rows.map((r) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openRow(r)}
                  disabled={!r.to && !r.href && !r.onClick}
                  className="flex w-full items-center gap-3 border-b border-[color-mix(in_srgb,var(--au-muted)_14%,transparent)] px-4 py-3 text-left transition-colors last:border-b-0 enabled:active:bg-[var(--au-bg)] disabled:opacity-45"
                >
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]", r.danger ? "bg-red-500/15 text-red-500" : "bg-[color-mix(in_srgb,var(--au-from)_10%,var(--au-bg))] text-[var(--au-from)]")}>
                    <Icon className="h-[17px] w-[17px]" />
                  </span>
                  <span className="min-w-0 flex-1 text-[14.5px] font-semibold text-[var(--au-ink)]">{r.label}</span>
                  {r.right != null && <span className="max-w-[45%] shrink-0 truncate text-[13px] text-[var(--au-muted)]">{r.right}</span>}
                  <ChevronRight className="h-4 w-4 shrink-0 text-[color-mix(in_srgb,var(--au-muted)_60%,transparent)]" />
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <button
        type="button"
        onClick={() => { logout(); navigate("/cabinet/login"); }}
        className="flex w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--au-surface)] px-4 py-3.5 text-[15px] font-bold text-red-600 transition-colors active:bg-red-500/10 dark:text-red-400"
      >
        <LogOut className="h-[18px] w-[18px]" />
        {t("aurora.logout")}
      </button>

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

      <div className="pb-2 pt-1 text-center text-[11px] text-[var(--au-muted)]">
        <Shield className="mr-1 inline h-3 w-3" />
        {serviceName}
      </div>

      <AuroraAccountSheet open={activeTab === "account"} onClose={closeTab} />
      <AuroraTopUpSheet open={activeTab === "topup"} onClose={closeTab} />
      <AuroraPaymentsSheet open={activeTab === "payments"} onClose={closeTab} />
      <AuroraSecuritySheet open={activeTab === "security"} onClose={closeTab} />
      <AuroraLanguageSheet open={activeTab === "language"} onClose={closeTab} />
      <AuroraCurrencySheet open={activeTab === "currency"} onClose={closeTab} />
    </div>
  );
}
