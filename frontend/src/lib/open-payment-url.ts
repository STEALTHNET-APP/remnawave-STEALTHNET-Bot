/**
 * Открывает URL платёжной страницы в браузере.
 * В Telegram Mini App — в системном браузере (openLink), иначе — в новой вкладке.
 * Оплаты в WebView мини-аппа делать нельзя, поэтому всегда открываем снаружи.
 */
export function openPaymentInBrowser(url: string): void {
  const raw =
    typeof window !== "undefined"
      ? (window as { Telegram?: { WebApp?: false | { openLink?: (url: string) => void } } }).Telegram?.WebApp
      : undefined;
  const webApp = raw && typeof raw === "object" ? raw : undefined;
  if (webApp?.openLink) {
    webApp.openLink(url);
  } else if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
