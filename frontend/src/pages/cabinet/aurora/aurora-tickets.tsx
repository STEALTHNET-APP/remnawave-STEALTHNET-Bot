/**
 * AuroraTickets — вкладка «Поддержка» третьего дизайна мини-аппа.
 *
 * Композиция:
 *   • заголовок и кнопка «Новое обращение»;
 *   • список обращений карточками со статусом и датой последнего ответа;
 *   • пустое состояние, если обращений ещё не было.
 *
 * Создание и переписка открываются нижними шторками Aurora — теми же
 * вызовами API, что и в остальных дизайнах (`getTickets`, `createTicket`,
 * `getTicket`, `replyTicket`).
 */

import { useEffect, useState } from "react";
import { Plus, MessageCircle, ChevronRight, AlertCircle } from "lucide-react";
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
}

function statusLabel(status: string): string {
  if (status === "open") return "Открыт";
  if (status === "closed") return "Закрыт";
  return status;
}

/** Открытому обращению — зелёный, закрытому — серый, остальным — янтарный. */
function statusCls(status: string): string {
  if (status === "open") return "bg-[#E7F6EE] text-[#0F7A45]";
  if (status === "closed") return "bg-white text-[var(--au-muted)]";
  return "bg-[#FFF7E8] text-[#7A4E00]";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

export function AuroraTickets() {
  const { state } = useClientAuth();
  const [items, setItems] = useState<TicketItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [chatTicketId, setChatTicketId] = useState<string | null>(null);

  function load() {
    if (!state.token) return;
    setLoading(true);
    setErr(null);
    api
      .getTickets(state.token)
      .then((r) => setItems(r.items ?? []))
      .catch((e) => setErr(e instanceof Error ? e.message : "Не удалось загрузить обращения"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.token]);

  return (
    <div className="space-y-3">
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Поддержка</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">Ответим в чате — обычно в течение дня</p>
      </header>

      <button
        type="button"
        onClick={() => setShowNew(true)}
        className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-5 py-4 text-[17px] font-bold text-white shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--au-from)_70%,transparent)] transition-transform active:scale-[0.99]"
      >
        <Plus className="h-[20px] w-[20px]" />
        Новое обращение
      </button>

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-[20px] bg-[var(--au-surface)]" />
          ))}
        </div>
      ) : err ? (
        <div className="flex items-start gap-2 rounded-[20px] bg-[#FDECEA] p-4 text-[13px] text-[#8B1D13]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{err}</span>
        </div>
      ) : !items || items.length === 0 ? (
        <section className="rounded-[26px] bg-[var(--au-surface)] p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white">
            <MessageCircle className="h-6 w-6 text-[var(--au-muted)]" />
          </span>
          <p className="mt-3 text-[15px] font-semibold">Обращений пока нет</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--au-muted)]">
            Если что-то не работает или есть вопрос — напишите нам, поможем.
          </p>
        </section>
      ) : (
        <div className="space-y-2.5">
          {items.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setChatTicketId(t.id)}
              className="flex w-full items-center gap-3 rounded-[20px] bg-[var(--au-surface)] p-4 text-left transition-transform active:scale-[0.99]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white">
                <MessageCircle className="h-5 w-5 text-[var(--au-muted)]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{t.subject || "Без темы"}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-bold", statusCls(t.status))}>
                    {statusLabel(t.status)}
                  </span>
                  <span className="text-[12.5px] text-[var(--au-muted)]">{fmtDate(t.updatedAt)}</span>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-[var(--au-muted)]" />
            </button>
          ))}
        </div>
      )}

      <AuroraNewTicketSheet
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(id) => {
          load();
          // Сразу открываем переписку по созданному обращению.
          setChatTicketId(id);
        }}
      />

      <AuroraTicketChatSheet
        open={chatTicketId !== null}
        ticketId={chatTicketId}
        onClose={() => {
          setChatTicketId(null);
          load(); // статус мог измениться, пока шла переписка
        }}
      />
    </div>
  );
}
