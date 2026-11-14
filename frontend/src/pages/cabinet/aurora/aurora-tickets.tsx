import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, MessageCircle, AlertCircle, ChevronRight, History } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { AuroraNewTicketSheet } from "@/components/aurora/aurora-new-ticket-sheet";
import { AuroraTicketChatSheet } from "@/components/aurora/aurora-ticket-chat-sheet";
import { cn } from "@/lib/utils";

interface TicketItem {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

function statusLabel(status: string, t: (key: string) => string): string {
  if (status === "open") return t("aurora.ticket_open");
  if (status === "closed") return t("aurora.ticket_closed");
  if (status === "answered" || status === "awaiting" || status === "replied") return t("aurora.ticket_answered");
  return status;
}

function statusCls(status: string): string {
  if (status === "open") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (status === "answered" || status === "awaiting" || status === "replied") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-[var(--au-bg)] text-[var(--au-muted)]";
}

function fmtDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

export function AuroraTickets() {
  const { t, i18n } = useTranslation();
  const { state } = useClientAuth();
  const [items, setItems] = useState<TicketItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [chatTicketId, setChatTicketId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "history">("active");

  function load() {
    if (!state.token) return;
    setLoading(true);
    setErr(null);
    api
      .getTickets(state.token)
      .then((r) => setItems(r.items ?? []))
      .catch((e) => setErr(e instanceof Error ? e.message : t("aurora.tickets_load_error")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [state.token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("id");
    if (targetId) {
      setChatTicketId(targetId);
    }
  }, []);

  const openItems = (items ?? []).filter((item) => item.status === "open");
  const closedItems = (items ?? []).filter((item) => item.status !== "open");
  const visibleItems = tab === "active" ? openItems : closedItems;

  return (
    <div className="space-y-3">
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.support")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{t("aurora.support_subtitle")}</p>
      </header>

      <button
        type="button"
        onClick={() => setShowNew(true)}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--au-from)] px-5 text-[15.5px] font-bold text-white transition-transform active:scale-[0.99]"
      >
        <Plus className="h-[19px] w-[19px]" />
        {t("aurora.new_ticket")}
      </button>

      {!loading && !err && (
        <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-[var(--au-surface)] p-1">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={cn(
              "rounded-[11px] px-3 py-2 text-[13.5px] font-bold transition-colors",
              tab === "active" ? "bg-[var(--au-from)] text-white" : "text-[var(--au-muted)]",
            )}
          >
            {t("aurora.tickets_tab_active")} ({openItems.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("history")}
            className={cn(
              "rounded-[11px] px-3 py-2 text-[13.5px] font-bold transition-colors",
              tab === "history" ? "bg-[var(--au-from)] text-white" : "text-[var(--au-muted)]",
            )}
          >
            {t("aurora.tickets_tab_history")} ({closedItems.length})
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-[18px] bg-[var(--au-surface)]" />
          ))}
        </div>
      ) : err ? (
        <div className="flex items-start gap-2 rounded-[18px] bg-red-500/10 p-4 text-[13px] text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{err}</span>
        </div>
      ) : visibleItems.length === 0 ? (
        <section className="au-card grid justify-items-center gap-2 p-7 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-muted)]">
            {tab === "active" ? <MessageCircle className="h-6 w-6" /> : <History className="h-6 w-6" />}
          </span>
          <p className="mt-1 text-[15px] font-semibold text-[var(--au-ink)]">
            {tab === "active" ? t("aurora.tickets_empty_active_title") : t("aurora.tickets_empty_history_title")}
          </p>
          <p className="max-w-[280px] text-[13px] leading-relaxed text-[var(--au-muted)]">
            {tab === "active" ? t("aurora.tickets_empty_hint") : t("aurora.ticket_closed")}
          </p>
          {tab === "active" ? (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowNew(true)}
                className="flex min-h-10 items-center justify-center gap-2 rounded-[14px] bg-[var(--au-from)] px-4 text-[13.5px] font-bold text-white"
              >
                <Plus className="h-4 w-4" />
                {t("aurora.new_ticket")}
              </button>
              {closedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTab("history")}
                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-[14px] border border-[color-mix(in_srgb,var(--au-muted)_22%,transparent)] px-4 text-[13.5px] font-semibold text-[var(--au-ink)]"
                >
                  <History className="h-4 w-4" />
                  {t("aurora.tickets_tab_history")}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setTab("active")}
              className="mt-2 flex min-h-10 items-center justify-center gap-1.5 rounded-[14px] border border-[color-mix(in_srgb,var(--au-muted)_22%,transparent)] px-4 text-[13.5px] font-semibold text-[var(--au-ink)]"
            >
              {t("aurora.tickets_tab_active")}
            </button>
          )}
        </section>
      ) : (
        <section className="au-card overflow-hidden p-0">
          {visibleItems.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => setChatTicketId(item.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setChatTicketId(item.id);
                }
              }}
              className="flex w-full cursor-pointer items-center gap-3 border-b border-[color-mix(in_srgb,var(--au-muted)_14%,transparent)] px-4 py-3.5 text-left transition-colors last:border-b-0 active:bg-[var(--au-bg)]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-muted)]">
                <MessageCircle className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-semibold text-[var(--au-ink)]">{item.subject || t("aurora.ticket_no_subject")}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", statusCls(item.status))}>
                    {statusLabel(item.status, t)}
                  </span>
                  <span className="text-[12px] text-[var(--au-muted)]">
                    {fmtDate(item.status === "open" ? item.updatedAt : (item.closedAt ?? item.updatedAt), i18n.language)}
                  </span>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-[color-mix(in_srgb,var(--au-muted)_60%,transparent)]" />
            </div>
          ))}
        </section>
      )}

      <AuroraNewTicketSheet
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(id) => {
          load();
          setChatTicketId(id);
        }}
      />

      <AuroraTicketChatSheet
        open={chatTicketId !== null}
        ticketId={chatTicketId}
        onClose={() => {
          setChatTicketId(null);
          load();
        }}
        onStatusChange={load}
      />
    </div>
  );
}
