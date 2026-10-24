/**
 * AuroraProfile — профиль клиента в светлом и тёмном стилях Aurora.
 *
 * Композиция:
 *   • градиентная карточка-близнец: аватар-буква + имя/email + баланс;
 *   • карточка «Пополнить баланс» — сумма + кнопка (открывает нативную шторку AuroraTopUpSheet);
 *   • меню-список в карточках au-surface:
 *       «Приложение»: Подключить VPN / История платежей (AuroraPaymentsSheet) / Поддержка;
 *       «Аккаунт»: Язык (AuroraLanguageSheet) / Пароль и безопасность (AuroraSecuritySheet);
 *       «Документы»: Соглашение / Оферта / Инструкции (если заданы в админке);
 *   • Выйти — акцентная кнопка с мягким фоном в конце;
 *   • Полная гармоничная поддержка тёмной темы.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Globe, HelpCircle, CreditCard, FileText, Wallet, ChevronRight,
  Shield, LogOut, Lock, Wifi, type LucideIcon,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { getPublicConfigCached } from "@/lib/public-config";
import { cn } from "@/lib/utils";
import { AuroraTopUpSheet } from "@/components/aurora/aurora-topup-sheet";
import { AuroraPaymentsSheet } from "@/components/aurora/aurora-payments-sheet";
import { AuroraSecuritySheet } from "@/components/aurora/aurora-security-sheet";
import { AuroraLanguageSheet } from "@/components/aurora/aurora-language-sheet";

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
  const { state, logout } = useClientAuth();
  const navigate = useNavigate();
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);

  // Шторки действий Aurora
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);

  useEffect(() => {
    getPublicConfigCached()
      .then((c) => setConfig(c as unknown as Record<string, unknown>))
      .catch(() => {});
  }, []);

  // Открытие шторок по прямым ссылкам / хэшам
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#topup") {
      setTopUpOpen(true);
    }
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "payments") setPaymentsOpen(true);
    else if (tab === "security") setSecurityOpen(true);
    else if (tab === "language") setLanguageOpen(true);
  }, []);

  const client = state.client;
  const display = client?.email?.trim() || (client?.telegramUsername ? `@${client.telegramUsername}` : "Профиль");
  const currency = (client?.preferredCurrency ?? "rub").toLowerCase();
  const balanceText = new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : "RUB",
    minimumFractionDigits: 0,
  }).format(client?.balance ?? 0);

  const langCode = (client?.preferredLang ?? "ru").toLowerCase();
  const langLabel = KNOWN_LANG_NAMES[langCode] || langCode.toUpperCase();

  const serviceName = (config?.serviceName as string | null)?.trim() || "STEALTHNET";
  const agreementUrl = (config?.agreementLink as string | null)?.trim() || null;
  const offerUrl = (config?.offerLink as string | null)?.trim() || null;
  const instructionsUrl = (config?.instructionsLink as string | null)?.trim() || null;

  const groups: MenuGroup[] = [
    {
      title: "Приложение",
      rows: [
        { id: "connect", label: "Подключить VPN", icon: Wifi, to: "/cabinet/subscribe" },
        { id: "payments", label: "История платежей", icon: CreditCard, onClick: () => setPaymentsOpen(true) },
        { id: "support", label: "Поддержка", icon: HelpCircle, to: "/cabinet/tickets" },
      ],
    },
    {
      title: "Аккаунт",
      rows: [
        { id: "language", label: "Язык", icon: Globe, right: langLabel, onClick: () => setLanguageOpen(true) },
        { id: "security", label: "Пароль и безопасность", icon: Lock, onClick: () => setSecurityOpen(true) },
      ],
    },
    ...(agreementUrl || offerUrl || instructionsUrl
      ? [{
          title: "Документы",
          rows: [
            ...(agreementUrl ? [{ id: "tos", label: "Пользовательское соглашение", icon: FileText, href: agreementUrl }] : []),
            ...(offerUrl ? [{ id: "offer", label: "Публичная оферта", icon: FileText, href: offerUrl }] : []),
            ...(instructionsUrl ? [{ id: "docs", label: "Инструкции по подключению", icon: FileText, href: instructionsUrl }] : []),
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
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">Профиль</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{serviceName} · личные данные и настройки</p>
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
              ID аккаунта: <span className="font-mono">{client?.id ? client.id.slice(-6).toUpperCase() : "—"}</span>
            </div>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Wallet className="h-[18px] w-[18px]" />
          </span>
          <div>
            <div className="text-[17px] font-bold leading-tight tabular-nums">{balanceText}</div>
            <div className="text-[13px] text-white/75">баланс для оплаты тарифов</div>
          </div>
        </div>
      </section>

      {/* ── Пополнить баланс ── */}
      <button
        type="button"
        onClick={() => setTopUpOpen(true)}
        className="flex w-full items-center gap-3 rounded-[22px] bg-[var(--au-surface)] p-4 text-left transition-transform active:scale-[0.99]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-from)] shadow-sm">
          <Wallet className="h-5 w-5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-semibold text-[var(--au-ink)]">Пополнить баланс</span>
          <span className="block text-[12.5px] text-[var(--au-muted)]">карта · СБП · кошелёк · крипта</span>
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
                  <span className="flex-1 text-[14.5px] font-semibold text-[var(--au-ink)]">{r.label}</span>
                  {r.right && <span className="shrink-0 text-[13px] text-[var(--au-muted)]">{r.right}</span>}
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
        Выйти из аккаунта
      </button>

      {/* ── Сервисная подпись ── */}
      <div className="pb-2 pt-1 text-center text-[11px] text-[var(--au-muted)]">
        <Shield className="mr-1 inline h-3 w-3" />
        {serviceName}
      </div>

      {/* ── Шторки действий ── */}
      <AuroraTopUpSheet open={topUpOpen} onClose={() => setTopUpOpen(false)} />
      <AuroraPaymentsSheet open={paymentsOpen} onClose={() => setPaymentsOpen(false)} />
      <AuroraSecuritySheet open={securityOpen} onClose={() => setSecurityOpen(false)} />
      <AuroraLanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
    </div>
  );
}
