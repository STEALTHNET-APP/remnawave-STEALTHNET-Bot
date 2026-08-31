/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/info" />

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        /** Отключает закрытие мини-аппа свайпом вниз (Bot API 7.7+). */
        disableVerticalSwipes?: () => void;
        /** Полноэкранный режим — контент уходит под статус-бар (Bot API 8.0+). */
        requestFullscreen?: () => void;
        exitFullscreen?: () => void;
        isFullscreen?: boolean;
        /** Системная safe-area устройства (статус-бар и вырезы), Bot API 8.0+. */
        safeAreaInset?: { top: number; bottom: number; left: number; right: number };
        /** Область, занятая шапкой клиента Telegram поверх контента, Bot API 8.0+. */
        contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
        onEvent?: (event: string, handler: () => void) => void;
        close: () => void;
        /** Платформа клиента Telegram: ios, android, android_x, macos, web, weba, tdesktop, unigram и др. */
        platform?: string;
        showPopup?: (params: { title?: string; message?: string }) => void;
        /** Открыть ссылку во внешнем браузере (кастомные URL-схемы не поддерживаются, только https) */
        openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
        /** Открыть ссылку t.me внутри Telegram (диалог «Переслать» и т.п.). */
        openTelegramLink?: (url: string) => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        themeParams?: Record<string, string>;
      };
    };
  }
}
export {};
