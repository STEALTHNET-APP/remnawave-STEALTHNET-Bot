/**
 * Stealth Tickets — поддержка/тикеты в Hundler-style.
 *
 * 2 состояния:
 *  - Empty (тикетов нет): outline-pill «+ Новое обращение» + большая
 *    карточка с envelope-иконкой + текст
 *  - List: outline-pill «+ Новое обращение» + список тикетов карточками
 *
 * Открытие конкретного тикета — навигация на classic-page (детальный экран
 * тикета с перепиской пока не портирован, но это нормально для Phase 3).
 */

import { useEffect, useState } from "react";
import { Plus, Mail, Loader2, History } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { StadiumButton } from "@/components/stealth/stadium-button";
import { StealthNewTicketModal } from "@/components/stealth/stealth-new-ticket-modal";
import { StealthTicketChatModal } from "@/components/stealth/stealth-ticket-chat-modal";
import { cn } from "@/lib/utils";

interface TicketItem {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

function statusColors(status: string): string {
  if (status === "open") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (status === "closed") return "bg-zinc-700/60 text-zinc-400 border-white/10";
  return "bg-amber-500/15 text-amber-400 border-amber-500/30";
}
function statusLabel(status: string): string {
  if (status === "open") return "Открыт";
  if (status === "closed") return "Закрыт";
  return status;
}
function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }); }
  catch { return iso; }
}

export function StealthTickets() {
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
    api.getTickets(state.token)
      .then((r) => setItems(r.items ?? []))
      .catch((e) => setErr(e instanceof Error ? e.message : "Не удалось загрузить обращения"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [state.token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("id");
    if (targetId) setChatTicketId(targetId);
  }, []);

  const goNew = () => setShowNew(true);
  const goTicket = (id: string) => setChatTicketId(id);

  const openItems = (items ?? []).filter((t) => t.status === "open");
  const closedItems = (items ?? []).filter((t) => t.status !== "open");
  const visibleItems = tab === "active" ? openItems : closedItems;

  return (
    <div className="px-4 pt-2 space-y-4 pb-2">
      {/* Top action — outline pill */}
      <StadiumButton variant="outline" size="md" iconLeft={<Plus className="h-4 w-4" />} onClick={goNew}>
        Новое обращение
      </StadiumButton>

      {!loading && !err && (
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.08] bg-zinc-900/40 p-1">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={cn(
              "rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition",
              tab === "active" ? "bg-zinc-800/80 text-zinc-100 border border-white/10" : "text-zinc-500 hover:text-zinc-300 border border-transparent",
            )}
          >
            Активные ({openItems.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("history")}
            className={cn(
              "rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition",
              tab === "history" ? "bg-zinc-800/80 text-zinc-100 border border-white/10" : "text-zinc-500 hover:text-zinc-300 border border-transparent",
            )}
          >
            История ({closedItems.length})
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-saccent-500" />
        </div>
      ) : err ? (
        <div className="rounded-2xl border border-saccent-500/30 bg-saccent-500/10 p-4 text-sm text-saccent-300">
          {err}
        </div>
      ) : visibleItems.length === 0 ? (
        // Empty state
        <div className="rounded-3xl border border-white/[0.08] bg-zinc-900/40 p-8 flex flex-col items-center text-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-zinc-800/80 border border-white/10 flex items-center justify-center">
            {tab === "active" ? <Mail className="h-6 w-6 text-zinc-300" /> : <History className="h-6 w-6 text-zinc-300" />}
          </div>
          <div>
            <h3 className="text-base font-bold">
              {tab === "active" ? "Нет активных обращений" : "История обращений пуста"}
            </h3>
            <p className="text-xs text-zinc-500 mt-1">
              {tab === "active" ? "Нажмите «Новое обращение», чтобы связаться с нами" : "Здесь появятся закрытые обращения"}
            </p>
          </div>
          {tab === "active" ? (
            <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
              <button
                type="button"
                onClick={goNew}
                className="h-10 px-4 rounded-xl bg-zinc-800/60 border border-white/10 text-zinc-200 text-xs font-semibold hover:bg-zinc-800 transition"
              >
                Новое обращение
              </button>
              {closedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTab("history")}
                  className="h-10 px-4 rounded-xl border border-white/10 text-zinc-300 text-xs font-semibold hover:bg-white/[0.03] transition"
                >
                  История обращений ({closedItems.length})
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setTab("active")}
              className="h-10 px-4 rounded-xl border border-white/10 text-zinc-300 text-xs font-semibold hover:bg-white/[0.03] transition mt-1"
            >
              Активные обращения
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 overflow-hidden divide-y divide-white/[0.04]">
          {visibleItems.map((t) => (
            <div
              key={t.id}
              onClick={() => goTicket(t.id)}
              className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-white/[0.03] transition cursor-pointer"
            >
              <div className="h-10 w-10 rounded-xl bg-zinc-800/60 border border-white/10 flex items-center justify-center shrink-0">
                <Mail className="h-4 w-4 text-zinc-300" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-sm truncate">{t.subject || "Без темы"}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={cn("rounded-md border px-1.5 py-0.5 font-bold uppercase tracking-wider", statusColors(t.status))}>
                    {statusLabel(t.status)}
                  </span>
                  <span className="text-zinc-500">{fmtDate(t.status === "open" ? t.updatedAt : (t.closedAt ?? t.updatedAt))}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <StealthNewTicketModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(id) => {
          load();
          // Сразу открываем chat созданного тикета
          setChatTicketId(id);
        }}
      />

      <StealthTicketChatModal
        open={chatTicketId !== null}
        ticketId={chatTicketId}
        onClose={() => { setChatTicketId(null); load(); /* refresh статусов после чата */ }}
        onStatusChange={load}
      />
    </div>
  );
}
