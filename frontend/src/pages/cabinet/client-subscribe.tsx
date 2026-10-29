import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthSubscribe } from "@/pages/cabinet/stealth/stealth-subscribe";
import {
  Wifi,
  Copy,
  Check,
  ExternalLink,
  Plus,
  Loader2,
  Smartphone,
  ArrowLeft,
  Info,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { api } from "@/lib/api";
import type { SubscriptionPageConfig } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getPublicConfigCached } from "@/lib/public-config";

const DEFAULT_SUBSCRIPTION_PAGE_CONFIG: SubscriptionPageConfig = {
  platforms: {
    ios: {
      displayName: { ru: "iOS", en: "iOS" },
      apps: [
        {
          name: "Happ",
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "Откройте App Store и установите приложение. Запустите его и разрешите конфигурацию VPN.", en: "Open App Store, install the app, then allow VPN configuration." },
              buttons: [
                { link: "https://apps.apple.com/us/app/happ-proxy-utility/id6504287215", text: { ru: "App Store", en: "App Store" }, type: "external" },
                { link: "happ://add/{{SUBSCRIPTION_LINK}}", text: { ru: "Добавить подписку", en: "Add Subscription" }, type: "subscriptionLink" },
              ],
            },
          ],
        },
        {
          name: "Stash",
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "Установите Stash из App Store, затем нажмите кнопку ниже.", en: "Install Stash from App Store, then tap the button below." },
              buttons: [
                { link: "https://apps.apple.com/us/app/stash-rule-based-proxy/id1596063349", text: { ru: "App Store", en: "App Store" }, type: "external" },
                { link: "stash://install-config?url={{SUBSCRIPTION_LINK}}", text: { ru: "Добавить подписку", en: "Add Subscription" }, type: "subscriptionLink" },
              ],
            },
          ],
        },
      ],
    },
    android: {
      displayName: { ru: "Android", en: "Android" },
      apps: [
        {
          name: "v2rayNG",
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "Установите приложение из Google Play или по ссылке, затем нажмите «Добавить подписку».", en: "Install the app from Google Play or the link, then tap Add Subscription." },
              buttons: [
                { link: "https://play.google.com/store/apps/details?id=com.v2ray.ang", text: { ru: "Google Play", en: "Google Play" }, type: "external" },
                { link: "v2rayng://install-subscription?url={{SUBSCRIPTION_LINK}}", text: { ru: "Добавить подписку", en: "Add Subscription" }, type: "subscriptionLink" },
              ],
            },
          ],
        },
      ],
    },
    macos: {
      displayName: { ru: "macOS", en: "macOS" },
      apps: [
        {
          name: "Clash / V2rayU / Surge и др.",
          blocks: [
            {
              title: { ru: "Подключение на Mac", en: "Connect on Mac" },
              description: { ru: "Скопируйте ссылку на подписку выше и вставьте её в настройках Clash for Windows/Mac, V2rayU, Surge или другого клиента на macOS.", en: "Copy the subscription link above and paste it in Clash, V2rayU, Surge or another VPN client on macOS." },
              buttons: [],
            },
          ],
        },
      ],
    },
    windows: {
      displayName: { ru: "Windows", en: "Windows" },
      apps: [
        {
          name: "Clash / v2rayN / Nekoray и др.",
          blocks: [
            {
              title: { ru: "Подключение в Windows", en: "Connect on Windows" },
              description: { ru: "Скопируйте ссылку на подписку выше и вставьте её в Clash for Windows, v2rayN, Nekoray или другой клиент на Windows.", en: "Copy the subscription link above and paste it in Clash for Windows, v2rayN, Nekoray or another VPN client on Windows." },
              buttons: [],
            },
          ],
        },
      ],
    },
    linux: {
      displayName: { ru: "Linux", en: "Linux" },
      apps: [
        {
          name: "Clash / v2ray",
          blocks: [
            {
              title: { ru: "Подключение", en: "Connection" },
              description: { ru: "Скопируйте ссылку на подписку выше и вставьте её в настройках Clash, v2rayA или другого клиента.", en: "Copy the subscription link above and paste it in your Clash, v2rayA or other client." },
              buttons: [],
            },
          ],
        },
      ],
    },
    other: {
      displayName: { ru: "Другое", en: "Other" },
      apps: [
        {
          name: "Универсально",
          blocks: [
            {
              title: { ru: "Использование ссылки", en: "Using the link" },
              description: { ru: "Скопируйте ссылку на подписку выше и вставьте её в ваше VPN-приложение.", en: "Copy the subscription link above and paste it into your VPN app." },
              buttons: [],
            },
          ],
        },
      ],
    },
  },
};

function getSubscriptionPayload(sub: any): any {
  if (!sub || typeof sub !== "object") return null;
  const raw = sub as any;
  if (raw.response && typeof raw.response === "object") return raw.response;
  if (raw.data && typeof raw.data === "object") {
    const d = raw.data as any;
    if (d.response && typeof d.response === "object") return d.response;
    if (typeof d.subscriptionUrl === "string" || typeof d.subscription_url === "string") return d;
  }
  return raw;
}

function getSubscriptionUrl(sub: any): string | null {
  const o = getSubscriptionPayload(sub);
  if (!o) return null;
  const url = typeof o.subscriptionUrl === "string" ? o.subscriptionUrl : o.subscription_url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function detectPlatform(): string {
  const tg = typeof window !== "undefined" ? (window as any).Telegram?.WebApp : undefined;
  const tgPlatform = tg?.platform?.toLowerCase();
  if (tgPlatform) {
    if (tgPlatform === "ios") return "ios";
    if (tgPlatform === "android" || tgPlatform === "android_x") return "android";
    if (tgPlatform === "macos") return "macos";
  }
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/macintosh/.test(ua) || (/mac os x/.test(ua) && !/iphone|ipad|ipod/.test(ua))) return "macos";
  if (/win(dows|32|64|ce|10|11)/.test(ua) || /win/.test(ua)) return "windows";
  if (/linux/.test(ua)) return "linux";
  return "other";
}

function getText(map: Record<string, string> | undefined, locale: string): string {
  if (!map) return "";
  return map[locale] || map.ru || map.en || Object.values(map)[0] || "";
}

/**
 * Switcher: Stealth-design wizard или Classic. Хуки в каждой ветке вызываются
 * только в соответствующем компоненте, поэтому правила хуков не нарушены.
 */
export function ClientSubscribePage() {
  const design = useCabinetDesign();
  if (design === "stealth") return <StealthSubscribe />;
  return <ClassicSubscribePage />;
}

function ClassicSubscribePage() {
  const { state } = useClientAuth();
  const isMiniapp = useCabinetMiniapp();
  const token = state.token ?? null;
  const client = state.client;
  const locale = (client?.preferredLang ?? "ru").toLowerCase().slice(0, 2);
  const [searchParams] = useSearchParams();

  const [subscription, setSubscription] = useState<unknown>(null);
  const [pageConfig, setPageConfig] = useState<SubscriptionPageConfig | null>(null);
  const [publicAppUrl, setPublicAppUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobileView(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const subscriptionUrl = getSubscriptionUrl(subscription);
  const platform = detectPlatform();

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const uuid = searchParams.get("uuid");
    const subscriptionPromise = uuid
      ? api.clientSubscriptionByUuid(token, uuid)
      : api.clientSubscription(token);
    Promise.all([
      subscriptionPromise,
      api.getPublicSubscriptionPageConfig(),
      getPublicConfigCached().then((c) => c?.publicAppUrl ?? null).catch(() => null),
    ])
      .then(([subRes, config, appUrl]) => {
        setSubscription(subRes.subscription ?? null);
        setPageConfig(config ?? null);
        setPublicAppUrl(appUrl ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, searchParams]);

  const copyLink = () => {
    if (subscriptionUrl) {
      navigator.clipboard.writeText(subscriptionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const config = pageConfig ?? DEFAULT_SUBSCRIPTION_PAGE_CONFIG;
  const platformData =
    config?.platforms?.[platform] ?? DEFAULT_SUBSCRIPTION_PAGE_CONFIG?.platforms?.[platform] ?? null;
  const apps = platformData?.apps ?? [];
  const PLATFORM_LABELS: Record<string, string> = {
    ios: "iOS",
    android: "Android",
    macos: "macOS",
    windows: "Windows",
    linux: "Linux",
    other: "Другое",
  };
  const platformLabel = PLATFORM_LABELS[platform] ?? platform;
  const showQrNextToAddButton = isMiniapp || isMobileView;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
        <div className="relative">
          <div className="absolute inset-0 rounded-full blur-xl bg-primary/20 animate-pulse" />
          <Loader2 className="h-10 w-10 animate-spin text-primary relative z-10" />
        </div>
        <p className="text-sm font-medium text-slate-600 dark:text-muted-foreground animate-pulse">Подготовка конфигурации…</p>
      </div>
    );
  }

  if (!subscriptionUrl) {
    return (
      <div className="space-y-6 max-w-xl mx-auto">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2 hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground transition-colors" asChild>
          <Link to="/cabinet/dashboard">
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Link>
        </Button>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <Card className="border-slate-200/50 dark:border-white/10 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-2xl overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-50" />
            <CardHeader className="relative z-10">
              <CardTitle className="flex items-center gap-3 text-xl text-slate-900 dark:text-white">
                <div className="p-2.5 rounded-xl bg-primary/20 text-primary ring-1 ring-primary/30">
                  <Wifi className="h-5 w-5" />
                </div>
                Подключение к VPN
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 relative z-10">
              <p className="text-slate-600 dark:text-muted-foreground leading-relaxed">
                Ссылка на подписку появится после оплаты тарифа. Выберите тариф и оплатите — затем здесь можно будет скачать приложение и добавить подписку.
              </p>
              <Button asChild className="w-full gap-2 h-12 text-base font-medium shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] hover:shadow-primary/30">
                <Link to="/cabinet/tariffs">
                  Выбрать тариф
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  const linkCardRef = "Скопируйте ссылку и вставьте в приложение VPN или нажмите «Добавить подписку» в выбранном приложении ниже!";
  const linkCardRefMiniapp = "Скопируйте ссылку и вставьте в приложение VPN выше или нажмите «Добавить подписку» в выбранном приложении.";

  const appsBlock = apps.length === 0 ? (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.2, duration: 0.4, ease: "easeOut" }}
    >
      <Card className="border-slate-200/50 dark:border-white/10 bg-white/40 dark:bg-black/20 backdrop-blur-xl">
        <CardContent className="py-8">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="p-3 rounded-full bg-slate-100/50 dark:bg-white/5 ring-1 ring-slate-200/50 dark:ring-white/10 mb-2">
              <Info className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-slate-600 dark:text-muted-foreground max-w-sm">
              {isMiniapp ? "Список приложений пуст. Скопируйте ссылку ниже и вставьте её в любое приложение VPN (Happ, Stash, v2rayNG и др.)" : "Список приложений пуст. Скопируйте ссылку выше и вставьте её в любое приложение VPN (Happ, Stash, v2rayNG и др.)"} или настройте страницу подписки в админке (Настройки → Страница подписки).
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  ) : (
    <div className="space-y-6">
      <motion.div 
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-3 px-1"
      >
        <div className="h-8 w-1 rounded-full bg-primary" />
        <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Приложения для {platformData?.displayName ? getText(platformData.displayName, locale) : platformLabel}
        </h2>
      </motion.div>
      
      <div className="grid gap-4">
        {apps.map((app, appIndex) => (
          <motion.div
            key={app.name}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: appIndex * 0.1 + 0.2, type: "spring", stiffness: 300, damping: 24 }}
          >
            <Card className="border-slate-200/50 dark:border-white/10 bg-white/40 dark:bg-black/20 backdrop-blur-xl overflow-hidden group hover:bg-white/60 dark:hover:bg-black/30 transition-all duration-300 hover:scale-[1.01] hover:shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <CardHeader className="pb-3 relative z-10">
                <CardTitle className="text-lg flex items-center gap-3 text-slate-900 dark:text-white">
                  <div className="p-2 rounded-lg bg-slate-100/50 dark:bg-white/5 ring-1 ring-slate-200/50 dark:ring-white/10 group-hover:ring-primary/30 group-hover:text-primary transition-all duration-300">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  {app.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 relative z-10">
                {app.blocks?.map((block, blockIndex) => (
                  <div key={blockIndex} className="space-y-3">
                    <div className="space-y-1.5">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-foreground/90 flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                          {blockIndex + 1}
                        </span>
                        {getText(block.title, locale)}
                      </h3>
                      {block.description && (
                        <p className="text-sm text-slate-600 dark:text-muted-foreground pl-7 leading-relaxed">
                          {getText(block.description, locale)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2.5 pl-7 pt-1">
                      {block.buttons?.map((btn, btnIndex) => {
                        const isSubscription = btn.type === "subscriptionLink";
                        // Бэкенд уже отдаёт зашифрованную (happ://crypt4/...) ссылку в subscriptionUrl,
                        // поэтому шаблоны {{HAPP_CRYPT3_LINK}} и {{HAPP_CRYPT4_LINK}} разрешаются той
                        // же строкой — это безопасно: если ссылка не зашифрована (старая Remna),
                        // подставится обычный URL и Happ всё равно её примет.
                        const href = isSubscription
                          ? btn.link
                              .replace(/\{\{SUBSCRIPTION_LINK\}\}/g, subscriptionUrl || "")
                              .replace(/\{\{HAPP_CRYPT3_LINK\}\}/g, subscriptionUrl || "")
                              .replace(/\{\{HAPP_CRYPT4_LINK\}\}/g, subscriptionUrl || "")
                              .replace(/\{\{USERNAME\}\}/g, "")
                          : btn.link;
                        const label = getText(btn.text, locale);
                        
                        if (isSubscription) {
                          const origin =
                            (publicAppUrl ?? (typeof window !== "undefined" ? window.location.origin : ""))
                              .replace(/\/$/, "")
                              .trim();
                          const baseUrl =
                            origin && /^https?:\/\//i.test(origin)
                              ? origin
                              : typeof window !== "undefined"
                                ? `${window.location.protocol}//${window.location.host}`
                                : "";
                          const skipAuto = isMiniapp ? "&skip_auto=1" : "";
                          const deeplinkUrl = baseUrl
                            ? `${baseUrl}/api/public/deeplink?url=${encodeURIComponent(href)}${skipAuto}`
                            : "#";
                          const handleClick = (e: React.MouseEvent) => {
                            try {
                              if (subscriptionUrl) navigator.clipboard?.writeText(subscriptionUrl);
                            } catch {
                              /* ignore */
                            }
                            const tg = (window as any).Telegram?.WebApp;
                            if (tg?.openLink && deeplinkUrl.startsWith("http")) {
                              e.preventDefault();
                              tg.openLink(deeplinkUrl, { try_instant_view: false });
                            }
                          };
                          return (
                            <span key={btnIndex} className="inline-flex flex-wrap gap-2 items-center">
                              <a href={deeplinkUrl} target="_blank" rel="noopener noreferrer" onClick={handleClick} className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-2 min-h-[40px] shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all hover:scale-[1.02] flex-row !flex-nowrap whitespace-nowrap")}>
                                  <Plus className="h-4 w-4 shrink-0" />
                                  {label}
                                </a>
                              {showQrNextToAddButton && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5 min-h-[40px] shrink-0 border-slate-200/50 dark:border-white/10 bg-white/50 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10 transition-colors"
                                  onClick={() => setQrModalOpen(true)}
                                  type="button"
                                >
                                  <QrCode className="h-4 w-4" />
                                  QR
                                </Button>
                              )}
                            </span>
                          );
                        }
                        return (
                          <a key={btnIndex} href={href} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2 min-h-[40px] border-slate-200/50 dark:border-white/10 bg-white/50 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10 transition-colors flex-row !flex-nowrap whitespace-nowrap")}>
                              <ExternalLink className="h-4 w-4 shrink-0" />
                              {label}
                            </a>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );

  const linkCard = (
    <section className="cabinet-connection-link">
      <header className="cabinet-page-heading"><h1>Подключение к VPN</h1><p>Одна ссылка для ваших устройств. Текущая платформа: {platformLabel}.</p></header>
      <label htmlFor="connection-url">Ссылка подписки</label>
      <input id="connection-url" readOnly value={subscriptionUrl || ""} />
      <div className="cabinet-connection-buttons">
        <Button onClick={copyLink}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? "Скопировано" : "Копировать ссылку"}</Button>
        <Button variant="outline" onClick={()=>setQrModalOpen(true)}><QrCode size={16}/>Показать QR-код</Button>
      </div>
      <p>{isMiniapp ? linkCardRefMiniapp : linkCardRef}</p>
    </section>
  );

  const instructionSection = !isMiniapp && (
    <section className="cabinet-connection-guide"><h2>Как подключиться</h2><ol><li>Установите приложение для {platformLabel} из списка ниже.</li><li>Нажмите «Добавить подписку». Ссылка откроется в приложении.</li><li>Включите VPN в приложении. Если подписка не добавилась автоматически, вставьте скопированную ссылку вручную.</li></ol></section>
  );

  return (
    <div className="cabinet-connect-page space-y-8 max-w-3xl pb-12">
      <motion.div 
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <Button variant="ghost" size="sm" className="gap-2 -ml-2 hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground transition-colors" asChild>
          <Link to="/cabinet/dashboard">
            <ArrowLeft className="h-4 w-4" />
            Назад в кабинет
          </Link>
        </Button>
      </motion.div>

      {isMiniapp ? (
        <div className="space-y-6">
          {appsBlock}
          {linkCard}
        </div>
      ) : (
        <div className="space-y-8">
          {linkCard}
          {instructionSection}
          {appsBlock}
        </div>
      )}

      <Dialog open={qrModalOpen} onOpenChange={setQrModalOpen}>
        <DialogContent className="sm:max-w-sm border-slate-200/50 dark:border-white/10 bg-white/80 dark:bg-black/60 backdrop-blur-2xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="p-1.5 rounded-md bg-primary/20 text-primary">
                <QrCode className="h-5 w-5" />
              </div>
              QR-код подписки
            </DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-muted-foreground/80">
              Отсканируйте камерой телефона — в вашем приложении VPN. Например (Happ, Stash, v2rayNG и др.).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-5 py-4">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-blue-500/50 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-500" />
              <div className="relative rounded-2xl border border-slate-200 dark:border-white/20 bg-white p-5 shadow-xl">
                <QRCodeSVG value={subscriptionUrl || ""} size={220} level="M" includeMargin={false} />
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-muted-foreground bg-slate-100/80 dark:bg-white/5 px-3 py-1.5 rounded-full border border-slate-200/50 dark:border-white/5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Ссылка ведёт на конфигурацию VPN
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
