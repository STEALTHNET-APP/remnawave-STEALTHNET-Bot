import { useState } from "react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function CloudPaymentsTrial() {
  const { state } = useClientAuth();
  const config = useCabinetConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!state.token || state.client?.trialUsed || !config?.cloudpaymentsEnabled || !config.cloudpaymentsTrialTariffId || !config.cloudpaymentsTrialDays) return null;
  return <section className="cabinet-surface mb-6 flex flex-wrap items-center justify-between gap-4 p-5">
    <div><h2 className="font-semibold">Пробный доступ за {config.cloudpaymentsTrialAmount ?? 1} ₽</h2><p className="text-sm text-muted-foreground">{config.cloudpaymentsTrialDays} дней, затем оплата тарифа с карты. Условия — перед оплатой.</p>{error && <p role="alert" className="mt-2 text-sm">{error}</p>}</div>
    <Button variant="outline" disabled={busy} onClick={async () => {
      if (!state.token || !config.cloudpaymentsTrialTariffId) return;
      setBusy(true); setError("");
      try { const payment = await api.cloudpaymentsCreatePayment(state.token, { tariffId: config.cloudpaymentsTrialTariffId, paidTrial: true }); window.location.assign(payment.payUrl); }
      catch (e) { setError(e instanceof Error ? e.message : "Не удалось создать счёт"); }
      finally { setBusy(false); }
    }}>{busy ? "Подготовка…" : "Посмотреть условия"}</Button>
  </section>;
}
