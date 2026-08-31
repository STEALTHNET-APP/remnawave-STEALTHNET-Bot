import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type TicketAttachmentDto, type TicketMessageDto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";
import {
  Loader2, Send, ArrowLeft, Lock, Unlock,
  CircleDot, CircleCheck, RefreshCw, Paperclip, X as XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMskShort } from "@/lib/datetime";

type TicketListItem = {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  client: { id: string; email: string | null; telegramUsername: string | null };
};
type TicketMessage = TicketMessageDto;

// Синхронизировано с backend (uploadTicketAttachment).
const MAX_FILES = 5;
const MAX_FILE_MB = 10;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

function AttachmentsGallery({ items }: { items: TicketAttachmentDto[] }) {
  if (!items || items.length === 0) return null;
  // Превью капается max-w 220px (single) / 160px (multi) с aspect-square +
  // object-cover для красивой плитки. Клик по превью открывает оригинал в
  // новой вкладке.
  const cellSize = items.length > 1 ? 160 : 220;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((a, i) => (
        <a
          key={`${a.url}-${i}`}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-xl border border-border bg-black/30 hover:opacity-90 transition-opacity shrink-0"
          style={{ width: cellSize, height: cellSize }}
          title={a.name ?? "Открыть оригинал"}
        >
          <img
            src={a.url}
            alt={a.name ?? "attachment"}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}

export function AdminTicketsPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? "";

  const [list, setList] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    id: string;
    subject: string;
    status: string;
    client: { id: string; email: string | null; telegramUsername: string | null };
    messages: TicketMessage[];
    createdAt: string;
    updatedAt: string;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setUploadError(null);
    const next: File[] = [...replyFiles];
    for (const f of Array.from(incoming)) {
      if (next.length >= MAX_FILES) {
        setUploadError(`Не больше ${MAX_FILES} файлов`);
        break;
      }
      if (!f.type.startsWith("image/")) {
        setUploadError("Можно прикладывать только изображения");
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setUploadError(`Файл больше ${MAX_FILE_MB} MB`);
        continue;
      }
      next.push(f);
    }
    setReplyFiles(next);
  };

  const loadList = () => {
    if (!token) return;
    const status = filter === "open" || filter === "closed" ? filter : undefined;
    api
      .getAdminTickets(token, status)
      .then((r) => {
        setList(r.items);
        setLoading(false);
      })
      .catch(() => {
        setList([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    loadList();
    const intervalId = window.setInterval(loadList, 10000);
    return () => {
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filter]);

  useEffect(() => {
    if (!detailId || !token) {
      setDetail(null);
      return;
    }
    const loadDetail = () => {
      setDetailLoading(true);
      api
        .getAdminTicket(token, detailId)
        .then(setDetail)
        .catch(() => setDetail(null))
        .finally(() => setDetailLoading(false));
    };
    loadDetail();
    const intervalId = window.setInterval(loadDetail, 10000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [detailId, token]);

  const sendReply = () => {
    if (!token || !detailId) return;
    if (!replyText.trim() && replyFiles.length === 0) return;
    setReplySending(true);
    setUploadError(null);
    api
      .postAdminTicketMessage(token, detailId, { content: replyText.trim(), files: replyFiles })
      .then((msg) => {
        setDetail((d) => (d ? { ...d, messages: [...d.messages, msg] } : d));
        setReplyText("");
        setReplyFiles([]);
        if (replyInputRef.current) replyInputRef.current.value = "";
      })
      .catch((e) => setUploadError(e instanceof Error ? e.message : "Не удалось отправить"))
      .finally(() => setReplySending(false));
  };

  const toggleStatus = () => {
    if (!token || !detail) return;
    const next = detail.status === "open" ? "closed" : "open";
    api.patchAdminTicket(token, detail.id, { status: next }).then(() => {
      setDetail((d) => (d ? { ...d, status: next } : d));
      setList((prev) => prev.map((t) => (t.id === detail.id ? { ...t, status: next } : t)));
    });
  };

  const formatDate = (s: string) => {
    try {
      return fmtMskShort(s);
    } catch {
      return s;
    }
  };

  /*  Detail view  */
  if (detailId && detail) {
    const isOpen = detail.status === "open";
    const clientLabel = detail.client.email ?? (detail.client.telegramUsername ? `@${detail.client.telegramUsername}` : detail.client.id);
    return (
      <div className="flex flex-col gap-3.5 relative">

        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => { setDetailId(null); setDetail(null); }} className="rounded-full hover:bg-card shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground truncate">
                {detail.subject}
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                {clientLabel} · обновлён {formatDate(detail.updatedAt)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border",
              isOpen
                ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
                : "bg-muted/40 text-muted-foreground border-border"
            )}>
              {isOpen ? <CircleDot className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}
              {isOpen ? "Открыт" : "Закрыт"}
            </span>
            <Button variant="outline" size="sm" onClick={toggleStatus} className="gap-1.5">
              {isOpen ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
              {isOpen ? "Закрыть" : "Открыть"}
            </Button>
          </div>
        </motion.div>

        <Card className="bg-card border-border rounded-2xl p-5 sm:p-4 space-y-4">
          <div className="space-y-3">
            {detail.messages.map((m, i) => {
              const isSupport = m.authorType === "support";
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={cn(
                    "rounded-xl px-4 py-3 text-sm border",
                    isSupport
                      ? "bg-primary/10 border-border ml-0 sm:ml-8"
                      : "bg-foreground/[0.03] dark:bg-white/[0.02] border-border mr-0 sm:mr-8"
                  )}
                >
                  <div className="flex justify-between gap-2 text-[11px] mb-1.5">
                    <span className={cn("font-semibold", isSupport ? "text-primary" : "text-muted-foreground")}>
                      {isSupport ? "Поддержка" : "Клиент"}
                    </span>
                    <span className="text-muted-foreground/80">{formatDate(m.createdAt)}</span>
                  </div>
                  {m.content && <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>}
                  <AttachmentsGallery items={m.attachments ?? []} />
                </motion.div>
              );
            })}
          </div>
          {isOpen && (
            <div className="flex flex-col gap-2 pt-3 border-t border-border">
              <Label htmlFor="admin-reply" className="text-xs text-muted-foreground">Ответ поддержки</Label>
              <Textarea
                id="admin-reply"
                placeholder="Введите ответ…"
                value={replyText}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReplyText(e.target.value)}
                rows={3}
                className="resize-none rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50"
              />
              {replyFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {replyFiles.map((f, i) => (
                    <div
                      key={`${f.name}-${i}`}
                      className="relative group flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-1.5"
                    >
                      <img
                        src={URL.createObjectURL(f)}
                        alt={f.name}
                        className="h-10 w-10 rounded-lg object-cover"
                        onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                      />
                      <span className="text-[11px] text-muted-foreground max-w-[140px] truncate font-medium">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => setReplyFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                        aria-label="Удалить"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {uploadError && (
                <p className="text-[11px] text-destructive font-semibold">{uploadError}</p>
              )}
              <div className="flex justify-between items-center gap-2">
                <input
                  ref={replyInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => replyInputRef.current?.click()}
                  disabled={replyFiles.length >= MAX_FILES}
                  className="gap-2"
                >
                  <Paperclip className="h-4 w-4" />
                  Фото ({replyFiles.length}/{MAX_FILES})
                </Button>
                <Button
                  onClick={sendReply}
                  disabled={replySending || (!replyText.trim() && replyFiles.length === 0)}
                  size="sm"
                  className="gap-2"
                >
                  {replySending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Отправить
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (detailId && detailLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <Button variant="ghost" size="sm" onClick={() => setDetailId(null)}>К списку</Button>
      </div>
    );
  }

  /*  List view  */
  const openCount = list.filter((t) => t.status === "open").length;

  return (
    <div className="flex flex-col gap-3.5 relative">

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
              Тикеты
            </h1>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary border border-border">
                Всего: {list.length}
              </span>
              {openCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 px-2.5 py-0.5 text-[11px] font-medium border border-emerald-500/20">
                  <CircleDot className="h-3 w-3" /> Открытых: {openCount}
                </span>
              )}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={loadList} disabled={loading} className="rounded-full hover:bg-card">
          <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loading && "animate-spin text-primary")} />
        </Button>
      </motion.div>

      {/* Filters */}
      <Card className="bg-card border-border rounded-2xl p-4">
        <div className="flex items-center gap-2 bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-border w-fit">
          {(["all", "open", "closed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-card"
              )}
            >
              {f === "all" ? "Все" : f === "open" ? "Открытые" : "Закрытые"}
            </button>
          ))}
        </div>
      </Card>

      {/* List */}
      {loading ? (
        <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем тикеты...</p>
        </Card>
      ) : list.length === 0 ? (
        <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center text-center gap-3">
          <p className="text-muted-foreground">Нет тикетов</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((t, i) => {
            const isOpen = t.status === "open";
            const clientLabel = t.client.email ?? (t.client.telegramUsername ? `@${t.client.telegramUsername}` : t.client.id);
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.025 }}
                whileHover={{ y: -2 }}
              >
                <Card
                  onClick={() => setDetailId(t.id)}
                  className={cn(
                    "relative overflow-hidden cursor-pointer bg-card border-border rounded-xl p-4 hover:border-border transition-all duration-300",
                  )}
                >
                  {/* Left accent bar */}
                  <div className={cn(
                    "absolute left-0 top-0 bottom-0 w-1 rounded-r-full ",
                    isOpen ? "bg-primary" : "bg-transparent"
                  )} />
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "h-9 w-9 rounded-xl flex items-center justify-center shrink-0 border",
                      isOpen
                        ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-muted/40 text-muted-foreground border-border"
                    )}>
                      {isOpen ? <CircleDot className="h-4 w-4" /> : <CircleCheck className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{t.subject}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                        <span className="truncate max-w-[200px]">{clientLabel}</span>
                        <span>·</span>
                        <span>{formatDate(t.updatedAt)}</span>
                      </div>
                    </div>
                    <span className="text-muted-foreground/40 shrink-0"></span>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
