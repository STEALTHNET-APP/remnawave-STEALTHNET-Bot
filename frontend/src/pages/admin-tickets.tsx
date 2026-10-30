import { adminConfirm } from "@/lib/admin-dialogs";
import { useRef, useState, useEffect, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth";
import { api, type TicketAttachmentDto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Send,
  ArrowLeft,
  Lock,
  Unlock,
  CircleDot,
  CircleCheck,
  RefreshCw,
  Paperclip,
  X as XIcon,
  Trash2,
  Search,
  Clock,
  CheckCheck,
  MessageSquarePlus,
  SlidersHorizontal,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { fmtMskShort } from "@/lib/datetime";

// Синхронизировано с backend (uploadTicketAttachment).
const MAX_FILES = 5;
const MAX_FILE_MB = 10;

function AttachmentsGallery({ items }: { items: TicketAttachmentDto[] }) {
  if (!items || items.length === 0) return null;
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
  const qc = useQueryClient();

  // Filters & Search & Selection
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Detail view state
  const [detailId, setDetailId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  // Retention settings state
  const [showRetention, setShowRetention] = useState(false);
  const [retentionValue, setRetentionValue] = useState<number | string>(0);
  const [retentionUnit, setRetentionUnit] = useState<"minutes" | "hours" | "days">("days");

  // "Удалить всё" dialog state
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteScope, setDeleteScope] = useState<"closed" | "all">("closed");

  // Bulk reply modal state
  const [bulkReplyOpen, setBulkReplyOpen] = useState(false);
  const [bulkReplyText, setBulkReplyText] = useState("");
  const [bulkReplyFiles, setBulkReplyFiles] = useState<File[]>([]);
  const [bulkReplyCloseAfter, setBulkReplyCloseAfter] = useState(false);
  const [bulkReplyError, setBulkReplyError] = useState<string | null>(null);
  const bulkReplyInputRef = useRef<HTMLInputElement>(null);

  // Queries
  const status = filter === "open" || filter === "closed" ? filter : undefined;
  const listQuery = useQuery({
    queryKey: ["admin", "tickets", status ?? "all"] as const,
    queryFn: () => api.getAdminTickets(token, status),
    enabled: !!token,
    refetchInterval: 10000,
  });
  const list = listQuery.data?.items ?? [];
  const loading = listQuery.isFetching;

  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"] as const,
    queryFn: () => api.getSettings(token),
    enabled: !!token,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setRetentionValue(settingsQuery.data.ticketRetentionValue ?? 0);
      setRetentionUnit(settingsQuery.data.ticketRetentionUnit ?? "days");
    }
  }, [settingsQuery.data]);

  const detailQuery = useQuery({
    queryKey: ["admin", "ticket", detailId] as const,
    queryFn: () => api.getAdminTicket(token, detailId!),
    enabled: !!token && !!detailId,
    refetchInterval: 10000,
  });
  const detail = detailQuery.data ?? null;
  const detailLoading = detailQuery.isFetching;

  // Single reply file handling
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
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        setUploadError(`Файл больше ${MAX_FILE_MB} MB`);
        continue;
      }
      next.push(f);
    }
    setReplyFiles(next);
  };

  // Bulk reply file handling
  const addBulkReplyFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setBulkReplyError(null);
    const next: File[] = [...bulkReplyFiles];
    for (const f of Array.from(incoming)) {
      if (next.length >= MAX_FILES) {
        setBulkReplyError(`Не больше ${MAX_FILES} файлов`);
        break;
      }
      if (!f.type.startsWith("image/")) {
        setBulkReplyError("Можно прикладывать только изображения");
        continue;
      }
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        setBulkReplyError(`Файл больше ${MAX_FILE_MB} MB`);
        continue;
      }
      next.push(f);
    }
    setBulkReplyFiles(next);
  };

  // Mutations
  const replyMutation = useMutation({
    mutationFn: () => api.postAdminTicketMessage(token, detailId!, { content: replyText.trim(), files: replyFiles }),
    onSuccess: () => {
      setReplyText("");
      setReplyFiles([]);
      if (replyInputRef.current) replyInputRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["admin", "ticket", detailId], exact: false });
      void qc.invalidateQueries({ queryKey: ["admin", "tickets"], exact: false });
    },
    onError: (e) => setUploadError(e instanceof Error ? e.message : "Не удалось отправить"),
  });
  const replySending = replyMutation.isPending;

  const statusMutation = useMutation({
    mutationFn: (next: "open" | "closed") => api.patchAdminTicket(token, detail!.id, { status: next }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "ticket", detailId], exact: false });
      void qc.invalidateQueries({ queryKey: ["admin", "tickets"], exact: false });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAdminTicket(token, id),
    onSuccess: (_, deletedId) => {
      toast.success("Тикет удалён", "Обращение успешно удалено");
      if (detailId === deletedId) {
        setDetailId(null);
      }
      setSelectedIds((prev) => prev.filter((id) => id !== deletedId));
      void qc.invalidateQueries({ queryKey: ["admin", "tickets"], exact: false });
      void qc.invalidateQueries({ queryKey: ["admin", "ticket"], exact: false });
    },
    onError: (e) => {
      toast.error("Ошибка при удалении", e instanceof Error ? e.message : "Не удалось удалить тикет");
    },
  });

  const updateRetentionMutation = useMutation({
    mutationFn: () => {
      const parsed = typeof retentionValue === "number" ? retentionValue : parseInt(retentionValue, 10);
      const val = Number.isFinite(parsed) && parsed >= 0 ? Math.min(36500, Math.floor(parsed)) : 0;
      return api.updateSettings(token, {
        ticketRetentionValue: val,
        ticketRetentionUnit: retentionUnit,
      });
    },
    onSuccess: () => {
      toast.success("Настройки сохранены", "Срок хранения закрытых тикетов обновлён");
      void qc.invalidateQueries({ queryKey: ["admin", "settings"], exact: false });
    },
    onError: (e) => {
      toast.error("Ошибка сохранения", e instanceof Error ? e.message : "Не удалось сохранить настройки");
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: (scope: "closed" | "all") => api.deleteAllAdminTickets(token, { scope }),
    onSuccess: (res) => {
      toast.success("Очистка завершена", `Удалено тикетов: ${res.count}`);
      setDeleteAllOpen(false);
      setSelectedIds([]);
      setDetailId(null);
      void qc.invalidateQueries({ queryKey: ["admin", "tickets"], exact: false });
      void qc.invalidateQueries({ queryKey: ["admin", "ticket"], exact: false });
    },
    onError: (e) => {
      toast.error("Ошибка удаления", e instanceof Error ? e.message : "Не удалось очистить тикеты");
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: (nextStatus: "open" | "closed") =>
      api.bulkStatusAdminTickets(token, { ticketIds: selectedIds, status: nextStatus }),
    onSuccess: (res) => {
      toast.success(
        res.status === "closed" ? "Тикеты закрыты" : "Тикеты открыты",
        `Обновлено тикетов: ${res.updatedCount ?? res.count}`
      );
      setSelectedIds([]);
      void qc.invalidateQueries({ queryKey: ["admin", "tickets"], exact: false });
      void qc.invalidateQueries({ queryKey: ["admin", "ticket"], exact: false });
    },
    onError: (e) => {
      toast.error("Ошибка обновления", e instanceof Error ? e.message : "Не удалось обновить статус");
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => api.bulkDeleteAdminTickets(token, { ticketIds: selectedIds }),
    onSuccess: (res) => {
      toast.success("Тикеты удалены", `Удалено тикетов: ${res.count}`);
      setSelectedIds([]);
      void qc.invalidateQueries({ queryKey: ["admin", "tickets"], exact: false });
      void qc.invalidateQueries({ queryKey: ["admin", "ticket"], exact: false });
    },
    onError: (e) => {
      toast.error("Ошибка удаления", e instanceof Error ? e.message : "Не удалось удалить выбранные тикеты");
    },
  });

  const bulkReplyMutation = useMutation({
    mutationFn: () =>
      api.bulkReplyAdminTickets(token, {
        ticketIds: selectedIds,
        content: bulkReplyText.trim(),
        files: bulkReplyFiles,
        closeAfterReply: bulkReplyCloseAfter,
      }),
    onSuccess: (res) => {
      toast.success(
        "Массовый ответ отправлен",
        `Ответ доставлен в ${res.count} тикетов${res.closedAfterReply ? " (тикеты закрыты)" : ""}`
      );
      setBulkReplyOpen(false);
      setBulkReplyText("");
      setBulkReplyFiles([]);
      setBulkReplyCloseAfter(false);
      setSelectedIds([]);
      void qc.invalidateQueries({ queryKey: ["admin", "tickets"], exact: false });
      void qc.invalidateQueries({ queryKey: ["admin", "ticket"], exact: false });
    },
    onError: (e) => {
      setBulkReplyError(e instanceof Error ? e.message : "Не удалось отправить ответ");
    },
  });

  const sendReply = () => {
    if (!token || !detailId) return;
    if (!replyText.trim() && replyFiles.length === 0) return;
    replyMutation.mutate();
  };

  const toggleStatus = () => {
    if (!token || !detail) return;
    statusMutation.mutate(detail.status === "open" ? "closed" : "open");
  };

  const handleDeleteTicket = async (id: string, subject?: string) => {
    const msg = subject
      ? `Удалить тикет «${subject}» навсегда? Все сообщения и вложенные файлы будут удалены.`
      : "Удалить этот тикет навсегда? Все сообщения и вложенные файлы будут удалены.";
    if (!(await adminConfirm(msg))) return;
    deleteMutation.mutate(id);
  };

  const formatDate = (s: string) => {
    try {
      return fmtMskShort(s);
    } catch {
      return s;
    }
  };

  // Filtered list based on search
  const filteredList = list.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const clientLabel = `${t.client.email ?? ""} ${t.client.telegramUsername ?? ""} ${t.client.id}`;
    const lastMsg = t.lastMessage?.content ?? "";
    return (
      t.subject.toLowerCase().includes(q) ||
      clientLabel.toLowerCase().includes(q) ||
      lastMsg.toLowerCase().includes(q)
    );
  });

  const allFilteredSelected =
    filteredList.length > 0 && filteredList.every((t) => selectedIds.includes(t.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filteredList.some((t) => t.id === id)));
    } else {
      const idsToAdd = filteredList.map((t) => t.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...idsToAdd])));
    }
  };

  const toggleSelectTicket = (id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((item) => item !== id)
    );
  };

  /* Detail view */
  if (detailId && detail) {
    const isOpen = detail.status === "open";
    const clientLabel =
      detail.client.email ??
      (detail.client.telegramUsername ? `@${detail.client.telegramUsername}` : detail.client.id);
    return (
      <div className="flex flex-col gap-3.5 relative">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDetailId(null)}
              className="rounded-full hover:bg-card shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground truncate">
                {detail.subject}
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                {clientLabel} · обновлён {formatDate(detail.updatedAt)}
                {detail.closedAt && ` · закрыт ${formatDate(detail.closedAt)}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border",
                isOpen
                  ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-muted/40 text-muted-foreground border-border"
              )}
            >
              {isOpen ? <CircleDot className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}
              {isOpen ? "Открыт" : "Закрыт"}
            </span>
            <Button variant="outline" size="sm" onClick={toggleStatus} className="gap-1.5">
              {isOpen ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
              {isOpen ? "Закрыть" : "Открыть"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDeleteTicket(detail.id, detail.subject)}
              disabled={deleteMutation.isPending}
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
              title="Удалить тикет"
            >
              <Trash2 className="h-4 w-4" />
              Удалить
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

  /* List view */
  const openCount = list.filter((t) => t.status === "open").length;
  const waitingClientReplyCount = list.filter(
    (t) => t.status === "open" && t.lastMessage?.authorType === "client"
  ).length;

  const selectedTickets = list.filter((t) => selectedIds.includes(t.id));
  const selectedClosedCount = selectedTickets.filter((t) => t.status === "closed").length;
  const selectedOpenCount = selectedTickets.length - selectedClosedCount;

  return (
    <div className="flex flex-col gap-3.5 relative pb-20">
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
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary border border-border">
                Всего: {list.length}
              </span>
              {openCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 px-2.5 py-0.5 text-[11px] font-medium border border-emerald-500/20">
                  <CircleDot className="h-3 w-3" /> Открытых: {openCount}
                </span>
              )}
              {waitingClientReplyCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 px-2.5 py-0.5 text-[11px] font-medium border border-amber-500/20">
                  <Clock className="h-3 w-3" /> Ждут ответа: {waitingClientReplyCount}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRetention((v) => !v)}
            className={cn("gap-1.5", showRetention && "border-primary text-primary")}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Срок хранения
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteAllOpen(true)}
            className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Удалить всё…
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => void listQuery.refetch()}
            disabled={loading}
            className="rounded-full hover:bg-card"
            title="Обновить список"
          >
            <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loading && "animate-spin text-primary")} />
          </Button>
        </div>
      </motion.div>

      {/* Retention settings card */}
      <AnimatePresence>
        {showRetention && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <Card className="bg-card border-border rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    Время хранения тикетов после закрытия
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Закрытые обращения старше указанного срока автоматически удаляются фоновым процессом вместе со всеми вложенными файлами. Укажите 0, чтобы хранить бессрочно.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowRetention(false)}
                  className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
                <div className="flex items-center gap-2 flex-1 max-w-xs">
                  <Input
                    type="number"
                    min={0}
                    max={36500}
                    value={retentionValue}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        setRetentionValue("");
                        return;
                      }
                      const n = parseInt(raw, 10);
                      if (!Number.isNaN(n)) {
                        setRetentionValue(Math.max(0, Math.min(36500, n)));
                      }
                    }}
                    onBlur={() => {
                      if (retentionValue === "") {
                        setRetentionValue(0);
                      }
                    }}
                    className="w-28 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border"
                  />
                  <div className="flex items-center gap-1 bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-border">
                    {(
                      [
                        { key: "minutes", label: "Мин" },
                        { key: "hours", label: "Час" },
                        { key: "days", label: "Дней" },
                      ] as const
                    ).map((u) => (
                      <button
                        key={u.key}
                        type="button"
                        onClick={() => setRetentionUnit(u.key)}
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                          retentionUnit === u.key
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {u.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  size="sm"
                  onClick={() => updateRetentionMutation.mutate()}
                  disabled={updateRetentionMutation.isPending}
                  className="shrink-0"
                >
                  {updateRetentionMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Сохранить
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters & Search Toolbar */}
      <Card className="bg-card border-border rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter tabs */}
          <div className="flex items-center gap-1 bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-border">
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

          {/* Select all checkbox */}
          {filteredList.length > 0 && (
            <div className="flex items-center gap-2 pl-2">
              <Checkbox
                id="select-all-tickets"
                checked={allFilteredSelected}
                onCheckedChange={toggleSelectAll}
                className="rounded-md"
              />
              <Label
                htmlFor="select-all-tickets"
                className="text-xs text-muted-foreground cursor-pointer select-none"
              >
                Выбрать все ({filteredList.length})
              </Label>
            </div>
          )}
        </div>

        {/* Real-time search input */}
        <div className="relative min-w-[220px] md:max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Поиск по теме, клиенту или тексту..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-8 text-xs h-9 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </Card>

      {/* Tickets List */}
      {loading ? (
        <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем тикеты...</p>
        </Card>
      ) : filteredList.length === 0 ? (
        <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center text-center gap-3">
          <p className="text-muted-foreground">
            {searchQuery ? "Ничего не найдено по вашему запросу" : "Нет тикетов"}
          </p>
          {searchQuery && (
            <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
              Сбросить поиск
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredList.map((t, i) => {
            const isOpen = t.status === "open";
            const isSelected = selectedIds.includes(t.id);
            const clientLabel =
              t.client.email ??
              (t.client.telegramUsername ? `@${t.client.telegramUsername}` : t.client.id);

            // Last message author indicator
            const lastAuthor = t.lastMessage?.authorType;
            const waitingForSupport = isOpen && lastAuthor === "client";
            const supportReplied = isOpen && lastAuthor === "support";

            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                whileHover={{ y: -1 }}
              >
                <Card
                  onClick={() => setDetailId(t.id)}
                  className={cn(
                    "relative overflow-hidden cursor-pointer bg-card border-border rounded-xl p-3.5 sm:p-4 hover:border-primary/40 transition-all duration-200",
                    isSelected && "border-primary/60 bg-primary/[0.02]"
                  )}
                >
                  {/* Left accent bar */}
                  <div
                    className={cn(
                      "absolute left-0 top-0 bottom-0 w-1 rounded-r-full",
                      isOpen ? "bg-primary" : "bg-transparent"
                    )}
                  />

                  <div className="flex items-center gap-3">
                    {/* Multi-select checkbox */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.target === e.currentTarget) toggleSelectTicket(t.id, !isSelected);
                      }}
                      className="p-1 -m-1 cursor-pointer shrink-0"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => toggleSelectTicket(t.id, checked === true)}
                        className="rounded-md"
                      />
                    </div>

                    {/* Status icon */}
                    <div
                      className={cn(
                        "h-9 w-9 rounded-xl flex items-center justify-center shrink-0 border",
                        isOpen
                          ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
                          : "bg-muted/40 text-muted-foreground border-border"
                      )}
                    >
                      {isOpen ? <CircleDot className="h-4 w-4" /> : <CircleCheck className="h-4 w-4" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-sm truncate text-foreground">{t.subject}</p>

                        {/* Author/status badge */}
                        {waitingForSupport ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20">
                            <Clock className="h-3 w-3" />
                            Ждёт ответа
                          </span>
                        ) : supportReplied ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-sky-500/10 text-sky-500 dark:text-sky-400 border border-sky-500/20">
                            <CheckCheck className="h-3 w-3" />
                            Ответ дан
                          </span>
                        ) : !isOpen ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted/40 text-muted-foreground border border-border">
                            Закрыт
                          </span>
                        ) : null}
                      </div>

                      {/* Subtitle / client / date */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                        <span className="truncate max-w-[200px]">{clientLabel}</span>
                        <span>·</span>
                        <span>обновлён {formatDate(t.updatedAt)}</span>
                        {t.closedAt && (
                          <>
                            <span>·</span>
                            <span className="text-muted-foreground/80">закрыт {formatDate(t.closedAt)}</span>
                          </>
                        )}
                        {t.lastMessage?.content && (
                          <span className="hidden sm:inline-block truncate max-w-[280px] text-muted-foreground/70 italic">
                            — {t.lastMessage.content}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Delete single ticket button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTicket(t.id, t.subject);
                      }}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                      title="Удалить тикет"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Floating Bulk Actions Bar */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[95%] max-w-2xl"
          >
            <Card className="bg-card/95 backdrop-blur-md border border-primary/30 shadow-2xl rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 pl-1">
                <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  {selectedIds.length}
                </span>
                <span className="text-xs font-medium text-foreground hidden sm:inline">
                  выбрано
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {/* Bulk Reply */}
                <Button
                  size="sm"
                  onClick={() => setBulkReplyOpen(true)}
                  className="gap-1.5 text-xs h-8"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  Ответить
                </Button>

                {/* Bulk Close */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkStatusMutation.mutate("closed")}
                  disabled={bulkStatusMutation.isPending}
                  className="gap-1.5 text-xs h-8"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Закрыть
                </Button>

                {/* Bulk Open */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkStatusMutation.mutate("open")}
                  disabled={bulkStatusMutation.isPending}
                  className="gap-1.5 text-xs h-8"
                >
                  <Unlock className="h-3.5 w-3.5" />
                  Открыть
                </Button>

                {/* Bulk Delete */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if ((await adminConfirm(`Удалить выбранные тикеты (${selectedIds.length} шт.) навсегда? Все сообщения и файлы будут стёрты.`))) {
                      bulkDeleteMutation.mutate();
                    }
                  }}
                  disabled={bulkDeleteMutation.isPending}
                  className="gap-1.5 text-xs h-8 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Удалить
                </Button>

                {/* Clear selection */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedIds([])}
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  title="Снять выбор"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal: Удалить всё */}
      <Dialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Массовое удаление тикетов
            </DialogTitle>
            <DialogDescription>
              Выберите категорию обращений для безвозвратного удаления. Все сообщения и файлы на диске будут стёрты.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div
              onClick={() => setDeleteScope("closed")}
              className={cn(
                "p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3",
                deleteScope === "closed"
                  ? "border-primary bg-primary/[0.04]"
                  : "border-border hover:bg-foreground/[0.02]"
              )}
            >
              <input
                type="radio"
                name="deleteScope"
                checked={deleteScope === "closed"}
                onChange={() => setDeleteScope("closed")}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-semibold text-foreground">Только закрытые тикеты</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Удалить все завершённые обращения. Активные открытые тикеты останутся нетронутыми.
                </p>
              </div>
            </div>

            <div
              onClick={() => setDeleteScope("all")}
              className={cn(
                "p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3",
                deleteScope === "all"
                  ? "border-destructive bg-destructive/[0.04]"
                  : "border-border hover:bg-foreground/[0.02]"
              )}
            >
              <input
                type="radio"
                name="deleteScope"
                checked={deleteScope === "all"}
                onChange={() => setDeleteScope("all")}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-semibold text-destructive">Все тикеты безвозвратно</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Полная очистка: удалить все открытые и закрытые обращения и всю их историю.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setDeleteAllOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteAllMutation.mutate(deleteScope)}
              disabled={deleteAllMutation.isPending}
              className="gap-2"
            >
              {deleteAllMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Удалить {deleteScope === "closed" ? "закрытые" : "все тикеты"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Массовый ответ */}
      <Dialog open={bulkReplyOpen} onOpenChange={setBulkReplyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquarePlus className="h-5 w-5 text-primary" />
              Ответить выбранным ({selectedIds.length} шт.)
            </DialogTitle>
            <DialogDescription>
              Это сообщение будет добавлено от имени поддержки в каждый из выбранных тикетов. Клиенты получат оповещение.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {selectedClosedCount > 0 && (
              <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-500 dark:text-amber-400 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Среди выбранных: {selectedOpenCount > 0 ? `${selectedOpenCount} открытых и ` : ""}{selectedClosedCount} закрытых
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {bulkReplyCloseAfter
                    ? "Все тикеты останутся или перейдут в статус закрытых."
                    : "Закрытые тикеты будут автоматически переоткрыты после отправки ответа, чтобы продолжить диалог."}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="bulk-reply-text" className="text-xs text-muted-foreground">
                Текст ответа
              </Label>
              <Textarea
                id="bulk-reply-text"
                placeholder="Напишите ответ для клиентов…"
                value={bulkReplyText}
                onChange={(e) => setBulkReplyText(e.target.value)}
                rows={4}
                className="resize-none rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50 text-sm"
              />
            </div>

            {/* Attachments preview */}
            {bulkReplyFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {bulkReplyFiles.map((f, i) => (
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
                    <span className="text-[11px] text-muted-foreground max-w-[130px] truncate font-medium">
                      {f.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setBulkReplyFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                      aria-label="Удалить"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {bulkReplyError && (
              <p className="text-xs text-destructive font-semibold">{bulkReplyError}</p>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <input
                ref={bulkReplyInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => addBulkReplyFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => bulkReplyInputRef.current?.click()}
                disabled={bulkReplyFiles.length >= MAX_FILES}
                className="gap-2 text-xs"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Прикрепить фото ({bulkReplyFiles.length}/{MAX_FILES})
              </Button>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-close-after"
                  checked={bulkReplyCloseAfter}
                  onCheckedChange={(c) => setBulkReplyCloseAfter(!!c)}
                  className="rounded-md"
                />
                <Label
                  htmlFor="bulk-close-after"
                  className="text-xs text-muted-foreground cursor-pointer select-none"
                >
                  Закрыть тикеты после ответа
                </Label>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => {
                setBulkReplyOpen(false);
                setBulkReplyError(null);
              }}
            >
              Отмена
            </Button>
            <Button
              onClick={() => bulkReplyMutation.mutate()}
              disabled={
                bulkReplyMutation.isPending ||
                (!bulkReplyText.trim() && bulkReplyFiles.length === 0)
              }
              className="gap-2"
            >
              {bulkReplyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Отправить ответ ({selectedIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
