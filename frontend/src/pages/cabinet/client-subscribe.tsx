import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Wifi,
  Copy,
  Check,
  ExternalLink,
  Plus,
  Loader2,
  Smartphone,
  ArrowLeft,
  Monitor,
  Info,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { api } from "@/lib/api";
import type { SubscriptionPageConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Минимальный конфиг по умолчанию, если в админке не задана страница подписки: приложения и кнопка «Добавить подписку» с диплинком. */
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

function getSubscriptionPayload(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const raw = sub as Record<string, unknown>;
  if (raw.response && typeof raw.response === "object") return raw.response as Record<string, unknown>;
  if (raw.data && typeof raw.data === "object") {
    const d = raw.data as Record<string, unknown>;
    if (d.response && typeof d.response === "object") return d.response as Record<string, unknown>;
    // Remna может вернуть пользователя прямо в data (без вложенного response)
    if (typeof d.subscriptionUrl === "string" || typeof d.subscription_url === "string") return d;
  }
  return raw;
}

function getSubscriptionUrl(sub: unknown): string | null {
  const o = getSubscriptionPayload(sub);
  if (!o) return null;
  const url = typeof o.subscriptionUrl === "string" ? o.subscriptionUrl : (o as Record<string, unknown>).subscription_url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

/** Возвращает: ios | android | macos | windows | linux | other */
function detectPlatform(): string {
  const tg = typeof window !== "undefined" ? (window as { Telegram?: { WebApp?: { platform?: string } } }).Telegram?.WebApp : undefined;
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

export function ClientSubscribePage() {
  const { state } = useClientAuth();
  const isMiniapp = useCabinetMiniapp();
  const token = state.token ?? null;
  const client = state.client;
  const locale = (client?.preferredLang ?? "ru").toLowerCase().slice(0, 2);

  const [subscription, setSubscription] = useState<unknown>(null);
  const [pageConfig, setPageConfig] = useState<SubscriptionPageConfig>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const subscriptionUrl = getSubscriptionUrl(subscription);
  const platform = detectPlatform();

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([api.clientSubscription(token), api.getPublicSubscriptionPageConfig()])
      .then(([subRes, config]) => {
        setSubscription(subRes.subscription ?? null);
        setPageConfig(config ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[280px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      </div>
    );
  }

  if (!subscriptionUrl) {
    return (
      <div className="space-y-6 max-w-xl mx-auto">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2" asChild>
          <Link to="/cabinet/dashboard">
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5" />
              Подключение к VPN
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground">
              Ссылка на подписку появится после оплаты тарифа. Выберите тариф и оплатите — затем здесь можно будет скачать приложение и добавить подписку.
            </p>
            <Button asChild className="w-full gap-2">
              <Link to="/cabinet/tariffs">
                Выбрать тариф
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const linkCardRef = "Скопируйте ссылку и вставьте в приложение VPN или нажмите «Добавить подписку» в выбранном приложении ниже!";
  const linkCardRefMiniapp = "Скопируйте ссылку и вставьте в приложение VPN выше или нажмите «Добавить подписку» в выбранном приложении.";

  const appsBlock = apps.length === 0 ? (
    <Card>
      <CardContent className="py-6">
        <p className="text-sm text-muted-foreground text-center">
          {isMiniapp ? "Список приложений пуст. Скопируйте ссылку ниже и вставьте её в любое приложение VPN (Happ, Stash, v2rayNG и др.)" : "Список приложений пуст. Скопируйте ссылку выше и вставьте её в любое приложение VPN (Happ, Stash, v2rayNG и др.)"} или настройте страницу подписки в админке (Настройки → Страница подписки).
        </p>
      </CardContent>
    </Card>
  ) : (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-primary" />
        {platformData?.displayName ? getText(platformData.displayName, locale) : platformLabel}
      </h2>
      {apps.map((app, appIndex) => (
        <motion.div
          key={app.name}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: appIndex * 0.05 }}
        >
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-primary" />
                {app.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {app.blocks?.map((block, blockIndex) => (
                <div key={blockIndex} className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">
                    {getText(block.title, locale)}
                  </h3>
                  {block.description && (
                    <p className="text-sm text-muted-foreground">
                      {getText(block.description, locale)}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {block.buttons?.map((btn, btnIndex) => {
                      const isSubscription = btn.type === "subscriptionLink";
                      const href = isSubscription
                        ? btn.link
                            .replace(/\{\{SUBSCRIPTION_LINK\}\}/g, encodeURIComponent(subscriptionUrl))
                            .replace(/\{\{USERNAME\}\}/g, "")
                        : btn.link;
                      const label = getText(btn.text, locale);
                      // Кнопка «Добавить подписку» — deeplink (happ://, v2rayng:// и т.д.)
                      // Кастомные URL-схемы не работают в Telegram WebView и ломают SPA при прямом переходе.
                      // Решение: промежуточная страница /api/public/deeplink (авто-редирект + fallback-кнопка).
                      // Для мини-аппа: перехватываем клик → tg.openLink() в системном браузере.
                      // Для обычного сайта: обычная ссылка <a target="_blank"> — не блокируется попап-блокерами.
                      if (isSubscription) {
                        const baseUrl = window.location.origin;
                        const deeplinkUrl = `${baseUrl}/api/public/deeplink?url=${encodeURIComponent(href)}`;
                        const handleClick = (e: React.MouseEvent) => {
                          // Копируем ссылку подписки в буфер
                          try { navigator.clipboard?.writeText(subscriptionUrl); } catch { /* ignore */ }
                          const tg = (window as { Telegram?: { WebApp?: { openLink?: (url: string) => void } } }).Telegram?.WebApp;
                          if (tg?.openLink) {
                            e.preventDefault();
                            tg.openLink(deeplinkUrl);
                          }
                          // Если не мини-апп — ссылка откроется сама (target=_blank)
                        };
                        return (
                          <Button key={btnIndex} variant="default" size="sm" className="gap-2 min-h-[44px]" asChild>
                            <a href={deeplinkUrl} target="_blank" rel="noopener noreferrer" onClick={handleClick}>
                              <Plus className="h-4 w-4 shrink-0" />
                              {label}
                            </a>
                          </Button>
                        );
                      }
                      return (
                        <Button key={btnIndex} variant="outline" size="sm" className="gap-2" asChild>
                          <a href={href} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                            {label}
                          </a>
                        </Button>
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
  );

  const linkCard = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: isMiniapp ? 0.1 : 0 }}
      className="rounded-xl border bg-card p-4"
    >
      <h1 className="text-lg font-semibold flex items-center gap-2 mb-1">
        <Wifi className="h-5 w-5 text-primary" />
        Подключение к VPN
      </h1>
      {!isMiniapp && (
        <p className="text-sm text-muted-foreground mb-3">
          Это страница с инструкцией для подключения VPN, которую вы найдёте чуть ниже!
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          <Monitor className="h-3.5 w-3.5" />
          {platformLabel}
        </span>
      </div>
      <h2 className="text-sm font-medium text-muted-foreground mb-2">Ссылка на подписку</h2>
      <p className="text-xs text-muted-foreground mb-2">
        {isMiniapp ? linkCardRefMiniapp : linkCardRef}
      </p>
      <div className="flex gap-2 min-w-0">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-muted px-3 py-2 text-sm font-mono" title={subscriptionUrl}>
          {subscriptionUrl}
        </code>
        <Button variant="outline" size="sm" onClick={copyLink} className="shrink-0 gap-1">
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
          {copied ? "Скопировано" : "Копировать"}
        </Button>
      </div>
    </motion.div>
  );

  const instructionSection = !isMiniapp && (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="space-y-4"
    >
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Info className="h-4 w-4 text-muted-foreground" />
        Инструкция по подключению
      </h2>
      <p className="text-sm text-muted-foreground">
        Ниже — приложения для вашей платформы ({platformLabel}). Сначала скачайте приложение по ссылке, затем нажмите «Добавить подписку» — откроется диплинк с вашей ссылкой подписки.
      </p>
    </motion.section>
  );

  return (
    <div className="space-y-6 max-w-2xl mx-auto pb-8">
      <Button variant="ghost" size="sm" className="gap-2 -ml-2" asChild>
        <Link to="/cabinet/dashboard">
          <ArrowLeft className="h-4 w-4" />
          Назад
        </Link>
      </Button>

      {isMiniapp ? (
        <>
          {appsBlock}
          {linkCard}
        </>
      ) : (
        <>
          {linkCard}
          {instructionSection}
          {appsBlock}
        </>
      )}
    </div>
  );
}
