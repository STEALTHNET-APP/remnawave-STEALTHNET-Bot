import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, Smartphone, Wifi } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api, type SubscriptionPageConfig } from "@/lib/api";
import { remnaInfo } from "@/lib/subscription-remna";
import { DEFAULT_SUBSCRIPTION_PAGE_CONFIG, detectPlatform, getText } from "@/lib/subscription-page";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuEmpty, AuLoading, AuNotice, AuPage, AuSection, CopyButton } from "@/components/aurora/aurora-ui";
import { QRCodeSVG } from "qrcode.react";

export function AuroraSubscribe() {
  const { t, i18n } = useTranslation();
  const { state } = useClientAuth();
  const config = useCabinetConfig();
  const [searchParams] = useSearchParams();
  const token = state.token ?? null;
  const locale = (state.client?.preferredLang ?? i18n.language ?? "ru").toLowerCase().slice(0, 2);
  const publicAppUrl = config?.publicAppUrl?.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "");

  const [url, setUrl] = useState<string | null>(null);
  const [pageConfig, setPageConfig] = useState<SubscriptionPageConfig>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const uuid = searchParams.get("uuid");
  const platform = detectPlatform();

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setLoading(true);
    const subscription = uuid
      ? api.clientSubscriptionByUuid(token, uuid)
      : api.clientSubscription(token);
    Promise.all([subscription, api.getPublicSubscriptionPageConfig().catch(() => null)])
      .then(([sub, page]) => {
        if (!alive) return;
        const info = remnaInfo(sub.subscription);
        setUrl(info.subscriptionUrl);
        setTitle(info.productName);
        setPageConfig(page);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, uuid]);

  if (loading) return <AuLoading rows={3} />;

  if (!url) {
    return (
      <AuPage>
        <AuEmpty
          icon={<Wifi className="h-6 w-6" />}
          title={t("aurora.subscribe_empty_title")}
          hint={t("aurora.subscribe_empty_hint")}
        />
      </AuPage>
    );
  }

  const page = pageConfig ?? DEFAULT_SUBSCRIPTION_PAGE_CONFIG;
  const platformData = page?.platforms?.[platform] ?? DEFAULT_SUBSCRIPTION_PAGE_CONFIG?.platforms?.[platform] ?? null;
  const apps = platformData?.apps ?? [];
  const platformName = getText(platformData?.displayName, locale) || platform;

  function withLink(link: string): string {
    return link.replace(/\{\{SUBSCRIPTION_LINK\}\}/g, encodeURIComponent(url ?? ""));
  }

  function openLink(link: string, type: string) {
    const target = type === "subscriptionLink" ? withLink(link) : link;
    const proxyUrl = `${publicAppUrl}/api/public/deeplink?url=${encodeURIComponent(target)}${type === "subscriptionLink" ? "" : "&skipAuto=1"}`;
    const tg = window.Telegram?.WebApp;
    if (tg?.initData?.trim() && typeof tg.openLink === "function") {
      tg.openLink(proxyUrl, { try_instant_view: false });
      return;
    }
    window.open(proxyUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <AuPage>
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.connection")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{t("aurora.subscribe_subtitle")}</p>
      </header>

      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] p-5 text-white">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Wifi className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-bold">{title || t("aurora.subscription")}</div>
            <div className="text-[12.5px] text-white/80">{platformName}</div>
          </div>
        </div>
        <div className="mt-4 break-all rounded-[16px] bg-white/15 p-3 font-mono text-[12px] leading-snug text-white/90">{url}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* буфер недоступен */
              }
            }}
            className="flex items-center justify-center gap-2 rounded-[16px] bg-white px-4 py-3 text-[14px] font-bold text-[#352b89]"
          >
            {copied ? t("aurora.copied") : t("aurora.copy_link")}
          </button>
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="flex items-center justify-center gap-2 rounded-[16px] bg-white/20 px-4 py-3 text-[14px] font-bold text-white"
          >
            {t("aurora.qr")}
          </button>
        </div>
      </section>

      <AuSection title={t("aurora.subscribe_how")}>
        <ol className="space-y-3">
          {[t("aurora.subscribe_step_1", { platform: platformName }), t("aurora.subscribe_step_2"), t("aurora.subscribe_step_3")].map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-[12px] font-bold text-white">
                {index + 1}
              </span>
              <span className="text-[13.5px] leading-relaxed text-[var(--au-ink)]">{step}</span>
            </li>
          ))}
        </ol>
      </AuSection>

      {apps.length > 0 && (
        <AuSection title={t("aurora.subscribe_apps", { platform: platformName })}>
          <div className="space-y-3">
            {apps.map((app) => (
              <article key={app.name} className="rounded-[18px] bg-[var(--au-bg)] p-3.5">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-[var(--au-from)]" />
                  <h3 className="text-[14px] font-bold text-[var(--au-ink)]">{app.name}</h3>
                </div>
                {(app.blocks ?? []).map((block, index) => (
                  <div key={index} className="mt-2 space-y-2">
                    {block.title && <p className="text-[13px] font-semibold text-[var(--au-ink)]">{getText(block.title, locale)}</p>}
                    {block.description && <p className="text-[12.5px] leading-snug text-[var(--au-muted)]">{getText(block.description, locale)}</p>}
                    {(block.buttons ?? []).length > 0 && (
                      <div className="grid gap-2">
                        {(block.buttons ?? []).map((button, buttonIndex) => (
                          <button
                            key={buttonIndex}
                            type="button"
                            onClick={() => openLink(button.link, button.type)}
                            className="flex items-center justify-center gap-2 rounded-[14px] bg-[var(--au-surface)] px-4 py-2.5 text-[13.5px] font-bold text-[var(--au-ink)]"
                          >
                            <ExternalLink className="h-4 w-4" />
                            {getText(button.text, locale)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </article>
            ))}
          </div>
        </AuSection>
      )}

      <AuNotice>{t("aurora.subscribe_hint")}</AuNotice>

      <AuroraSheet open={qrOpen} onClose={() => setQrOpen(false)} title={t("aurora.qr")}>
        <div className="flex flex-col items-center gap-3 pb-3">
          <div className="rounded-[20px] bg-white p-4">
            <QRCodeSVG value={url} size={220} />
          </div>
          <p className="px-2 text-center text-[12.5px] leading-snug text-[var(--au-muted)]">{t("aurora.qr_hint")}</p>
          <CopyButton
            value={url}
            label={t("aurora.copy_link")}
            copiedLabel={t("aurora.copied")}
            copied={copied}
            onCopied={() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="w-full"
          />
        </div>
      </AuroraSheet>
    </AuPage>
  );
}
