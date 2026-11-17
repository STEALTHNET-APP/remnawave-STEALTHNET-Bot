import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Database, Trash2 } from "lucide-react";

export type SubscriptionDeleteMode = "db" | "remna";

interface Props {
  open: boolean;
  count?: number;
  hasRemnaUser?: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (mode: SubscriptionDeleteMode) => void;
}

export function SubscriptionDeleteDialog({
  open,
  count = 1,
  hasRemnaUser = false,
  busy = false,
  error = null,
  onClose,
  onConfirm,
}: Props) {
  const plural = count === 1 ? "подписку" : `подписок: ${count}`;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Удалить {plural}</DialogTitle>
          <DialogDescription>
            Выберите, что сделать с записью в панели и профилем в Remnawave. Удаление из панели убирает подписку у клиента,
            но пользователь Remnawave остаётся и его можно привязать заново.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.03] p-3 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4" /> Удалить только из панели
            </div>
            <p className="text-[12px] text-muted-foreground">
              Запись исчезнет из базы панели. Пользователь в Remnawave сохранится вместе с трафиком и сроком.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-1 rounded-xl"
              disabled={busy}
              onClick={() => onConfirm("db")}
            >
              Удалить из панели
            </Button>
          </div>

          {hasRemnaUser && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/[0.06] p-3 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <Trash2 className="h-4 w-4" /> Удалить из панели и стереть в Remnawave
              </div>
              <p className="text-[12px] text-muted-foreground">
                Пользователь Remnawave будет удалён без возможности восстановления. Если UUID используется другой подпиской
                или клиентом, пользователь Remnawave останется нетронутым.
              </p>
              <Button
                variant="destructive"
                size="sm"
                className="mt-1 rounded-xl"
                disabled={busy}
                onClick={() => onConfirm("remna")}
              >
                Удалить в панели и Remnawave
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="rounded-xl" disabled={busy} onClick={onClose}>
              Отмена
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
