import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ReceiptText } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useClientPayments } from "@/lib/queries";
import { formatCabinetMoney } from "@/lib/cabinet-format";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function ClientHistoryPage() {
  const { state } = useClientAuth();
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<"payments" | "actions">("payments");
  const [page, setPage] = useState(1);
  const payments = useClientPayments(state.token);
  const items = payments.data?.items ?? [];
  const history = useQuery({ queryKey: ["gifts", "history", state.token, page], queryFn: () => api.giftGetHistory(state.token!, page), enabled: !!state.token && tab === "actions" });
  return <div className="cabinet-page cabinet-history">
    <div className="cabinet-page-heading"><h1>{t("cabinet.redesign.history")}</h1><p>{t("cabinet.redesign.history_hint")}</p></div>
    <div className="cabinet-history-tabs" role="tablist" aria-label={t("cabinet.redesign.history")}><button role="tab" aria-selected={tab === "payments"} onClick={() => setTab("payments")}>{t("cabinet.redesign.payments")}</button><button role="tab" aria-selected={tab === "actions"} onClick={() => setTab("actions")}>{t("cabinet.redesign.actions")}</button></div>
    {tab === "payments" ? <>
    <section className="cabinet-surface cabinet-payments"><div className="cabinet-section-heading"><div><h2>{t("cabinet.profile.payments_history")}</h2><p>{t("cabinet.wallet.history_hint")}</p></div><Button variant="outline" size="sm" onClick={() => payments.refetch()} disabled={payments.isFetching}><RefreshCw size={16} className={payments.isFetching ? "animate-spin" : ""} />{t("cabinet.wallet.refresh")}</Button></div>
      {payments.isLoading ? <p role="status" className="cabinet-empty">{t("cabinet.wallet.loading")}</p> : payments.isError ? <div role="alert" className="cabinet-empty"><p>{t("cabinet.wallet.load_error")}</p><Button variant="outline" onClick={() => payments.refetch()}>{t("cabinet.wallet.retry")}</Button></div> : !items.length ? <div className="cabinet-empty"><ReceiptText size={30} /><h3>{t("cabinet.profile.no_payments")}</h3><p>{t("cabinet.wallet.empty_hint")}</p></div> : <ul className="cabinet-payment-list">{items.map(payment => <li key={payment.id}><div><strong>{formatCabinetMoney(payment.amount, payment.currency)}</strong><span>{new Date(payment.paidAt ?? payment.createdAt).toLocaleString(i18n.language)}</span></div><div><span className="cabinet-payment-status" data-status={payment.status.toLowerCase()}>{t(`cabinet.profile.payment_${payment.status.toLowerCase()}`, payment.status)}</span><small>{payment.orderId}</small></div></li>)}</ul>}
    </section>
    </> : <section className="cabinet-actions-history">
      {history.isLoading ? <p role="status">{t("cabinet.wallet.loading")}</p> : history.isError ? <div role="alert"><p>{t("cabinet.wallet.load_error")}</p><Button variant="outline" onClick={() => history.refetch()}>{t("cabinet.wallet.retry")}</Button></div> : <>
      {!history.data?.items.length && <p>{t("cabinet.redesign.no_actions")}</p>}
      <ul>{history.data?.items.map(item => { const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {}; return <li key={item.id}><div><strong>{t(`cabinet.events.${item.eventType}`, item.eventType)}</strong>{typeof metadata.tariffName === "string" && <span>{metadata.tariffName}</span>}</div><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(i18n.language)}</time></li>; })}</ul>
      <div className="cabinet-history-pagination"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>{t("cabinet.redesign.previous")}</Button><span>{page}</span><Button variant="outline" disabled={page * (history.data?.limit ?? 20) >= (history.data?.total ?? 0)} onClick={() => setPage(page + 1)}>{t("cabinet.redesign.next")}</Button></div>
      </>}
    </section>}
  </div>;
}
