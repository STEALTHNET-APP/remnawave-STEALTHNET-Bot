/**
 * AuroraTicketChatSheet — переписка по обращению (дизайн Aurora).
 *
 * Сообщения клиента — справа градиентным пузырём, ответы поддержки — слева
 * светлым. Вложения показываем миниатюрами со ссылкой на оригинал.
 *
 * Поведение перенесено из Stealth-версии: загрузка `getTicket`, опрос раз в
 * 8 секунд (чтобы видеть ответы поддержки без ручного обновления),
 * автопрокрутка вниз при новых сообщениях, отправка через `replyTicket`
 * с возможностью приложить до пяти картинок. У закрытого обращения поле
 * ввода скрыто.
 */

import { useEffect, useRef, useState } from "react";
import { Send, Loader2, AlertCircle, Paperclip, ImageIcon, X } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type TicketMessageDto } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  ticketId: string | null;
  onClose: () => void;
}

interface TicketDetail {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessageDto[];
}

const MAX_FILES = 5;
const POLL_MS = 8000;

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

export function AuroraTicketChatSheet({ open, ticketId, onClose }: Props) {
  const { state } = useClientAuth();
  const [data, setData] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
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

  // Первая загрузка + опрос: ответ поддержки должен появляться сам.
  useEffect(() => {
    if (!open || !ticketId) return;
    setLoading(true);
    load().finally(() => setLoading(false));
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      .filter((f) => f.type.startsWith("image/"));
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

  const isClosed = data?.status === "closed";

  return (
    <AuroraSheet
      open={open}
      onClose={onClose}
      title={data?.subject || "Обращение"}
      footer={
        isClosed ? (
          <p className="rounded-[16px] bg-[var(--au-surface)] px-4 py-3.5 text-center text-[13px] text-[var(--au-muted)]">
            Обращение закрыто. Если вопрос остался — создайте новое.
          </p>
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
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-muted)] transition-transform enabled:active:scale-95 disabled:opacity-45"
              >
                <Paperclip className="h-[20px] w-[20px]" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
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
                // 16px — иначе iOS приближает страницу на фокусе
                className="max-h-28 min-h-[48px] flex-1 resize-none rounded-[20px] bg-[var(--au-surface)] px-4 py-3 text-[16px] outline-none placeholder:text-[var(--au-muted)]"
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
          {/* якорь автопрокрутки */}
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
