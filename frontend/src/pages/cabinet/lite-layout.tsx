import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { Button } from "@/components/ui/button";
import { TrialsPickerDialog } from "@/components/cabinet/trials-picker-dialog";
import { useState } from "react";

const routes = new Set(["/cabinet", "/cabinet/dashboard", "/cabinet/tariffs", "/cabinet/subscribe", "/cabinet/profile", "/cabinet/payments", "/cabinet/payment-wait", "/cabinet/menu/topup", "/cabinet/menu/trial", "/cabinet/menu/support", "/cabinet/tickets", "/cabinet/documents/privacy", "/cabinet/documents/offer", "/cabinet/documents/refund", "/cabinet/verify-link-email", "/cabinet/payment/success", "/cabinet/payment/fail", "/cabinet/payment"]);

export function LiteLayout() {
  const { pathname } = useLocation();
  const { state, logout } = useClientAuth();
  const config = useCabinetConfig();
  const [trialsOpen, setTrialsOpen] = useState(false);
  const home = pathname === "/cabinet" || pathname === "/cabinet/dashboard";
  const subscriptions = useQuery({ queryKey: ["lite-subscriptions", state.token], queryFn: () => api.clientAllSubscriptions(state.token!), enabled: !!state.token && home });
  const trials = useQuery({ queryKey: ["lite-trials", state.token], queryFn: () => api.getClientAvailableTrials(state.token!), enabled: !!state.token && home });
  if (!routes.has(pathname)) return <Navigate to="/cabinet/dashboard" replace />;
  return <div className="min-h-svh bg-background text-foreground">
    <header className="sticky top-0 z-40 border-b border-border bg-background p-4">
      <div className="mx-auto max-w-3xl flex flex-wrap items-center justify-between gap-3">
        <Link className="font-semibold" to="/cabinet/dashboard">{config?.serviceName || "Кабинет"}</Link>
        <nav className="flex gap-4 text-sm"><Link to="/cabinet/dashboard">Подписки</Link><Link to="/cabinet/tariffs">Купить</Link><Link to="/cabinet/menu/topup">Баланс</Link><Link to="/cabinet/login" onClick={() => logout()}>Выйти</Link></nav>
      </div>
    </header>
    <main className="mx-auto max-w-3xl px-4 py-6">
      {home ? <div className="space-y-5">
        <div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Мои подписки</h1><Button asChild><Link to="/cabinet/tariffs">Купить подписку</Link></Button></div>
        {subscriptions.isLoading && <p role="status">Загружаем подписки…</p>}
        {subscriptions.isError && <div role="alert"><p>Не удалось загрузить подписки.</p><Button variant="outline" onClick={() => void subscriptions.refetch()}>Повторить</Button></div>}
        {subscriptions.data?.items.length === 0 && <p className="text-muted-foreground">Подписок пока нет. Выберите тариф, чтобы подключиться.</p>}
        {subscriptions.data?.items.map(item => {
          const raw = item.subscription as Record<string, unknown> | null;
          const envelope = (raw?.response ?? raw?.data ?? raw) as Record<string, unknown> | null;
          const user = (envelope?.response ?? envelope) as Record<string, unknown> | null;
          const expiry = typeof user?.expireAt === "string" ? new Date(user.expireAt) : null;
          return <section key={item.id} className="rounded-xl border border-border p-5 space-y-3">
            <h2 className="font-semibold">{item.trialName || item.tariffDisplayName || `Подписка #${item.subscriptionIndex ?? 0}`}</h2>
            {expiry && Number.isFinite(expiry.getTime()) && <p className="text-sm">{expiry.getTime() > Date.now() ? "Действует до" : "Истекла"} {expiry.toLocaleDateString("ru-RU")}</p>}
            {"isBanned" in item && item.isBanned ? <p role="alert">{String(("banReason" in item && item.banReason) || "Подписка заблокирована")}</p> : <div className="flex flex-wrap gap-3">
              <Button asChild><Link to={`/cabinet/subscribe${item.remnawaveUuid ? `?uuid=${encodeURIComponent(item.remnawaveUuid)}` : ""}`}>Подключиться</Link></Button>
              {item.trialConvertEnabled !== false && <Button asChild variant="outline"><Link to={`/cabinet/tariffs?extend=${encodeURIComponent(item.id)}`}>Продлить</Link></Button>}
            </div>}
          </section>;
        })}
        {(trials.data?.items.length ?? 0) > 0 && <Button variant="outline" onClick={() => setTrialsOpen(true)}>Пробные подписки</Button>}
        {config?.trialEnabled && !state.client?.trialUsed && trials.data?.hasAnyEnabled === false && <Button asChild variant="outline"><Link to="/cabinet/menu/trial">Попробовать бесплатно</Link></Button>}
        <TrialsPickerDialog open={trialsOpen} token={state.token} onOpenChange={setTrialsOpen} onActivated={() => { void subscriptions.refetch(); void trials.refetch(); }} />
        {config?.supportLink && <a className="block text-sm underline" href={config.supportLink} target="_blank" rel="noreferrer">Поддержка</a>}
      </div> : <Outlet />}
    </main>
  </div>;
}
