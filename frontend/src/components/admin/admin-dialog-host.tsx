import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminDialogStore } from "@/lib/admin-dialogs";

export function AdminDialogHost() {
  const request = useSyncExternalStore(adminDialogStore.subscribe, adminDialogStore.getSnapshot);
  const [value, setValue] = useState("");
  const cancelButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { pathname } = useLocation();
  useEffect(() => { setValue(request?.initial ?? ""); }, [request?.id]);
  useEffect(() => () => adminDialogStore.cancel(), [pathname]);
  if (!request) return null;
  const confirming = request.kind === "confirm";
  const destructive = confirming && /удал|отозв|отключ|отвяз|забрать|обнул|очист|delete|revoke|remove|reset/i.test(request.message);
  return <Dialog open onOpenChange={open => { if (!open) adminDialogStore.cancel(); }}>
    <DialogContent className="admin-action-dialog max-w-md" onOpenAutoFocus={event => { event.preventDefault(); (request.kind === "prompt" ? input.current : cancelButton.current)?.focus(); }}>
      <div className="admin-action-heading">{confirming ? <AlertTriangle size={20}/> : <Info size={20}/>}<DialogTitle>{confirming ? "Подтвердите действие" : request.kind === "prompt" ? "Введите значение" : "Сообщение"}</DialogTitle></div>
      <DialogDescription className="whitespace-pre-wrap break-words">{request.message}</DialogDescription>
      <form onSubmit={event => { event.preventDefault(); adminDialogStore.settle(request.kind === "prompt" ? value : true); }}>
        {request.kind === "prompt" && <Input ref={input} aria-label={request.message} value={value} onChange={event => setValue(event.target.value)} autoComplete="off"/>}
        <DialogFooter className="mt-5 gap-2">
          <Button ref={cancelButton} type="button" variant="outline" onClick={() => adminDialogStore.cancel()}>{request.kind === "alert" ? "Понятно" : "Отмена"}</Button>
          {request.kind !== "alert" && <Button type="submit" variant={destructive ? "destructive" : "default"}>{destructive ? "Подтвердить" : "Продолжить"}</Button>}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
