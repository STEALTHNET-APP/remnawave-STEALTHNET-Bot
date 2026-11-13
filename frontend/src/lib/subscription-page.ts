import type { SubscriptionPageConfig } from "@/lib/api";

export const DEFAULT_SUBSCRIPTION_PAGE_CONFIG: SubscriptionPageConfig = {
  platforms: {
    ios: {
      displayName: { ru: "iOS", en: "iOS" },
      apps: [
        {
          name: "STEALTHNET",
          featured: true,
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "Откройте App Store и установите приложение STEALTHNET. Запустите его и разрешите добавление VPN-конфигурации.", en: "Open App Store and install STEALTHNET. Launch the app and allow VPN configuration." },
              buttons: [
                { link: "https://apps.apple.com/ru/app/stealthnet/id6790923730", text: { ru: "App Store (RU)", en: "App Store (RU)" }, type: "external" },
                { link: "https://apps.apple.com/us/app/stealthnet/id6790923730", text: { ru: "App Store (Global)", en: "App Store (Global)" }, type: "external" },
                { link: "stealthnet://add/{{SUBSCRIPTION_LINK}}", text: { ru: "Добавить подписку", en: "Add Subscription" }, type: "subscriptionLink" },
              ],
            },
            {
              title: { ru: "Подключение", en: "Connect" },
              description: { ru: "Выберите добавленный сервер и нажмите кнопку подключения.", en: "Select the added server and tap connect." },
              buttons: [],
            },
          ],
        },
        {
          name: "Happ",
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "⚠️ Приложение временно недоступно в российском App Store. Для установки требуется зарубежный Apple ID (например, США). Откройте App Store и установите приложение. Запустите его и разрешите конфигурацию VPN.", en: "Open App Store, install the app, then allow VPN configuration." },
              buttons: [
                { link: "https://apps.apple.com/us/app/happ-proxy-utility/id6504287215", text: { ru: "App Store (Global)", en: "App Store (Global)" }, type: "external" },
                { link: "happ://add/{{SUBSCRIPTION_LINK}}", text: { ru: "Добавить подписку", en: "Add Subscription" }, type: "subscriptionLink" },
              ],
            },
          ],
        },
        {
          name: "INCY",
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "⚠️ Приложение недоступно в российском App Store. Для установки переключите регион Apple ID на США или используйте зарубежный аккаунт. Откройте App Store и установите INCY.", en: "Open the App Store and install INCY. Launch the app and allow VPN configuration." },
              buttons: [
                { link: "https://apps.apple.com/us/app/incy/id6756943388", text: { ru: "App Store (Global)", en: "App Store (Global)" }, type: "external" },
              ],
            },
            {
              title: { ru: "Добавление подписки", en: "Add Subscription" },
              description: { ru: "Нажмите кнопку ниже — приложение откроется, и подписка добавится автоматически.", en: "Click the button below — the app will open and the subscription will be added automatically." },
              buttons: [
                { link: "incy://import/{{SUBSCRIPTION_LINK}}", text: { ru: "Добавить в INCY", en: "Add to INCY" }, type: "subscriptionLink" },
              ],
            },
            {
              title: { ru: "Подключение", en: "Connect" },
              description: { ru: "Включите туннель в INCY и подтвердите добавление VPN-конфигурации, если появится запрос.", en: "Turn on the tunnel in INCY and confirm the VPN configuration prompt if it appears." },
              buttons: [],
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
          name: "STEALTHNET",
          featured: true,
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "Скачайте APK-файл по ссылке ниже и установите приложение STEALTHNET.", en: "Download the APK file from the link below and install STEALTHNET." },
              buttons: [
                { link: "https://stealthnet.app/updates/STEALTHNET_3.0.5.apk", text: { ru: "Скачать APK", en: "Download APK" }, type: "external" },
                { link: "https://stealthnet.app/", text: { ru: "Сайт STEALTHNET", en: "STEALTHNET Website" }, type: "external" },
                { link: "stealthnet://add/{{SUBSCRIPTION_LINK}}", text: { ru: "Добавить подписку", en: "Add Subscription" }, type: "subscriptionLink" },
              ],
            },
            {
              title: { ru: "Подключение", en: "Connect" },
              description: { ru: "Выберите добавленный сервер и нажмите кнопку подключения.", en: "Select the added server and tap connect." },
              buttons: [],
            },
          ],
        },
        {
          name: "INCY",
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "Установите INCY из Google Play или скачайте APK с GitHub. Запустите приложение и разрешите добавление VPN-конфигурации.", en: "Install INCY from Google Play or download the APK from GitHub. Launch the app and allow VPN configuration." },
              buttons: [
                { link: "https://play.google.com/store/apps/details?id=io.incy.client", text: { ru: "Google Play", en: "Google Play" }, type: "external" },
                { link: "https://github.com/INCY-DEV/incy-platforms/releases", text: { ru: "GitHub / APK", en: "GitHub / APK" }, type: "external" },
              ],
            },
            {
              title: { ru: "Добавление подписки", en: "Add Subscription" },
              description: { ru: "Нажмите кнопку ниже — приложение откроется, и подписка добавится автоматически.", en: "Click the button below — the app will open and the subscription will be added automatically." },
              buttons: [
                { link: "incy://import/{{SUBSCRIPTION_LINK}}", text: { ru: "Добавить в INCY", en: "Add to INCY" }, type: "subscriptionLink" },
              ],
            },
          ],
        },
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
          name: "STEALTHNET",
          featured: true,
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "Скачайте DMG-файл по ссылке ниже и установите приложение STEALTHNET.", en: "Download the DMG file from the link below and install STEALTHNET." },
              buttons: [
                { link: "https://stealthnet.app/updates/STEALTHNET_3.0.5_aarch64.dmg", text: { ru: "Скачать DMG", en: "Download DMG" }, type: "external" },
                { link: "stealthnet://add/{{SUBSCRIPTION_LINK}}", text: { ru: "Добавить подписку", en: "Add Subscription" }, type: "subscriptionLink" },
              ],
            },
            {
              title: { ru: "Подключение", en: "Connect" },
              description: { ru: "Выберите добавленный сервер и нажмите кнопку подключения.", en: "Select the added server and tap connect." },
              buttons: [],
            },
          ],
        },
        {
          name: "INCY",
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "Установите INCY из App Store или скачайте DMG с GitHub. Запустите приложение и разрешите VPN-конфигурацию.", en: "Install INCY from the App Store or download the DMG from GitHub. Launch the app and allow VPN configuration." },
              buttons: [
                { link: "https://apps.apple.com/us/app/incy/id6756943388", text: { ru: "App Store (Global)", en: "App Store (Global)" }, type: "external" },
                { link: "https://github.com/INCY-DEV/incy-platforms/releases", text: { ru: "GitHub / DMG", en: "GitHub / DMG" }, type: "external" },
              ],
            },
            {
              title: { ru: "Добавление подписки", en: "Add Subscription" },
              description: { ru: "Нажмите кнопку ниже — приложение откроется, и подписка добавится автоматически.", en: "Click the button below — the app will open and the subscription will be added automatically." },
              buttons: [
                { link: "incy://import/{{SUBSCRIPTION_LINK}}", text: { ru: "Добавить в INCY", en: "Add to INCY" }, type: "subscriptionLink" },
              ],
            },
          ],
        },
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
          name: "STEALTHNET",
          featured: true,
          blocks: [
            {
              title: { ru: "Установка приложения", en: "App Installation" },
              description: { ru: "Скачайте установщик по ссылке ниже и установите приложение STEALTHNET.", en: "Download the installer from the link below and install STEALTHNET." },
              buttons: [
                { link: "https://stealthnet.app/updates/STEALTHNET_3.0.5_x64-setup.exe", text: { ru: "Скачать EXE", en: "Download EXE" }, type: "external" },
                { link: "stealthnet://add/{{SUBSCRIPTION_LINK}}", text: { ru: "Добавить подписку", en: "Add Subscription" }, type: "subscriptionLink" },
              ],
            },
            {
              title: { ru: "Подключение", en: "Connect" },
              description: { ru: "Выберите добавленный сервер и нажмите кнопку подключения.", en: "Select the added server and tap connect." },
              buttons: [],
            },
          ],
        },
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
