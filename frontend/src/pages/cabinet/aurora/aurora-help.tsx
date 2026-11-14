import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, CreditCard, FileText, MessageSquare, Send, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { AuBadge, AuEmpty, AuPage, AuRow, AuSection } from "@/components/aurora/aurora-ui";

export function AuroraHelp() {
  const { t } = useTranslation();
  const config = useCabinetConfig();
  const navigate = useNavigate();

  const support = config?.supportLink?.trim();
  const supportUrl = support && /^https?:\/\//i.test(support) ? support : null;
  const hoursFrom = config?.supportHoursFrom?.trim();
  const hoursTo = config?.supportHoursTo?.trim();
  const hours = hoursFrom && hoursTo ? `${hoursFrom}–${hoursTo}` : null;

  const documents = [
    { key: "offer", label: t("aurora.help_offer"), url: config?.offerLink?.trim() },
    { key: "privacy", label: t("aurora.help_privacy"), url: config?.agreementLink?.trim() },
    { key: "refund", label: t("aurora.help_refund"), url: config?.refundLink?.trim() },
  ].filter((item) => item.url);

  const proxies = (config?.tgProxyServers ?? []).filter((server) => server.url?.trim());

  return (
    <AuPage>
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.help")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{config?.serviceName || "VPN"}</p>
      </header>

      {config?.helpIntroText?.trim() && (
        <section className="whitespace-pre-line rounded-[22px] bg-[var(--au-surface)] p-4 text-[13.5px] leading-relaxed text-[var(--au-ink)]">
          {config.helpIntroText.trim()}
        </section>
      )}

      <AuSection title={t("aurora.help_fast")}>
        <div className="space-y-1">
          <AuRow
            icon={<Wifi className="h-4 w-4" />}
            title={t("aurora.help_connect")}
            subtitle={t("aurora.help_connect_hint")}
            onClick={() => navigate("/cabinet/subscribe")}
          />
          <AuRow
            icon={<CreditCard className="h-4 w-4" />}
            title={t("aurora.help_payments")}
            subtitle={t("aurora.help_payments_hint")}
            onClick={() => navigate("/cabinet/history")}
          />
          <AuRow
            icon={<Smartphone className="h-4 w-4" />}
            title={t("aurora.devices")}
            subtitle={t("aurora.help_devices_hint")}
            onClick={() => navigate("/cabinet/profile?tab=devices")}
          />
          <AuRow
            icon={<FileText className="h-4 w-4" />}
            title={t("aurora.promo")}
            subtitle={t("aurora.help_promo_hint")}
            onClick={() => navigate("/cabinet/dashboard")}
          />
        </div>
      </AuSection>

      <AuSection title={t("aurora.help_support")}>
        <div className="space-y-2">
          <p className="text-[13px] leading-relaxed text-[var(--au-muted)]">{t("aurora.help_support_text")}</p>
          {hours && <AuBadge tone="accent">{t("aurora.help_hours", { hours })}</AuBadge>}
          <div className="grid gap-2">
            {config?.ticketsEnabled && (
              <button
                type="button"
                onClick={() => navigate("/cabinet/tickets")}
                className="flex items-center justify-center gap-2 rounded-[16px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-4 py-3.5 text-[14.5px] font-bold text-white"
              >
                <MessageSquare className="h-4 w-4" />
                {t("aurora.help_open_tickets")}
              </button>
            )}
            {supportUrl && (
              <a
                href={supportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-[16px] bg-[var(--au-bg)] px-4 py-3.5 text-[14.5px] font-bold text-[var(--au-ink)]"
              >
                <Send className="h-4 w-4" />
                {t("aurora.help_write")}
                <ArrowUpRight className="h-4 w-4" />
              </a>
            )}
            {!config?.ticketsEnabled && !supportUrl && <AuEmpty title={t("aurora.help_no_contact")} />}
          </div>
        </div>
      </AuSection>

      {documents.length > 0 && (
        <AuSection title={t("aurora.documents")}>
          <div className="space-y-1">
            {documents.map((document) => (
              <AuRow
                key={document.key}
                icon={<ShieldCheck className="h-4 w-4" />}
                title={document.label}
                href={document.url}
                right={<ArrowUpRight className="h-4 w-4 text-[var(--au-muted)]" />}
              />
            ))}
          </div>
        </AuSection>
      )}

      {config?.instructionsLink?.trim() && (
        <a
          href={config.instructionsLink.trim()}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-[20px] bg-[var(--au-surface)] px-4 py-3.5 text-[14px] font-bold text-[var(--au-ink)]"
        >
          <FileText className="h-4 w-4" />
          {t("aurora.help_instructions")}
          <ArrowUpRight className="h-4 w-4" />
        </a>
      )}

      {proxies.length > 0 && (
        <AuSection title={t("aurora.help_mtproxy")}>
          <p className="mb-2 text-[12.5px] leading-snug text-[var(--au-muted)]">
            {config?.tgProxyText?.trim() || t("aurora.help_mtproxy_hint")}
          </p>
          <div className="space-y-1.5">
            {proxies.map((server) => (
              <a
                key={server.url}
                href={server.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-[16px] bg-[var(--au-bg)] px-3.5 py-3"
              >
                <span className="text-[18px]">{server.flag || "🌐"}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--au-ink)]">{server.name || server.url}</span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--au-muted)]" />
              </a>
            ))}
          </div>
        </AuSection>
      )}
    </AuPage>
  );
}
