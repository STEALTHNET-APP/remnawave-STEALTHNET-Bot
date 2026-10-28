import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Wallet, ArrowUpRight, RefreshCw, ReceiptText } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useClientPayments } from "@/lib/queries";
import { formatCabinetMoney } from "@/lib/cabinet-format";
import { ClassicProfilePage } from "./client-profile";
import { Button } from "@/components/ui/button";

export function ClientWalletPage() {
  const { state } = useClientAuth();
  const { t, i18n } = useTranslation();
  const payments = useClientPayments(state.token);
  const items = payments.data?.items ?? [];
  return <div className="cabinet-page cabinet-wallet">
    <div className="cabinet-page-heading"><div><p className="cabinet-eyebrow">{t("cabinet.workspace.account")}</p><h1>{t("cabinet.wallet.title")}</h1><p>{t("cabinet.wallet.subtitle")}</p></div></div>
    <div className="cabinet-wallet-grid">
      <section className="cabinet-surface cabinet-balance-summary"><Wallet size={23} /><span>{t("cabinet.wallet.available")}</span><strong>{state.client ? formatCabinetMoney(state.client.balance, state.client.preferredCurrency) : "—"}</strong><p>{t("cabinet.wallet.balance_hint")}</p><Link to="/cabinet/tariffs">{t("cabinet.dashboard.choose_tariff")}<ArrowUpRight size={17} /></Link></section>
      <ClassicProfilePage topupOnly />
    </div>
    <section className="cabinet-surface cabinet-payments"><div className="cabinet-section-heading"><div><h2>{t("cabinet.profile.payments_history")}</h2><p>{t("cabinet.wallet.history_hint")}</p></div><Button variant="outline" size="sm" onClick={() => payments.refetch()} disabled={payments.isFetching}><RefreshCw size={16} className={payments.isFetching ? "animate-spin" : ""} />{t("cabinet.wallet.refresh")}</Button></div>
      {payments.isLoading ? <p role="status" className="cabinet-empty">{t("cabinet.wallet.loading")}</p> : payments.isError ? <div role="alert" className="cabinet-empty"><p>{t("cabinet.wallet.load_error")}</p><Button variant="outline" onClick={() => payments.refetch()}>{t("cabinet.wallet.retry")}</Button></div> : !items.length ? <div className="cabinet-empty"><ReceiptText size={30} /><h3>{t("cabinet.profile.no_payments")}</h3><p>{t("cabinet.wallet.empty_hint")}</p></div> : <ul className="cabinet-payment-list">{items.map(payment => <li key={payment.id}><div><strong>{formatCabinetMoney(payment.amount, payment.currency)}</strong><span>{new Date(payment.paidAt ?? payment.createdAt).toLocaleString(i18n.language)}</span></div><div><span className="cabinet-payment-status" data-status={payment.status.toLowerCase()}>{t(`cabinet.profile.payment_${payment.status.toLowerCase()}`, payment.status)}</span><small>{payment.orderId}</small></div></li>)}</ul>}
    </section>
  </div>;
}
