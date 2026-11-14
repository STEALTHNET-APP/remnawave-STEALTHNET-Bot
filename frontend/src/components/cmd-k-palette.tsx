import { isSearchShortcut, usesCommandKey, OPEN_ADMIN_SEARCH } from "@/lib/search-shortcut";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
/**
 * Cmd+K (Ctrl+K) глобальный поиск-палитра. Открывается на любой странице.
 * Ввёл email/telegram/payment-id  попал в нужный раздел одним Enter'ом.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { Search, Loader2, Users, Receipt, Tag, Trophy, Gift, Ticket, ArrowDown, ArrowUp, CornerDownLeft } from "lucide-react";
import { quickSearchApi, type QuickSearchResult } from "@/lib/admin-extras-api";

const GROUP_META: Record<string, { label: string; icon: typeof Users; cls: string }> = {
  clients: { label: "Клиенты", icon: Users, cls: "text-emerald-600 dark:text-emerald-400" },
  payments: { label: "Платежи", icon: Receipt, cls: "text-blue-600 dark:text-blue-400" },
  tariffs: { label: "Тарифы", icon: Tag, cls: "text-amber-600 dark:text-amber-400" },
  contests: { label: "Конкурсы", icon: Trophy, cls: "text-violet-600 dark:text-violet-400" },
  promo_groups: { label: "Промо-группы", icon: Gift, cls: "text-pink-600 dark:text-pink-400" },
  promo_codes: { label: "Промокоды", icon: Ticket, cls: "text-cyan-600 dark:text-cyan-400" },
};

export function CmdKPalette() {
  const { state } = useAuth();
  const token = state.accessToken;
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<QuickSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const command = usesCommandKey();
    const resetSearch = () => { setQuery(""); setItems([]); setActiveIndex(0); };
    const openSearch = () => { setOpen(true); resetSearch(); };
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event, command)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      setOpen(value => !value);
      resetSearch();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(OPEN_ADMIN_SEARCH, openSearch);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(OPEN_ADMIN_SEARCH, openSearch);
    };
  }, []);

  // Auto-focus при открытии.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open || !token) return;
    if (!query.trim()) { setItems([]); setLoading(false); return; }
    let current = true;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const r = await quickSearchApi.search(token, query.trim());
        if (!current) return;
        setItems(r.items);
        setActiveIndex(0);
      } catch {
        if (!current) return;
        setItems([]);
      } finally {
        if (current) setLoading(false);
      }
    }, 200);
    return () => { current = false; clearTimeout(handle); };
  }, [query, open, token]);

  useEffect(() => { document.getElementById(`admin-search-result-${activeIndex}`)?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);

  const navigateTo = (item: QuickSearchResult) => {
    setOpen(false);
    navigate(item.url);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.max(0, Math.min(i + 1, items.length - 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && items[activeIndex]) { e.preventDefault(); navigateTo(items[activeIndex]); }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="admin-command max-w-2xl" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus(); }}>
        <DialogTitle className="sr-only">Поиск по панели</DialogTitle>
        <DialogDescription className="sr-only">Найдите клиента, платёж, тариф или промокод.</DialogDescription>
        <div className="admin-command-input">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 text-muted-foreground" />}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Поиск: email, telegram, payment-id, тариф, промокод…"
            className="admin-command-query"
            aria-label="Поиск по панели"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={items.length > 0}
            aria-controls="admin-search-results"
            aria-activedescendant={items[activeIndex] ? `admin-search-result-${activeIndex}` : undefined}
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">Esc</kbd>
        </div>

        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {query.trim()
              ? loading ? "Поиск…" : "Ничего не найдено"
              : "Введите email клиента, ID платежа, название тарифа или код промо."}
          </div>
        ) : (
          <ul id="admin-search-results" role="listbox" aria-label="Результаты поиска" className="max-h-[55vh] overflow-y-auto py-1">
            {items.map((item, idx) => {
              const meta = GROUP_META[item.group] ?? { label: item.group, icon: Search, cls: "text-foreground" };
              const Icon = meta.icon;
              return (
                <li
                  key={`${item.group}-${item.id}`}
                  id={`admin-search-result-${idx}`} role="option" aria-selected={idx === activeIndex}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => navigateTo(item)}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${idx === activeIndex ? "bg-accent" : ""}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${meta.cls}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.title}</div>
                    {item.subtitle ? <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div> : null}
                  </div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{meta.label}</span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span className="admin-command-hint"><ArrowUp size={13}/><ArrowDown size={13}/> выбор <CornerDownLeft size={13}/> открыть</span>
          <span><kbd className="rounded border bg-muted px-1 py-0.5 font-mono">Esc</kbd> закрыть</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
