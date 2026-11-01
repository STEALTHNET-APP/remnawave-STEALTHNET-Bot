import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Wallet, ArrowUpRight } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { formatCabinetMoney } from "@/lib/cabinet-format";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { ClassicProfilePage } from "./client-profile";

export function ClientWalletPage() {
  const design = useCabinetDesign();
  if (design === "aurora") return <Navigate to="/cabinet/profile?tab=topup" replace />;
  return <ClassicWalletPage />;
}

function ClassicWalletPage() {
  const { state } = useClientAuth();
  const { t } = useTranslation();
  return <div className="cabinet-page cabinet-wallet">
    <div className="cabinet-page-heading"><div><h1>{t("cabinet.wallet.title")}</h1><p>{t("cabinet.wallet.subtitle")}</p></div></div>
    <div className="cabinet-wallet-grid">
      <section className="cabinet-surface cabinet-balance-summary"><Wallet size={23} /><span>{t("cabinet.wallet.available")}</span><strong>{state.client ? formatCabinetMoney(state.client.balance, state.client.preferredCurrency) : "—"}</strong><p>{t("cabinet.wallet.balance_hint")}</p><Link to="/cabinet/tariffs">{t("cabinet.dashboard.choose_tariff")}<ArrowUpRight size={17} /></Link></section>
      <ClassicProfilePage topupOnly />
    </div>
    <Link to="/cabinet/history" className="cabinet-history-link">{t("cabinet.redesign.history")}<ArrowUpRight size={17} /></Link>
  </div>;
}
