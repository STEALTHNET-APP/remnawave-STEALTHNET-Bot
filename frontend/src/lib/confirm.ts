/**
 * Асинхронное подтверждение действия, поддерживающее как браузер (window.confirm),
 * так и нативные диалоги Telegram Mini App (Telegram.WebApp.showConfirm).
 */
export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tg = (window as unknown as { Telegram?: { WebApp?: { showConfirm?: (msg: string, cb: (ok: boolean) => void) => void } } })
        .Telegram?.WebApp;
      if (tg && typeof tg.showConfirm === 'function') {
        tg.showConfirm(message, (ok: boolean) => {
          resolve(Boolean(ok));
        });
        return;
      }
    } catch {
      // fallback
    }

    try {
      const result = window.confirm(message);
      resolve(Boolean(result));
    } catch {
      resolve(true);
    }
  });
}
