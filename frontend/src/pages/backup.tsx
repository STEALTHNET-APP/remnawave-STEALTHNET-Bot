import { useState } from "react";
import { useAuth } from "@/contexts/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import {
  Download,
  Upload,
  AlertTriangle,
  Loader2,
  RotateCcw,
  HardDrive,
  Clock,
  Send,
  Trash2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BackupItem = {
  path: string;
  filename: string;
  date: string;
  size: number;
  createdAt?: string;
  type?: "manual" | "automatic";
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(path: string): string {
  const parts = path.split("/");
  if (parts.length >= 3) return parts.slice(0, 3).join(".");
  return path;
}

function formatDateTime(item: BackupItem): string {
  if (item.createdAt) {
    const d = new Date(item.createdAt);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  return formatDate(item.date);
}

export function BackupPage() {
  const { state } = useAuth();
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoreFromPath, setRestoreFromPath] = useState<string | null>(null);

  const [deleteSinglePath, setDeleteSinglePath] = useState<string | null>(null);
  const [deletingSingle, setDeletingSingle] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const token = state.accessToken;
  if (!token) return null;

  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: qk.admin.backupList(),
    queryFn: () => api.getBackupList(token!).catch(() => ({ items: [] as BackupItem[] })),
    enabled: !!token,
  });
  const settingsQuery = useQuery({
    queryKey: qk.admin.settings(),
    queryFn: () => api.getSettings(token!),
    enabled: !!token,
  });
  const list = listQuery.data?.items ?? [];
  const listLoading = listQuery.isLoading;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const totalSize = (listQuery.data as any)?.totalSize ?? list.reduce((acc, it) => acc + (it.size || 0), 0);

  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean | null>(null);
  const [autoBackupCron, setAutoBackupCron] = useState<string | null>(null);
  const [autoBackupSaving, setAutoBackupSaving] = useState(false);
  const [autoBackupSending, setAutoBackupSending] = useState(false);
  const [autoBackupMsg, setAutoBackupMsg] = useState<string | null>(null);

  const [retentionValue, setRetentionValue] = useState<number | null>(null);
  const [retentionUnit, setRetentionUnit] = useState<"minutes" | "hours" | "days" | null>(null);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [cleaningNow, setCleaningNow] = useState(false);
  const [retentionMsg, setRetentionMsg] = useState<string | null>(null);

  const serverSettings = settingsQuery.data as any;
  const autoBackupEnabledValue = autoBackupEnabled ?? (serverSettings?.autoBackupEnabled ?? false);
  const autoBackupCronValue = autoBackupCron ?? (serverSettings?.autoBackupCron || "0 7 * * *");

  const retentionValueResolved = retentionValue ?? (serverSettings?.backupRetentionValue ?? serverSettings?.backupRetentionDays ?? 30);
  const retentionUnitResolved = retentionUnit ?? (serverSettings?.backupRetentionUnit ?? "days");

  async function saveAutoBackup() {
    const t = state.accessToken;
    if (!t) return;
    setAutoBackupSaving(true);
    try {
      await api.updateSettings(t, {
        autoBackupEnabled: autoBackupEnabledValue,
        autoBackupCron: autoBackupCronValue.trim() || "0 7 * * *",
      } as any);
      void queryClient.invalidateQueries({ queryKey: qk.admin.settings(), exact: false });
      flashAutoBackup(autoBackupEnabledValue ? "Авто-бэкапы включены" : "Авто-бэкапы выключены");
    } catch {
      flashAutoBackup("Ошибка сохранения");
    } finally {
      setAutoBackupSaving(false);
    }
  }

  async function saveRetention() {
    const t = state.accessToken;
    if (!t) return;
    setRetentionSaving(true);
    try {
      await api.updateSettings(t, {
        backupRetentionValue: retentionValueResolved,
        backupRetentionUnit: retentionUnitResolved,
      } as any);
      void queryClient.invalidateQueries({ queryKey: qk.admin.settings(), exact: false });
      void queryClient.invalidateQueries({ queryKey: qk.admin.backupList(), exact: false });
      flashRetention(retentionValueResolved === 0 ? "Срок хранения: вечно" : `Срок хранения сохранён (${retentionValueResolved} ${formatUnitLabel(retentionUnitResolved, retentionValueResolved)})`);
    } catch {
      flashRetention("Ошибка сохранения");
    } finally {
      setRetentionSaving(false);
    }
  }

  async function handleCleanupNow() {
    const t = state.accessToken;
    if (!t) return;
    setCleaningNow(true);
    try {
      const res = await api.cleanupBackupsNow(t);
      flashRetention(res.message);
      void queryClient.invalidateQueries({ queryKey: qk.admin.backupList(), exact: false });
    } catch (e) {
      flashRetention(e instanceof Error ? e.message : "Ошибка очистки");
    } finally {
      setCleaningNow(false);
    }
  }

  function formatUnitLabel(unit: "minutes" | "hours" | "days", count: number): string {
    if (unit === "minutes") return count === 1 ? "минута" : count < 5 ? "минуты" : "минут";
    if (unit === "hours") return count === 1 ? "час" : count < 5 ? "часа" : "часов";
    return count === 1 ? "день" : count < 5 ? "дня" : "дней";
  }

  function flashAutoBackup(msg: string) {
    setAutoBackupMsg(msg);
    setTimeout(() => setAutoBackupMsg(null), 4000);
  }

  function flashRetention(msg: string) {
    setRetentionMsg(msg);
    setTimeout(() => setRetentionMsg(null), 4000);
  }

  async function sendBackupNow() {
    const t = state.accessToken;
    if (!t) return;
    setAutoBackupSending(true);
    try {
      const res = await api.sendBackupToTelegram(t);
      flashAutoBackup(res.message || "Бэкап отправлен");
      void queryClient.invalidateQueries({ queryKey: qk.admin.backupList(), exact: false });
    } catch (e) {
      flashAutoBackup(e instanceof Error ? e.message : "Ошибка отправки");
    } finally {
      setAutoBackupSending(false);
    }
  }

  async function handleCreateBackup() {
    const t = state.accessToken;
    if (!t) return;
    setError(null);
    setSuccess(null);
    setCreating(true);
    try {
      const { blob, filename } = await api.createBackup(t);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess("Бэкап создан, сохранён на сервере и загружен.");
      void queryClient.invalidateQueries({ queryKey: qk.admin.backupList(), exact: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания бэкапа");
    } finally {
      setCreating(false);
    }
  }

  async function handleDownload(path: string) {
    const t = state.accessToken;
    if (!t) return;
    setError(null);
    try {
      const { blob, filename } = await api.downloadBackup(t, path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка скачивания");
    }
  }

  function handleRestoreFromServer(path: string) {
    setRestoreFromPath(path);
    setError(null);
  }

  async function handleRestoreFromServerConfirm() {
    const t = state.accessToken;
    if (!restoreFromPath || !t) return;
    setError(null);
    setSuccess(null);
    setRestoring(true);
    setRestoreFromPath(null);
    try {
      const result = await api.restoreBackupFromServer(t, restoreFromPath);
      setSuccess(result.message);
      void queryClient.invalidateQueries({ queryKey: qk.admin.backupList(), exact: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка восстановления");
    } finally {
      setRestoring(false);
    }
  }

  async function handleDeleteSingleConfirm() {
    const t = state.accessToken;
    if (!deleteSinglePath || !t) return;
    setError(null);
    setSuccess(null);
    setDeletingSingle(true);
    const pathToDelete = deleteSinglePath;
    setDeleteSinglePath(null);
    try {
      const res = await api.deleteBackup(t, pathToDelete);
      setSuccess(res.message || "Бэкап удалён.");
      void queryClient.invalidateQueries({ queryKey: qk.admin.backupList(), exact: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setDeletingSingle(false);
    }
  }

  async function handleDeleteAllConfirm() {
    const t = state.accessToken;
    if (!t) return;
    setError(null);
    setSuccess(null);
    setDeletingAll(true);
    setShowDeleteAllConfirm(false);
    try {
      const res = await api.deleteAllBackups(t);
      setSuccess(res.message || "Все бэкапы удалены.");
      void queryClient.invalidateQueries({ queryKey: qk.admin.backupList(), exact: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления бэкапов");
    } finally {
      setDeletingAll(false);
    }
  }

  function acceptRestoreFile(file: File | undefined | null) {
    setError(null);
    setSuccess(null);
    if (file) {
      if (!/\.sql(?:\.gz)?$/i.test(file.name)) {
        setError("Выберите файл бэкапа с расширением .sql или .sql.gz");
        setRestoreFile(null);
        return;
      }
      setRestoreFile(file);
      setShowRestoreConfirm(true);
    }
  }

  function handleRestoreSelect(e: React.ChangeEvent<HTMLInputElement>) {
    acceptRestoreFile(e.target.files?.[0]);
    e.target.value = "";
  }

  async function handleRestoreConfirm() {
    const t = state.accessToken;
    if (!restoreFile || !t) return;
    setError(null);
    setSuccess(null);
    setRestoring(true);
    setShowRestoreConfirm(false);
    try {
      const result = await api.restoreBackup(t, restoreFile);
      setSuccess(result.message);
      setRestoreFile(null);
      void queryClient.invalidateQueries({ queryKey: qk.admin.backupList(), exact: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка восстановления");
    } finally {
      setRestoring(false);
    }
  }

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
              Бэкапы
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">
              Создание, восстановление и автоматическая очистка БД.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Status messages */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </motion.div>
      )}
      {success && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500 dark:text-emerald-400"
        >
          {success}
        </motion.div>
      )}

      {/* Action cards: Create and Restore */}
      <div className="grid gap-4 md:grid-cols-2">
        <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
          <Card className="relative overflow-hidden bg-card border-border rounded-2xl p-5 h-full">
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-bold tracking-tight">Создать бэкап</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Дамп БД сохранится на сервере и скачается файлом.
                </p>
              </div>
            </div>
            <Button onClick={handleCreateBackup} disabled={creating} className="mt-4 w-full gap-2">
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Создание…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Создать и скачать
                </>
              )}
            </Button>
          </Card>
        </motion.div>

        <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
          <Card className="relative overflow-hidden bg-card border-border rounded-2xl p-5 h-full">
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-bold tracking-tight">Восстановить из файла</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Загрузите .sql или .sql.gz — текущие данные будут заменены.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <label
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (!restoring) acceptRestoreFile(e.dataTransfer.files?.[0]); }}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-amber-500/30 bg-amber-500/5 px-4 py-6 text-center transition-colors ${restoring ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-amber-500/50 hover:bg-amber-500/10"}`}
              >
                <Upload className="h-6 w-6 text-amber-500 dark:text-amber-400" />
                <span className="text-sm font-medium">Перетащи .sql или .sql.gz сюда или нажми для выбора</span>
                <span className="text-[11px] text-muted-foreground">Текущие данные будут заменены — подтверждение спросим отдельно</span>
                <input
                  type="file"
                  accept=".sql,.sql.gz,application/gzip,application/x-gzip"
                  onChange={handleRestoreSelect}
                  className="hidden"
                  disabled={restoring}
                />
              </label>
              {restoring && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Восстановление…
                </p>
              )}
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Retention and Auto-backup settings */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Retention / Auto-delete Card */}
        <Card className="relative overflow-hidden bg-card border-border rounded-2xl p-5 sm:p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center border border-border shrink-0 bg-muted text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold tracking-tight">
                Авто-очистка и хранение
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Автоматическое удаление устаревших бэкапов.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Время хранения бэкапа</Label>
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <Input
                  type="number"
                  min={0}
                  value={retentionValueResolved}
                  onChange={(e) => setRetentionValue(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="30"
                  className="w-24 text-sm h-9 rounded-xl bg-card border-border focus-visible:ring-primary/50"
                />
                <div className="flex rounded-lg border border-border p-0.5 bg-muted/40">
                  <button
                    type="button"
                    onClick={() => setRetentionUnit("minutes")}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                      retentionUnitResolved === "minutes"
                        ? "bg-card text-foreground shadow-sm font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    минут
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetentionUnit("hours")}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                      retentionUnitResolved === "hours"
                        ? "bg-card text-foreground shadow-sm font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    часов
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetentionUnit("days")}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                      retentionUnitResolved === "days"
                        ? "bg-card text-foreground shadow-sm font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    дней
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {retentionValueResolved === 0
                  ? "Бэкапы хранятся вечно (авто-очистка выключена)."
                  : `Бэкапы старше ${retentionValueResolved} ${formatUnitLabel(retentionUnitResolved, retentionValueResolved)} удаляются автоматически.`}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button size="sm" onClick={saveRetention} disabled={retentionSaving}>
                {retentionSaving ? "Сохранение…" : "Сохранить"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleCleanupNow} disabled={cleaningNow} className="gap-1.5">
                {cleaningNow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {cleaningNow ? "Очистка…" : "Очистить устаревшие"}
              </Button>
              {retentionMsg && (
                <span className="text-xs font-medium text-emerald-500 dark:text-emerald-400">{retentionMsg}</span>
              )}
            </div>
          </div>
        </Card>

        {/* Auto-backup card */}
        <Card className="relative overflow-hidden bg-card border-border rounded-2xl p-5 sm:p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center border border-border shrink-0 transition-colors",
              autoBackupEnabledValue
                ? "bg-muted text-emerald-500 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            )}>
              <Clock className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold tracking-tight flex items-center gap-2">
                Авто-бэкап в Telegram
                {autoBackupEnabledValue && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-medium border border-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    Активно
                  </span>
                )}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                SQL-бэкап в Telegram-группу по cron-расписанию.
              </p>
            </div>
            <button
              onClick={() => setAutoBackupEnabled(!autoBackupEnabledValue)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                autoBackupEnabledValue ? "bg-emerald-500" : "bg-muted-foreground/30"
              )}
            >
              <span className={cn(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-white ring-0 transition-transform",
                autoBackupEnabledValue ? "translate-x-5" : "translate-x-0"
              )} />
            </button>
          </div>

          <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Расписание (cron)</Label>
              <Input
                value={autoBackupCronValue}
                onChange={(e) => setAutoBackupCron(e.target.value)}
                placeholder="0 7 * * *"
                className="max-w-xs font-mono text-sm h-9 rounded-xl bg-card border-border focus-visible:ring-primary/50"
              />
              <p className="text-[11px] text-muted-foreground">
                По умолчанию: <code className="bg-foreground/[0.06] dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">0 7 * * *</code> — каждый день в 7:00 UTC
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button size="sm" onClick={saveAutoBackup} disabled={autoBackupSaving}>
                {autoBackupSaving ? "Сохранение…" : "Сохранить"}
              </Button>
              <Button variant="outline" size="sm" onClick={sendBackupNow} disabled={autoBackupSending} className="gap-1.5">
                <Send className="h-3.5 w-3.5" />
                {autoBackupSending ? "Отправка…" : "Отправить сейчас"}
              </Button>
              {autoBackupMsg && (
                <span className="text-xs font-medium text-emerald-500 dark:text-emerald-400">{autoBackupMsg}</span>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Saved backups list */}
      <Card className="relative overflow-hidden bg-card border-border rounded-2xl p-5 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold tracking-tight">Сохранённые на сервере</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {list.length > 0
                ? `Всего: ${list.length} ${list.length === 1 ? "файл" : list.length < 5 ? "файла" : "файлов"} · ${formatSize(totalSize)}`
                : "Бэкапы по дням — скачать, восстановить или удалить."}
            </p>
          </div>
          {list.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteAllConfirm(true)}
              disabled={deletingAll}
              className="gap-1.5 h-8 rounded-lg border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50 self-start sm:self-auto"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Удалить всё
            </Button>
          )}
        </div>

        {listLoading ? (
          <div className="py-12 flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Загрузка списка…</p>
          </div>
        ) : list.length === 0 ? (
          <div className="py-12 text-center">
            <HardDrive className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">Нет сохранённых бэкапов. Создайте первый.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-foreground/[0.04] dark:bg-white/[0.03] border-b border-border">
                    <th className="h-9 px-[13px] text-left font-medium text-muted-foreground text-xs">Дата и время</th>
                    <th className="h-9 px-[13px] text-left font-medium text-muted-foreground text-xs">Файл</th>
                    <th className="h-9 px-[13px] text-left font-medium text-muted-foreground text-xs">Размер</th>
                    <th className="h-9 px-[13px] text-right font-medium text-muted-foreground text-xs">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((item) => (
                    <tr key={item.path} className="border-b border-border last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-mono text-muted-foreground text-xs">{formatDateTime(item)}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{item.filename}</span>
                          {item.type === "automatic" && (
                            <span className="inline-flex items-center rounded bg-primary/10 text-primary px-1.5 py-0.2 text-[10px] font-medium border border-primary/20">
                              auto
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="inline-flex items-center rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] px-2.5 py-0.5 text-[11px] font-medium border border-border">
                          {formatSize(item.size)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        <Button variant="outline" size="sm" onClick={() => handleDownload(item.path)} className="gap-1 h-8 rounded-lg">
                          <Download className="h-3.5 w-3.5" />
                          Скачать
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-8 rounded-lg border-amber-500/30 text-amber-500 dark:text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50"
                          onClick={() => handleRestoreFromServer(item.path)}
                          disabled={restoring}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Восстановить
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-8 rounded-lg border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
                          onClick={() => setDeleteSinglePath(item.path)}
                          disabled={deletingSingle}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Удалить
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* Confirm dialogs */}
      <Dialog open={showRestoreConfirm} onOpenChange={setShowRestoreConfirm}>
        <DialogContent className="bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle>Восстановить из загруженного файла?</DialogTitle>
            <DialogDescription>
              Текущие данные в базе будут заменены содержимым выбранного файла. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowRestoreConfirm(false)}>Отмена</Button>
            <Button variant="destructive" onClick={handleRestoreConfirm}>Восстановить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!restoreFromPath} onOpenChange={(open) => !open && setRestoreFromPath(null)}>
        <DialogContent className="bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle>Восстановить из бэкапа на сервере?</DialogTitle>
            <DialogDescription>
              База будет заменена выбранным бэкапом. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRestoreFromPath(null)}>Отмена</Button>
            <Button variant="destructive" onClick={handleRestoreFromServerConfirm} disabled={restoring}>
              Восстановить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Single Backup Confirm Dialog */}
      <Dialog open={!!deleteSinglePath} onOpenChange={(open) => !open && setDeleteSinglePath(null)}>
        <DialogContent className="bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle>Удалить бэкап?</DialogTitle>
            <DialogDescription>
              Файл <code className="bg-muted px-1 py-0.5 rounded font-mono text-xs text-foreground">{deleteSinglePath?.split("/").pop()}</code> будет безвозвратно удалён с сервера.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteSinglePath(null)}>Отмена</Button>
            <Button variant="destructive" onClick={handleDeleteSingleConfirm} disabled={deletingSingle}>
              {deletingSingle ? "Удаление…" : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete All Backups Confirm Dialog */}
      <Dialog open={showDeleteAllConfirm} onOpenChange={setShowDeleteAllConfirm}>
        <DialogContent className="bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle>Удалить все сохранённые бэкапы?</DialogTitle>
            <DialogDescription>
              Все файлы бэкапов на сервере (всего: {list.length} шт., {formatSize(totalSize)}) будут безвозвратно удалены. Это освободит место на диске. Действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeleteAllConfirm(false)}>Отмена</Button>
            <Button variant="destructive" onClick={handleDeleteAllConfirm} disabled={deletingAll}>
              {deletingAll ? "Удаление…" : "Удалить всё"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
