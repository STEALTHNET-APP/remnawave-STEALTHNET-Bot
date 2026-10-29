import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

type Agreement = { id: string; state: string; amount: number; currency: string; periodDays: number; nextChargeAt: string | null; trialEndsAt: string | null };
export function CloudPaymentsSubscriptions({ token }: { token: string }) {
  const [items, setItems] = useState<Agreement[]>([]);
  const [selected, setSelected] = useState<Agreement | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.cloudpaymentsSubscriptions(token).then(r => setItems(r.subscriptions)).catch(() => setError("Не удалось загрузить автоплатежи"));
  useEffect(() => { void load(); }, [token]);
  const active = items.filter(r => ["PENDING", "ACTIVE", "PAST_DUE", "CANCEL_PENDING"].includes(r.state));
  if (!active.length && !error) return null;
  return <section className="cabinet-surface space-y-4"><h2 className="text-lg font-semibold">Автоплатежи с карты</h2>{error && <p role="alert">{error}</p>}{active.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><div><p>{item.amount} {item.currency} / {item.periodDays} дней</p><p className="text-sm text-muted-foreground">{item.state === "PAST_DUE" ? "Последний платёж отклонён" : item.state === "CANCEL_PENDING" ? "Отмена обрабатывается" : item.nextChargeAt ? `Следующий платёж: ${new Date(item.nextChargeAt).toLocaleDateString("ru-RU")}` : "Ожидается первый платёж"}</p></div><Button variant="outline" onClick={() => setSelected(item)} disabled={item.state === "CANCEL_PENDING"}>Отключить</Button></div>)}<Dialog open={!!selected} onOpenChange={open => !busy && !open && setSelected(null)}><DialogContent><DialogHeader><DialogTitle>Отключить автоплатёж?</DialogTitle><DialogDescription>{selected?.trialEndsAt ? "Пробный доступ закроется сразу после отмены." : "Новых списаний не будет. Доступ сохранится до конца оплаченного срока."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>Оставить</Button><Button disabled={busy} onClick={async () => { if (!selected) return; setBusy(true); setError(""); try { await api.cloudpaymentsCancel(token, selected.id); setSelected(null); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось отменить автоплатёж"); } finally { setBusy(false); } }}>{busy ? "Отключение…" : "Отключить автоплатёж"}</Button></DialogFooter></DialogContent></Dialog></section>;
}
