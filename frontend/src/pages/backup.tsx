import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Upload, AlertTriangle, Loader2, RotateCcw, HardDrive } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BackupItem = { path: string; filename: string; date: string; size: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(path: string): string {
  const parts = path.split(".");
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${day}.${month}.${year}`;
  }
  return path;
}

export function BackupPage() {
  const { state } = useAuth();
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoreFromPath, setRestoreFromPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [list, setList] = useState<BackupItem[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const token = state.accessToken;
  if (!token) return null;

  async function loadList() {
    const t = state.accessToken;
    if (!t) return;
    setListLoading(true);
    try {
      const res = await api.getBackupList(t);
      setList(res.items);
    } catch {
      setList([]);
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    loadList();
  }, [state.accessToken]);

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
      await loadList();
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
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка восстановления");
    } finally {
      setRestoring(false);
    }
  }

  function handleRestoreSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    setSuccess(null);
    if (file) {
      if (!file.name.toLowerCase().endsWith(".sql")) {
        setError("Выберите файл бэкапа с расширением .sql");
        setRestoreFile(null);
        return;
      }
      setRestoreFile(file);
      setShowRestoreConfirm(true);
    }
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
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка восстановления");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Бэкапы</h1>
        <p className="text-muted-foreground mt-1">
          Создание и восстановление резервной копии базы данных. Бэкапы сохраняются на сервере по дням.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-500/50 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          {success}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Создать бэкап
            </CardTitle>
            <CardDescription>
              Создаёт дамп БД, сохраняет его на сервере (по дням) и отдаёт файл на скачивание.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleCreateBackup} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Создание…
                </>
              ) : (
                "Создать и скачать бэкап"
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Восстановить из файла
            </CardTitle>
            <CardDescription>
              Загрузить SQL-файл с компьютера. Текущие данные будут заменены.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              type="file"
              accept=".sql"
              onChange={handleRestoreSelect}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground file:cursor-pointer hover:file:bg-primary/90"
              disabled={restoring}
            />
            {restoring && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Восстановление…
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Сохранённые на сервере
          </CardTitle>
          <CardDescription>
            Бэкапы по дням. Скачать или восстановить из выбранного.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listLoading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка списка…
            </p>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8">Нет сохранённых бэкапов. Создайте первый.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-10 px-4 text-left font-medium">Дата</th>
                    <th className="h-10 px-4 text-left font-medium">Файл</th>
                    <th className="h-10 px-4 text-left font-medium">Размер</th>
                    <th className="h-10 px-4 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((item) => (
                    <tr key={item.path} className="border-b last:border-0">
                      <td className="px-4 py-3 font-mono text-muted-foreground">{formatDate(item.date)}</td>
                      <td className="px-4 py-3 font-mono">{item.filename}</td>
                      <td className="px-4 py-3">{formatSize(item.size)}</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => handleDownload(item.path)}>
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Скачать
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRestoreFromServer(item.path)}
                          disabled={restoring}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          Восстановить
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showRestoreConfirm} onOpenChange={setShowRestoreConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Восстановить из загруженного файла?</DialogTitle>
            <DialogDescription>
              Текущие данные в базе будут заменены содержимым выбранного файла. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRestoreConfirm(false)}>Отмена</Button>
            <Button variant="destructive" onClick={handleRestoreConfirm}>Восстановить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!restoreFromPath} onOpenChange={(open) => !open && setRestoreFromPath(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Восстановить из бэкапа на сервере?</DialogTitle>
            <DialogDescription>
              База будет заменена выбранным бэкапом. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreFromPath(null)}>Отмена</Button>
            <Button variant="destructive" onClick={handleRestoreFromServerConfirm} disabled={restoring}>
              Восстановить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
