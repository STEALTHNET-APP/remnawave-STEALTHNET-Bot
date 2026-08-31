/**
 * Вьюпорт мини-аппа Telegram: раскрытие на весь экран и safe-area.
 *
 * Без `expand()` Telegram открывает мини-апп «половинкой» — примерно на 50%
 * экрана, и пользователю приходится тянуть шторку вверх руками.
 *
 * `disableVerticalSwipes()` отключает закрытие свайпом вниз: иначе прокрутка
 * внутренних списков и нижних шторок то и дело сворачивает приложение
 * (Bot API 7.7+, дёргаем опционально).
 *
 * `requestFullscreen()` (Bot API 8.0+) отдаёт экран целиком, вместе с областью
 * статус-бара. ВАЖНО: в этом режиме шапка Telegram с крестиком ложится ПОВЕРХ
 * контента, поэтому мы:
 *   1) вешаем на <html> атрибут `data-tg-fullscreen="1"`;
 *   2) держим в переменной `--app-tg-top` высоту верхних отступов;
 *   3) в index.css по этому атрибуту сдвигаем вниз весь #root.
 * Так отступ получают все три дизайна кабинета сразу, без правки их разметки.
 *
 * Значения safe-area приходят асинхронно и меняются (поворот экрана, свёртка),
 * поэтому пересчитываем их по событиям Telegram, а не один раз на старте.
 *
 * Вне Telegram (обычный браузер, PWA) не делаем ничего.
 */

/** Сумма верхних отступов: системный статус-бар + шапка клиента Telegram. */
function applyTopInset(): void {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  const safe = tg.safeAreaInset?.top ?? 0;
  const content = tg.contentSafeAreaInset?.top ?? 0;
  document.documentElement.style.setProperty("--app-tg-top", `${safe + content}px`);
}

export function initTelegramViewport(): void {
  if (typeof window === "undefined") return;
  const tg = window.Telegram?.WebApp;
  // Пустой initData = страницу открыли не из Telegram; вьюпорт не трогаем.
  if (!tg || !tg.initData?.trim()) return;

  try {
    tg.ready();
  } catch {
    /* старый клиент — не критично */
  }
  try {
    tg.expand();
  } catch {
    /* не поддерживается — останется высота по умолчанию */
  }
  try {
    tg.disableVerticalSwipes?.();
  } catch {
    /* Bot API < 7.7 */
  }

  // Полный экран — только если клиент умеет (Bot API 8.0+).
  if (typeof tg.requestFullscreen !== "function") return;
  try {
    tg.requestFullscreen();
  } catch {
    return;
  }

  document.documentElement.dataset.tgFullscreen = "1";
  applyTopInset();

  // Отступы приходят не мгновенно и меняются при повороте экрана.
  for (const ev of ["safeAreaChanged", "contentSafeAreaChanged", "viewportChanged"]) {
    try {
      tg.onEvent?.(ev, applyTopInset);
    } catch {
      /* событие неизвестно этой версии клиента */
    }
  }
  try {
    tg.onEvent?.("fullscreenChanged", () => {
      if (tg.isFullscreen === false) {
        delete document.documentElement.dataset.tgFullscreen;
      } else {
        document.documentElement.dataset.tgFullscreen = "1";
        applyTopInset();
      }
    });
  } catch {
    /* Bot API < 8.0 */
  }
  // Подстраховка: часть клиентов отдаёт инсеты уже после первого кадра.
  setTimeout(applyTopInset, 300);
}
