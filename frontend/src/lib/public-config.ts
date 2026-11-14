/**
 * Централизованный кеш публичного конфига (/api/public/config).
 *
 * Проблема, которую решает: ~30 вызовов api.getPublicConfig() по коду —
 * каждый useEffect компонента дёргал свой HTTP-запрос. За одну загрузку
 * страницы летело 4-6 одинаковых /public/config (ThemeProvider, useCabinetDesign,
 * AnalyticsScripts, CabinetIndexRedirect, layouts...). Это тормозило TTI и
 * создавало всплески на бэкенде (Aiven: «too many clients already»).
 *
 * Паттерн — module-level promise (как ensureTranslationsLoaded в i18n/use-language-sync):
 * первый вызов стартует fetch, остальные до его завершения получают ТОТ ЖЕ promise.
 * После завершения promise остаётся закешированным навсегда (конфиг публичный,
 * за сессию он не меняется; обновления подхватит следующая загрузка страницы).
 *
 * Использование:
 *   - Хук в компонентах:   const config = usePublicConfig();
 *   - Императивно в эффектах/Promise.all: getPublicConfigCached().then(...)
 *
 * Не экспортируем через api.ts, чтобы не тянуть циклическую зависимость
 * (api.ts ↔ lib/public-config): запрос делает fetch напрямую.
 */

import { useEffect, useState } from "react";
import type { PublicConfig } from "./api";

let configPromise: Promise<PublicConfig> | null = null;
/** Момент последней ошибки fetch (Date.now()) — для negative cache. */
let failAt = 0;
/** Пауза между ретраями после ошибки, мс. */
const RETRY_DELAY_MS = 2_000;

/** Один fetch на всю жизнь страницы; все последующие вызовы — тот же promise. */
export function getPublicConfigCached(): Promise<PublicConfig> {
  // Negative cache: после недавней ошибки не спамим повторными запросами
  // (каскад подписчиков монтируется одновременно — без паузы каждый следующий
  // вызов рождает новый fetch, пока бэкенд отдаёт 5xx, см. failAt ниже).
  if (failAt && Date.now() - failAt < RETRY_DELAY_MS) {
    return Promise.reject(new Error("public config recently failed"));
  }
  if (!configPromise) {
    configPromise = fetch("/api/public/config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`public config fetch failed: ${res.status}`);
        return (await res.json()) as PublicConfig;
      })
      .catch((e) => {
        // Провалившийся fetch сбрасываем: следующий вызов попытается снова —
        // но не раньше, чем через RETRY_DELAY_MS (не закешировать ошибку навсегда,
        // но и не устроить шторм повторных запросов).
        configPromise = null;
        failAt = Date.now();
        throw e;
      });
  }
  return configPromise;
}

/**
 * React-хук: подписка на закешированный конфиг.
 * Возвращает null пока конфиг не загрузился (или если загрузка упала —
 * подписчик получает null и не триггерит повторный fetch; повторный
 * запрос сделает первый попавшийся новый вызов getPublicConfigCached).
 */
export function usePublicConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(null);

  useEffect(() => {
    let alive = true;
    getPublicConfigCached()
      .then((c) => {
        if (alive) setConfig(c);
      })
      .catch(() => {
        /* ошибка уже зарепорчена первым подписчиком; останемся с null */
      });
    return () => {
      alive = false;
    };
  }, []);

  return config;
}
