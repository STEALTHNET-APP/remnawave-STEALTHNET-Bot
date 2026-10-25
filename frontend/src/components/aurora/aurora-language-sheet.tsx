/**
 * AuroraLanguageSheet — выбор языка интерфейса в дизайне Aurora.
 *
 * Поддерживает:
 *   • отображение активных языков из публичного конфига (или ru/en по умолчанию);
 *   • нативные флаги и названия языков;
 *   • мгновенное применение через i18next и сохранение в профиль клиента через api.clientUpdateProfile;
 *   • полную гармоничную поддержку светлой и тёмной тем Aurora.
 */

import { useState, useEffect } from "react";
import { Globe, Check, Loader2, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClientAuth } from "@/contexts/client-auth";
import { getPublicConfigCached } from "@/lib/public-config";
import { api } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface LanguageItem {
  code: string;
  label: string;
  subLabel: string;
  flag: string;
}

const KNOWN_LANGUAGES: Record<string, { label: string; subLabel: string; flag: string }> = {
  ru: { label: "Русский", subLabel: "Russian", flag: "🇷🇺" },
  en: { label: "English", subLabel: "English", flag: "🇬🇧" },
  uz: { label: "Oʻzbekcha", subLabel: "Uzbek", flag: "🇺🇿" },
  kk: { label: "Қазақша", subLabel: "Kazakh", flag: "🇰🇿" },
  uk: { label: "Українська", subLabel: "Ukrainian", flag: "🇺🇦" },
  de: { label: "Deutsch", subLabel: "German", flag: "🇩🇪" },
  es: { label: "Español", subLabel: "Spanish", flag: "🇪🇸" },
  fr: { label: "Français", subLabel: "French", flag: "🇫🇷" },
  tr: { label: "Türkçe", subLabel: "Turkish", flag: "🇹🇷" },
  zh: { label: "中文", subLabel: "Chinese", flag: "🇨🇳" },
  fa: { label: "فارسی", subLabel: "Persian", flag: "🇮🇷" },
};

export function AuroraLanguageSheet({ open, onClose }: Props) {
  const { state, refreshProfile } = useClientAuth();
  const { t, i18n } = useTranslation();
  const token = state.token;

  const [activeCodes, setActiveCodes] = useState<string[]>(["ru", "en"]);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPublicConfigCached()
      .then((c) => {
        const langs = (c as { activeLanguages?: string[] })?.activeLanguages;
        if (Array.isArray(langs) && langs.length > 0) {
          setActiveCodes(langs);
        }
      })
      .catch(() => {});
  }, []);

  const currentLang = (state.client?.preferredLang || i18n.language || "ru").toLowerCase();

  const languageList: LanguageItem[] = activeCodes.map((code) => {
    const meta = KNOWN_LANGUAGES[code.toLowerCase()] || {
      label: code.toUpperCase(),
      subLabel: code.toUpperCase(),
      flag: "🌐",
    };
    return {
      code,
      label: meta.label,
      subLabel: meta.subLabel,
      flag: meta.flag,
    };
  });

  async function handleSelect(code: string) {
    if (savingCode) return;
    setError(null);
    setSavingCode(code);

    try {
      if (token) {
        await api.clientUpdateProfile(token, { preferredLang: code });
        await refreshProfile().catch(() => {});
      }

      await i18n.changeLanguage(code);
      setSavingCode(null);
      onClose();
    } catch (err) {
      setSavingCode(null);
      setError(err instanceof Error ? err.message : t("aurora.language_error"));
    }
  }

  return (
    <AuroraSheet
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
            <Globe className="h-4 w-4" />
          </span>
          <span>{t("aurora.interface_language")}</span>
        </div>
      }
    >
      <div className="space-y-3 pb-3">
        <p className="px-1 text-[13px] text-[var(--au-muted)]">
          {t("aurora.choose_language")}</p>

        {error && (
          <div className="flex items-start gap-2 rounded-[16px] border border-red-500/25 bg-red-500/10 p-3.5 text-[13px] text-red-600 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-2">
          {languageList.map((item) => {
            const isSelected = item.code.toLowerCase() === currentLang;
            const isSavingThis = savingCode === item.code;

            return (
              <button
                key={item.code}
                type="button"
                onClick={() => handleSelect(item.code)}
                disabled={Boolean(savingCode)}
                className={cn(
                  "flex w-full items-center gap-3.5 rounded-[20px] border-2 p-3.5 text-left transition-all active:scale-[0.99] disabled:opacity-60",
                  isSelected
                    ? "border-[var(--au-from)] bg-[var(--au-surface)] shadow-sm"
                    : "border-transparent bg-[var(--au-surface)] hover:border-black/5 dark:hover:border-white/10",
                )}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-[var(--au-bg)] text-[22px] shadow-sm">
                  {item.flag}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="text-[15.5px] font-bold text-[var(--au-ink)] leading-tight">
                    {item.label}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--au-muted)]">
                    {item.subLabel}
                  </div>
                </div>

                <div className="shrink-0 pl-1">
                  {isSavingThis ? (
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--au-from)]" />
                  ) : (
                    <div
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors",
                        isSelected
                          ? "border-[var(--au-from)] bg-[var(--au-from)] text-white"
                          : "border-[var(--au-muted)]/40",
                      )}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </AuroraSheet>
  );
}
