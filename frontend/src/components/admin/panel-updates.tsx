import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type PanelUpdateState } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Schedule = NonNullable<PanelUpdateState["settings"]>;
const phases: Record<string, string> = {
  idle: "Готово к проверке", checking: "Проверка", ready: "Проверено", building: "Сборка",
  rehearsal: "Проверка на копии базы", backup: "Резервная копия", installing: "Установка", verifying: "Проверка запуска",
  success: "Обновлено", failed: "Обновление не выполнено", interrupted: "Нужна проверка на сервере",
};

export function PanelUpdates({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const key = ["panel-update", token];
  const query = useQuery({ queryKey: key, queryFn: () => api.getPanelUpdate(token), refetchInterval: 5000, retry: false });
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [dirty, setDirty] = useState(false);
  const data = query.data;
  useEffect(() => { if (data?.settings && !dirty) setDraft(data.settings); }, [data?.settings, dirty]);
  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: "check" | "install" | "settings"; body?: unknown }) => api.panelUpdateAction(token, action, body),
    onSuccess: (result, { action }) => {
      queryClient.setQueryData(key, result);
      if (action === "settings") setDirty(false);
    },
  });
  const busy = mutation.isPending || ["checking", "building", "rehearsal", "backup", "installing", "verifying"].includes(data?.status?.phase || "");
  const update = (value: Partial<Schedule>) => { if (draft) { setDraft({ ...draft, ...value }); setDirty(true); } };
  if (!data) return <p role="status">{query.error ? "Не удалось получить состояние обновления. Повторяем подключение…" : "Загружаем состояние обновления…"}</p>;
  return (
    <Card>
      <CardHeader><CardTitle>Обновления панели и бота</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><p className="text-sm text-muted-foreground">Установлена версия</p><p className="text-xl font-semibold">{data.installed.version}</p></div>
          <div><p className="text-sm text-muted-foreground">Коммит</p><p className="font-mono">{data.installed.commit && data.installed.commit !== "unknown" ? data.installed.commit.slice(0, 7) : "Не указан при сборке"}</p></div>
          <div><p className="text-sm text-muted-foreground">Дата сборки</p><p>{data.installed.builtAt ? new Date(data.installed.builtAt).toLocaleString() : "Не указана"}</p></div>
        </div>
        {!data.connected ? (
          <div className="rounded-lg border p-4 space-y-2">
            <p className="font-medium">Служба обновления ещё не установлена</p>
            <p className="text-sm text-muted-foreground">Администратору сервера нужно один раз установить службу и пересобрать панель. После этого обновления можно запускать здесь.</p>
            <a className="text-primary underline" href="https://github.com/STEALTHNET-APP/remnawave-STEALTHNET-Bot/blob/main/docs/auto-update.md" target="_blank" rel="noreferrer">Инструкция по установке</a>
          </div>
        ) : <>
          <div className="rounded-lg border p-4 space-y-2" role="status" aria-live="polite">
            <p className="font-medium">{phases[data.status?.phase || "idle"] || data.status?.phase}</p>
            <p className="text-sm">{data.status?.message}</p>
            {data.status?.available && <p>Доступна версия {data.status.version} · {data.status.target?.slice(0, 7)}</p>}
            {data.status?.blockedReason && <p className="text-amber-600 dark:text-amber-400">{data.status.blockedReason}</p>}
            {data.status?.recoveryRequired && <p className="text-destructive">Требуется восстановление или проверка служб на сервере. Автоматическая установка приостановлена, резервная копия сохранена.</p>}
            {data.status?.rolledBack && <p>Предыдущая версия восстановлена.</p>}
            {data.status?.backup && <p className="text-xs text-muted-foreground break-all">Резервная копия на сервере: {data.status.backup}</p>}
            {query.isError && <p>Переподключаемся к панели. Во время установки она может быть временно недоступна.</p>}
          </div>
          {data.status?.changes && <details><summary className="cursor-pointer">Что изменилось</summary><pre className="mt-2 whitespace-pre-wrap break-words text-sm">{data.status.changes}</pre></details>}
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" disabled={busy || dirty} onClick={() => mutation.mutate({ action: "check" })}>Проверить обновления</Button>
            <Button type="button" disabled={busy || dirty || !data.status?.available || data.status?.recoveryRequired || !!data.status?.blockedReason} onClick={() => {
              if (window.confirm("Установить обновление? Панель и бот будут временно недоступны. Перед установкой сохраним резервную копию.")) mutation.mutate({ action: "install" });
            }}>Обновить сейчас</Button>
          </div>
          {draft && <div className="space-y-4 border-t pt-4">
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(e) => update({ enabled: e.target.checked })} />Автоматически устанавливать обновления</label>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="update-channel">Источник обновлений</Label>
                <select id="update-channel" className="w-full rounded-md border bg-background p-2" value={draft.channel} disabled={busy} onChange={(e) => update({ channel: e.target.value as Schedule["channel"] })}>
                  <option value="stable">Получать только новые релизы</option><option value="main">Получать последние обновления</option>
                </select>
              </div>
              <div className="space-y-2"><Label htmlFor="update-hour">Ежедневно в этот час (UTC)</Label><Input id="update-hour" type="number" min={0} max={23} value={draft.hourUtc} disabled={busy || !draft.enabled} onChange={(e) => update({ hourUtc: e.target.valueAsNumber })} /></div>
            </div>
            <p className="text-sm text-muted-foreground">{draft.channel === "main" ? "Все изменения из main, включая исправления без нового номера версии." : "Устанавливаются только опубликованные стабильные релизы. Черновики и предварительные версии пропускаются."}</p>
            <p className="text-sm text-muted-foreground">Проверяем GitHub каждые 15 минут. Без включённой автоустановки панель только предложит обновиться. Перед установкой проверяем миграции на копии базы и сохраняем базу, настройки и файлы.</p>
            <div className="space-y-2"><Label htmlFor="backup-retention">Хранить резервные копии (дней)</Label><Input id="backup-retention" type="number" min={1} max={30} value={draft.backupRetentionDays ?? 3} disabled={busy} onChange={(e) => update({ backupRetentionDays: e.target.valueAsNumber })} /><p className="text-xs text-muted-foreground">Копия неудачного обновления сохраняется до восстановления, даже если срок истёк.</p></div>
            <Button type="button" disabled={busy || !dirty || !Number.isInteger(draft.backupRetentionDays) || draft.backupRetentionDays < 1 || draft.backupRetentionDays > 30 || !Number.isInteger(draft.hourUtc) || draft.hourUtc < 0 || draft.hourUtc > 23} onClick={() => mutation.mutate({ action: "settings", body: draft })}>Сохранить настройки обновления</Button>
          </div>}
          {!!data.backups?.length && <div className="space-y-2 border-t pt-4"><p className="font-medium">Резервные копии обновлений</p>{data.backups.map((backup) => <div key={backup.name} className="flex flex-wrap justify-between gap-2 text-sm"><span>{new Date(backup.createdAt).toLocaleString()}</span><span className="text-muted-foreground">{backup.protected ? "Сохранена для восстановления" : `Хранится до ${new Date(backup.expiresAt).toLocaleString()}`}{!backup.complete && " · неполная"}</span></div>)}</div>}
        </>}
        {mutation.error && <p role="alert" className="text-destructive">{mutation.error.message}</p>}
      </CardContent>
    </Card>
  );
}
