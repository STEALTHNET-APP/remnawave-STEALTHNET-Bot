import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, Loader2, AlertCircle, Paperclip, ImageIcon, X, CheckCircle2, RotateCcw } from "lucide-react";
import { askConfirm } from "@/lib/confirm";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type TicketMessageDto } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  ticketId: string | null;
  onClose: () => void;
  onStatusChange?: () => void;
}

interface TicketDetail {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  messages: TicketMessageDto[];
}

const MAX_FILES = 5;
const POLL_MS = 8000;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AuroraTicketChatSheet({ open, ticketId, onClose, onStatusChange }: Props) {
  const { t } = useTranslation();
  const { state } = useClientAuth();
  const [data, setData] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [statusSending, setStatusSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    if (!state.token || !ticketId) return;
    setErr(null);
    try {
      setData(await api.getTicket(state.token, ticketId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось загрузить обращение");
    }
  }

  useEffect(() => {
    if (!open || !ticketId) return;
    setLoading(true);
    load().finally(() => setLoading(false));
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [open, ticketId, state.token]);

  useEffect(() => {
    if (data?.messages?.length) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [data?.messages?.length]);

  useEffect(() => {
    if (!open) {
      setReply("");
      setFiles([]);
      setData(null);
      setErr(null);
    }
  }, [open]);

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list)
      .slice(0, MAX_FILES - files.length)
      .filter((f) => ALLOWED_IMAGE_TYPES.has(f.type));
    setFiles((prev) => [...prev, ...arr].slice(0, MAX_FILES));
  }

  async function send() {
    if (!state.token || !ticketId) return;
    const trimmed = reply.trim();
    if (!trimmed && files.length === 0) return;
    setSending(true);
    setErr(null);
    try {
      await api.replyTicket(state.token, ticketId, {
        content: trimmed,
        files: files.length > 0 ? files : undefined,
      });
      setReply("");
      setFiles([]);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  }

  async function toggleStatus() {
    if (!state.token || !ticketId || !data || statusSending) return;
    const next = data.status === "closed" ? "open" : "closed";
    if (next === "closed") {
      const ok = await askConfirm(t("aurora.ticket_close_confirm"));
      if (!ok) return;
    }
    setStatusSending(true);
    setErr(null);
    try {
      const updated = await api.updateTicketStatus(state.token, ticketId, next);
      setData((prev) =>
        prev
          ? { ...prev, status: updated.status, closedAt: updated.closedAt ?? null, updatedAt: updated.updatedAt }
          : prev,
      );
      onStatusChange?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("aurora.ticket_status_error"));
    } finally {
      setStatusSending(false);
    }
  }

  const isClosed = data?.status === "closed";

  return (
    <AuroraSheet
      open={open}
      onClose={onClose}
      title={data?.subject || "Обращение"}
      footer={
        isClosed ? (
          <div className="space-y-2 rounded-[16px] bg-[var(--au-surface)] px-4 py-3.5 text-center">
            <p className="text-[13px] text-[var(--au-muted)]">{t("aurora.ticket_closed_notice")}</p>
            <button
              type="button"
              onClick={toggleStatus}
              disabled={statusSending}
              className="mx-auto flex min-h-10 items-center justify-center gap-2 rounded-[14px] border border-[color-mix(in_srgb,var(--au-muted)_22%,transparent)] px-4 text-[13.5px] font-semibold text-[var(--au-ink)] disabled:opacity-50"
            >
              {statusSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {t("aurora.ticket_reopen")}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {files.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {files.map((f, idx) => (
                  <div
                    key={idx}
                    className="relative flex flex-col items-center gap-1 rounded-[14px] bg-[var(--au-surface)] p-2 text-center"
                  >
                    <ImageIcon className="h-4 w-4 text-[var(--au-muted)]" />
                    <p className="w-full truncate text-[11px] text-[var(--au-muted)]">{f.name}</p>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label="Убрать фото"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[var(--au-muted)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={files.length >= MAX_FILES || sending}
                aria-label="Прикрепить фото"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--au-muted)_22%,transparent)] bg-[var(--au-surface)] text-[var(--au-muted)] transition-all hover:text-[var(--au-ink)] enabled:active:scale-95 disabled:opacity-45"
              >
                <Paperclip className="h-[20px] w-[20px]" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(e) => {
                  pickFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={1}
                placeholder="Сообщение"
                className="max-h-28 min-h-[48px] min-w-0 flex-1 resize-none rounded-[20px] border border-[color-mix(in_srgb,var(--au-muted)_22%,transparent)] bg-[var(--au-surface)] px-4 py-3 text-[16px] text-[var(--au-ink)] outline-none transition-all placeholder:text-[var(--au-muted)] focus:border-[var(--au-from)] focus:ring-2 focus:ring-[var(--au-from)]/25"
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || (!reply.trim() && files.length === 0)}
                aria-label="Отправить"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white transition-transform enabled:active:scale-95 disabled:opacity-45"
              >
                {sending ? <Loader2 className="h-[20px] w-[20px] animate-spin" /> : <Send className="h-[20px] w-[20px]" />}
              </button>
            </div>
          </div>
        )
      }
    >
      {data && (
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--au-muted)_14%,transparent)] pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--au-muted)]">Статус:</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-bold",
                isClosed ? "bg-[var(--au-surface)] text-[var(--au-muted)]" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
              )}
            >
              {isClosed ? t("aurora.ticket_closed") : t("aurora.ticket_open")}
            </span>
          </div>
          <button
            type="button"
            onClick={toggleStatus}
            disabled={statusSending}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-[14px] border border-[color-mix(in_srgb,var(--au-muted)_22%,transparent)] bg-[var(--au-surface)] px-3 text-xs font-semibold text-[var(--au-ink)] transition-all hover:border-[color-mix(in_srgb,var(--au-muted)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--au-surface)_85%,var(--au-muted)_15%)] active:scale-[0.98] disabled:opacity-50"
            title={isClosed ? t("aurora.ticket_reopen") : t("aurora.ticket_close")}
          >
            {statusSending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isClosed ? (
              <RotateCcw className="h-3.5 w-3.5" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            <span className="hidden min-[380px]:inline">{isClosed ? t("aurora.ticket_reopen") : t("aurora.ticket_close")}</span>
            <span className="min-[380px]:hidden">{isClosed ? t("aurora.ticket_reopen_short") : t("aurora.ticket_close_short")}</span>
          </button>
        </div>
      )}
      {loading && !data ? (
        <div className="space-y-2.5 py-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                "h-14 animate-pulse rounded-[18px] bg-[var(--au-surface)]",
                i % 2 === 0 ? "mr-16" : "ml-16",
              )}
            />
          ))}
        </div>
      ) : err && !data ? (
        <div className="flex items-start gap-2 rounded-[16px] bg-[#FDECEA] p-3.5 text-[13px] text-[#8B1D13]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{err}</span>
        </div>
      ) : !data?.messages?.length ? (
        <p className="py-8 text-center text-[13px] text-[var(--au-muted)]">Сообщений пока нет</p>
      ) : (
        <div className="space-y-2.5 pb-1">
          {data.messages.map((m) => {
            const isClient = m.authorType === "client";
            return (
              <div key={m.id} className={cn("flex", isClient ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[82%] rounded-[18px] px-3.5 py-2.5",
                    isClient
                      ? "bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white"
                      : "bg-[var(--au-surface)]",
                  )}
                >
                  {m.content && (
                    <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{m.content}</p>
                  )}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {m.attachments.map((att, i) => (
                        <a
                          key={i}
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block overflow-hidden rounded-[12px] bg-white/25"
                        >
                          {att.mime.startsWith("image/") ? (
                            <img src={att.url} alt="" className="h-20 w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-20 items-center justify-center">
                              <ImageIcon className="h-5 w-5" />
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                  <p
                    className={cn(
                      "mt-1 text-[11px] tabular-nums",
                      isClient ? "text-white/70" : "text-[var(--au-muted)]",
                    )}
                  >
                    {fmtTime(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />

          {err && (
            <div className="flex items-start gap-2 rounded-[16px] bg-[#FDECEA] p-3.5 text-[13px] text-[#8B1D13]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{err}</span>
            </div>
          )}
        </div>
      )}
    </AuroraSheet>
  );
}
