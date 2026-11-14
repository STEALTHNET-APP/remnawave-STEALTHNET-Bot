/**
 * T-subscription-remna (14.05.2026)
 *
 * Содержимое вкладки «Подписки» в карточке клиента. Грузит список ВСЕХ подписок
 * клиента (primary + secondary) через GET /admin/clients/:id/subscriptions
 * и для каждой подписки рисует раскрывающийся блок с <SubscriptionRemnaPanel>.
 *
 * Каждая подписка управляется независимо — лимиты, сквады, действия — всё
 * per-subscription.
 */
import { useState, useEffect, useCallback } from "react";
import { api, type AdminClientSubscriptionItem } from "@/lib/api";
import { SubscriptionRemnaPanel } from "./subscription-remna-panel";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { fmtMsk, fmtMskDate } from "@/lib/datetime";

interface Props {
  clientId: string;
  token: string;
  onChanged?: () => void;
}

export function ClientSubscriptionsTab({ clientId, token, onChanged }: Props) {
  const [items, setItems] = useState<AdminClientSubscriptionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [remnaSquads, setRemnaSquads] = useState<{ uuid: string; name?: string }[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getClientSubscriptionsList(token, clientId);
      setItems(res.items);
      // Раскрываем primary по умолчанию.
      const primary = res.items.find((s) => s.isPrimary);
      if (primary) setExpanded(new Set([primary.id]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки подписок");
    } finally {
      setLoading(false);
    }
  }, [clientId, token]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    // Грузим сквады один раз для всех подписок (один и тот же набор).
    api
      .getRemnaSquadsInternal(token)
      .then((raw: unknown) => {
        const res = raw as { response?: { internalSquads?: { uuid: string; name?: string }[] } };
        const arr = res?.response?.internalSquads ?? (Array.isArray(raw) ? (raw as { uuid: string; name?: string }[]) : []);
        setRemnaSquads(Array.isArray(arr) ? arr : []);
      })
      .catch(() => setRemnaSquads([]));
  }, [token]);

  function toggle(subId: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(subId)) n.delete(subId);
      else n.add(subId);
      return n;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка подписок…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4 text-sm text-destructive">
         {error}
        <Button size="sm" variant="ghost" className="ml-2" onClick={reload}>
          Повторить
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        У клиента нет подписок.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((sub) => {
        const isOpen = expanded.has(sub.id);
        return (
          <div
            key={sub.id}
            className="rounded-xl border border-border bg-foreground/[0.02] dark:bg-white/[0.02] overflow-hidden"
          >
            <button
              onClick={() => toggle(sub.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={
                      sub.isPrimary
                        ? "inline-flex items-center rounded-full bg-primary/10 border border-border px-2 py-0.5 text-[11px] font-semibold text-primary"
                        : "inline-flex items-center rounded-full bg-card border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                    }
                  >
                    {sub.isPrimary ? "Главная" : `#${sub.subscriptionIndex}`}
                  </span>
                  <span className="text-sm font-medium truncate">
                    {sub.tariffName ?? "— без тарифа —"}
                  </span>
                  {sub.giftStatus && (
                    <span className="text-[11px] text-amber-400"> {sub.giftStatus}</span>
                  )}
                  {sub.autoRenewEnabled && (
                    <span className="text-[11px] text-green-400"> auto-renew</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                {sub.expireAt && (
                  <span title={`Истекает: ${fmtMsk(sub.expireAt)}`}>
                    до {fmtMskDate(sub.expireAt)}
                  </span>
                )}
                {!sub.remnawaveUuid && (
                  <span className="text-yellow-400" title="Подписка не привязана к Remna">
                     нет Remna
                  </span>
                )}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-border p-4 bg-card">
                <SubscriptionRemnaPanel
                  subscription={sub}
                  token={token}
                  remnaSquads={remnaSquads}
                  onChanged={() => {
                    reload();
                    onChanged?.();
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
