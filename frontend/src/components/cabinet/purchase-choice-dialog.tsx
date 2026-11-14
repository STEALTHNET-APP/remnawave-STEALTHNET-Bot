import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type ExistingPurchaseSubscription = { id: string; label: string; expireAt: string | null };

export function PurchaseChoiceDialog({ subscriptions, onClose, onRenew, onNew }: {
  subscriptions: ExistingPurchaseSubscription[] | null;
  onClose: () => void;
  onRenew: (id: string) => void;
  onNew: () => void;
}) {
  return <Dialog open={subscriptions !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto">
      <DialogTitle>У вас уже есть подписка</DialogTitle>
      <DialogDescription>Продление сохранит текущую ссылку подключения. Отдельная подписка получит новую ссылку и будет оплачиваться отдельно.</DialogDescription>
      <div className="space-y-2">
        {subscriptions?.map(sub => <div key={sub.id} className="rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><p className="font-medium break-words">{sub.label}</p><p className="text-xs text-muted-foreground">{sub.expireAt && Number.isFinite(Date.parse(sub.expireAt)) ? `${Date.parse(sub.expireAt) > Date.now() ? "Действует до" : "Истекла"} ${new Date(sub.expireAt).toLocaleDateString()}` : "Срок не указан"}</p></div>
          <Button type="button" onClick={() => onRenew(sub.id)}>Продлить</Button>
        </div>)}
      </div>
      <Button type="button" variant="outline" onClick={onNew}>Создать отдельную подписку</Button>
      <Button type="button" variant="ghost" onClick={onClose}>Назад</Button>
    </DialogContent>
  </Dialog>;
}
