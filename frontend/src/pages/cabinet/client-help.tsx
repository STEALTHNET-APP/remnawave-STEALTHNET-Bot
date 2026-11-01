import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, MessageSquare, ShieldCheck, FileText, Wifi, CreditCard, Smartphone } from "lucide-react";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { AuroraHelp } from "@/pages/cabinet/aurora/aurora-help";

export function ClientHelpPage() {
  const design = useCabinetDesign();
  if (design === "aurora") return <AuroraHelp />;
  return <ClassicHelpPage />;
}

function ClassicHelpPage() {
  const config = useCabinetConfig();
  const { t } = useTranslation();
  const support = config?.supportLink?.trim();
  const supportUrl = support && /^https?:\/\//i.test(support) ? support : null;
  return <div className="cabinet-page">
    <div className="cabinet-page-heading"><div><h1>{t("cabinet.workspace.help")}</h1><p>{t("cabinet.help.subtitle")}</p></div></div>
    <div className="cabinet-help-grid">
      <section className="cabinet-surface"><Wifi size={24} /><h2>{t("cabinet.help.connect_title")}</h2><p>{t("cabinet.help.connect_text")}</p><Link className="cabinet-text-link" to="/cabinet/dashboard">{t("cabinet.help.open_subscription")}<ArrowUpRight size={17} /></Link></section>
      <section className="cabinet-surface"><CreditCard size={24} /><h2>{t("cabinet.help.payment_title")}</h2><p>{t("cabinet.help.payment_text")}</p><Link className="cabinet-text-link" to="/cabinet/history">{t("cabinet.help.open_payments")}<ArrowUpRight size={17} /></Link></section>
      <section className="cabinet-surface"><Smartphone size={24} /><h2>{t("cabinet.help.devices_title")}</h2><p>{t("cabinet.help.devices_text")}</p><Link className="cabinet-text-link" to="/cabinet/profile#devices">{t("cabinet.help.open_devices")}<ArrowUpRight size={17} /></Link></section>
    </div>
    <section className="cabinet-surface cabinet-support"><MessageSquare size={25} /><div><h2>{t("cabinet.help.support_title")}</h2><p>{t("cabinet.help.support_text")}</p><div className="cabinet-support-actions">{config?.ticketsEnabled && <Link to="/cabinet/tickets" className="cabinet-primary-link">{t("cabinet.help.open_tickets")}</Link>}{supportUrl && <a className="cabinet-text-link" href={supportUrl} target="_blank" rel="noopener noreferrer">{t("cabinet.help.contact")}<ArrowUpRight size={17} /></a>}{config && !config.ticketsEnabled && !supportUrl && <p>{t("cabinet.help.no_contact")}</p>}</div></div></section>
    <section className="cabinet-surface"><div className="cabinet-section-heading"><ShieldCheck size={22} /><h2>{t("cabinet.help.documents")}</h2></div><div className="cabinet-document-links">{["offer", "privacy", "refund"].map(kind => <Link key={kind} to={`/cabinet/documents/${kind}`}><FileText size={18} /><span>{t(`cabinet.help.${kind}`)}</span><ArrowUpRight size={17} /></Link>)}</div></section>
  </div>;
}
