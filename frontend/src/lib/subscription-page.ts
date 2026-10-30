import type { SubscriptionPageConfig } from "@/lib/api";

export const DEFAULT_SUBSCRIPTION_PAGE_CONFIG: SubscriptionPageConfig = {
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


export function detectPlatform(): string {
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

export function getText(map: Record<string, string> | undefined, locale: string): string {
  if (!map) return "";
  return map[locale] || map.ru || map.en || Object.values(map)[0] || "";
}
