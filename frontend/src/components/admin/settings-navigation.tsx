import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const GROUPS = {
  service: ["general", "theme", "landing", "subpage", "oauth"],
  sales: ["payments", "referral", "options", "custom-build", "gifts", "roulette", "nalog-settings"],
  communication: ["bot", "mail-telegram", "ai"],
  system: ["api", "sync", "proxy-settings", "server-ssh", "updates"],
};

export const SETTINGS_TABS = new Set(Object.values(GROUPS).flat());

export function SettingsNavigation({ activeTab, onChange, isAdmin }: {
  activeTab: string;
  onChange: (tab: string) => void;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const currentGroup = Object.entries(GROUPS).find(([, tabs]) => tabs.includes(activeTab))?.[0] ?? "service";
  const search = query.trim().toLocaleLowerCase();
  const visibleGroups = Object.entries(GROUPS).map(([id, tabs]) => ({
    id,
    tabs: tabs.filter((tab) => (tab !== "updates" || isAdmin) && (!search ||
      `${t(`admin.settings_navigation.sections.${tab}.label`)} ${t(`admin.settings_navigation.sections.${tab}.hint`)}`.toLocaleLowerCase().includes(search))),
  })).filter(({ tabs }) => tabs.length > 0);
  const selectTab = (tab: string) => {
    setQuery("");
    onChange(tab);
  };

  return (
    <section aria-label={t("admin.settings_navigation.title")} className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold">{t("admin.settings_navigation.title")}</p>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
            aria-label={t("admin.settings_navigation.search")} placeholder={t("admin.settings_navigation.search")}
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label={t("admin.settings_navigation.clear")}
            className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded hover:bg-muted">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>}
        </div>
      </div>
      {!search && <>
        <label className="mt-3 block sm:hidden">
          <span className="sr-only">{t("admin.settings_navigation.select")}</span>
          <select value={activeTab} onChange={(event) => selectTab(event.target.value)} className="min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
            {visibleGroups.map(({ id, tabs }) => <optgroup key={id} label={t(`admin.settings_navigation.groups.${id}`)}>
              {tabs.map((tab) => <option key={tab} value={tab}>{t(`admin.settings_navigation.sections.${tab}.label`)}</option>)}
            </optgroup>)}
          </select>
        </label>
        <div className="mt-3 hidden flex-wrap gap-1 border-b border-border pb-3 sm:flex" aria-label={t("admin.settings_navigation.groups_label")}>
          {visibleGroups.map(({ id, tabs }) => <button key={id} type="button" aria-pressed={currentGroup === id}
            onClick={() => selectTab(tabs.includes(activeTab) ? activeTab : tabs[0])}
            className={cn("min-h-10 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", currentGroup === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {t(`admin.settings_navigation.groups.${id}`)}
          </button>)}
        </div>
      </>}
      <nav aria-label={t("admin.settings_navigation.select")} className={cn("mt-3", !search && "hidden sm:block")}>
        {visibleGroups.filter(({ id }) => search || id === currentGroup).map(({ id, tabs }) => <div key={id} className="mb-3 last:mb-0">
          {search && <p className="mb-2 text-xs font-medium text-muted-foreground">{t(`admin.settings_navigation.groups.${id}`)}</p>}
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((tab) => <button key={tab} type="button" onClick={() => selectTab(tab)} aria-current={activeTab === tab ? "page" : undefined}
              className={cn("min-h-10 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", activeTab === tab ? "border-primary/30 bg-primary/10 font-medium text-primary" : "border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground")}>
              {t(`admin.settings_navigation.sections.${tab}.label`)}
            </button>)}
          </div>
        </div>)}
        {visibleGroups.length === 0 && <p role="status" className="py-2 text-sm text-muted-foreground">{t("admin.navigation.no_results")}</p>}
      </nav>
      <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">{t(`admin.settings_navigation.sections.${activeTab}.hint`)}</p>
    </section>
  );
}
