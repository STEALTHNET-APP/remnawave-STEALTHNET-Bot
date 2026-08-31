/**
 * Визуальный редактор страницы подписки: включение/выключение приложений по платформам и изменение порядка (drag-and-drop).
 * За основу берётся базовый конфиг (subpage-00000000-0000-0000-0000-000000000000.json).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Download, Smartphone, RefreshCw, Upload, ChevronDown, Copy, Check as CheckIcon } from "lucide-react";
import type { SubscriptionPageConfig } from "@/lib/api";

const PLATFORM_ORDER = ["ios", "android", "macos", "windows", "linux", "other"] as const;
const PLATFORM_LABELS: Record<string, string> = {
  ios: "iOS",
  android: "Android",
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  other: "Другое",
};

type SubscriptionPageApp = NonNullable<
  NonNullable<SubscriptionPageConfig>["platforms"]
>[string]["apps"] extends (infer A)[] | undefined
  ? A
  : never;

export type EditorApp = { id: string; enabled: boolean; app: SubscriptionPageApp };

function parseConfigJson(json: string | null): Record<string, { apps: EditorApp[] }> {
  if (!json?.trim()) return {};
  try {
    const data = JSON.parse(json) as SubscriptionPageConfig;
    const platforms = data?.platforms ?? {};
    const out: Record<string, { apps: EditorApp[] }> = {};
    for (const key of PLATFORM_ORDER) {
      const plat = platforms[key];
      const apps = plat?.apps ?? [];
      out[key] = {
        apps: apps.map((a, i) => ({
          id: `sub-${key}-${i}-${(a as { name?: string }).name ?? "app"}`,
          enabled: true,
          app: a as SubscriptionPageApp,
        })),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function configToJson(editorState: Record<string, { apps: EditorApp[] }>, baseMeta?: SubscriptionPageConfig): string {
  const platforms: NonNullable<SubscriptionPageConfig>["platforms"] = {};
  for (const key of PLATFORM_ORDER) {
    const entry = editorState[key];
    if (!entry) continue;
    const enabledApps = entry.apps.filter((a) => a.enabled).map((a) => a.app);
    if (enabledApps.length === 0) continue;
    const basePlatform = baseMeta?.platforms?.[key];
    platforms[key] = {
      ...(basePlatform ?? {}),
      apps: enabledApps,
    };
  }
  const result: SubscriptionPageConfig = {
    ...(baseMeta ?? {}),
    platforms,
  };
  return JSON.stringify(result, null, 2);
}

/**
 * Аккуратный merge: сохраняет порядок и настройки приложений из БД,
 * добавляет в конец платформы те приложения из файла, которых ещё нет в БД.
 * Кастомные (только в БД) — не теряются.
 *
 * @param current — приложения из БД (system_settings.subscription_page_config)
 * @param defaultConfig — базовый конфиг из файла subpage-default.json
 * @param onlyMissing — true: добавляем только новые (не пересоздаём существующие);
 *                     false: первичная загрузка с нуля.
 */
function mergeWithDefault(
  current: Record<string, { apps: EditorApp[] }>,
  defaultConfig: SubscriptionPageConfig | null,
  onlyMissing = false
): Record<string, { apps: EditorApp[] }> {
  const def = defaultConfig?.platforms ?? {};
  const out: Record<string, { apps: EditorApp[] }> = {};
  for (const key of PLATFORM_ORDER) {
    const defaultApps = def[key]?.apps ?? [];
    const currentApps = current[key]?.apps ?? [];
    const currentNames = new Set(
      currentApps.map((a) => (a.app as { name?: string }).name ?? "").filter(Boolean)
    );

    if (onlyMissing) {
      // Сохраняем существующий порядок и настройки, добавляем недостающие из дефолта в конец
      const additions: EditorApp[] = [];
      defaultApps.forEach((app, i) => {
        const name = (app as { name?: string }).name ?? `app-${i}`;
        if (!currentNames.has(name)) {
          additions.push({
            id: `sub-${key}-new-${i}-${name}`,
            enabled: true,
            app: app as SubscriptionPageApp,
          });
        }
      });
      out[key] = { apps: [...currentApps, ...additions] };
    } else {
      // Первичная загрузка: порядок из дефолта, существующие настройки сохранены, кастомные (только в БД) — в конец
      const currentByName = new Map(
        currentApps.map((a) => [(a.app as { name?: string }).name ?? "", a])
      );
      const usedNames = new Set<string>();
      const merged: EditorApp[] = [];
      defaultApps.forEach((app, i) => {
        const name = (app as { name?: string }).name ?? `app-${i}`;
        const existing = currentByName.get(name);
        if (existing) {
          merged.push(existing);
          usedNames.add(name);
        } else {
          merged.push({
            id: `sub-${key}-${i}-${name}`,
            enabled: true,
            app: app as SubscriptionPageApp,
          });
        }
      });
      // Кастомные приложения (есть только в БД) — в конец
      for (const a of currentApps) {
        const name = (a.app as { name?: string }).name ?? "";
        if (name && !usedNames.has(name)) {
          merged.push(a);
        }
      }
      out[key] = { apps: merged };
    }
  }
  return out;
}

/**
 * Подсчёт новых приложений из дефолта, которых ещё нет в текущем editor state.
 * Возвращает по платформам: { ios: ["Hiddify Pro", ...], android: [...] }
 */
function countMissingFromDefault(
  current: Record<string, { apps: EditorApp[] }>,
  defaultConfig: SubscriptionPageConfig | null
): Record<string, string[]> {
  if (!defaultConfig) return {};
  const def = defaultConfig.platforms ?? {};
  const out: Record<string, string[]> = {};
  for (const key of PLATFORM_ORDER) {
    const defaultApps = def[key]?.apps ?? [];
    const currentNames = new Set(
      (current[key]?.apps ?? [])
        .map((a) => (a.app as { name?: string }).name ?? "")
        .filter(Boolean)
    );
    const missing: string[] = [];
    for (const app of defaultApps) {
      const name = (app as { name?: string }).name ?? "";
      if (name && !currentNames.has(name)) missing.push(name);
    }
    if (missing.length > 0) out[key] = missing;
  }
  return out;
}

/**
 * Инструкция для админа: как добавить новое приложение в страницу подписки.
 * Раскрывающаяся карточка через нативный <details>, без extra-зависимостей.
 */
const EXAMPLE_APP_JSON = `{
  "name": "MyVPN",
  "featured": true,
  "blocks": [
    {
      "title": {
        "ru": "Установка приложения",
        "en": "App Installation"
      },
      "description": {
        "ru": "Скачайте приложение из App Store и запустите его.",
        "en": "Download the app from the App Store and launch it."
      },
      "svgIconKey": "DownloadIcon",
      "svgIconColor": "violet",
      "buttons": [
        {
          "link": "https://apps.apple.com/app/myvpn/id123456789",
          "text": { "ru": "App Store", "en": "App Store" },
          "type": "external",
          "svgIconKey": "ExternalLink"
        }
      ]
    },
    {
      "title": {
        "ru": "Добавить подписку",
        "en": "Add Subscription"
      },
      "description": {
        "ru": "Нажмите кнопку ниже — приложение откроется и автоматически добавит подписку.",
        "en": "Tap the button below — the app will open and add the subscription automatically."
      },
      "svgIconKey": "CloudDownload",
      "svgIconColor": "cyan",
      "buttons": [
        {
          "link": "myvpn://import?url={{SUBSCRIPTION_LINK}}",
          "text": { "ru": "Добавить подписку", "en": "Add Subscription" },
          "type": "subscriptionLink",
          "svgIconKey": "Plus"
        }
      ]
    }
  ]
}`;

function HowToAddAppGuide() {
  const [copied, setCopied] = useState(false);
  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(EXAMPLE_APP_JSON);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <details className="group rounded-xl border border-blue-500/20 bg-blue-500/[0.04] overflow-hidden">
      <summary className="flex items-center gap-3 p-4 cursor-pointer list-none hover:bg-blue-500/[0.08] transition-colors">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold">Как добавить новое приложение</h4>
          <p className="text-xs text-muted-foreground">
            Структура JSON, шаблонные переменные, доступные иконки
          </p>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 shrink-0" />
      </summary>

      <div className="border-t border-blue-500/20 p-5 space-y-5 text-sm">
        {/* Способы добавления */}
        <section>
          <h5 className="font-semibold mb-2">Два способа</h5>
          <ol className="list-decimal pl-5 space-y-1.5 text-muted-foreground text-[13px]">
            <li>
              <span className="text-foreground font-medium">Через UI (быстрее):</span> кнопка{" "}
              <b>«Загрузить JSON с ПК»</b> вверху — принимает файл целиком,
              дописывает новые приложения в существующий список.
            </li>
            <li>
              <span className="text-foreground font-medium">Через файл на сервере:</span> файл подмонтирован как
              volume (см. <code className="text-xs bg-muted/50 rounded px-1">docker-compose.yml</code>) —
              изменения подхватываются без пересборки контейнера.
              <div className="mt-2 ml-2 pl-3 border-l-2 border-blue-500/30 space-y-1.5">
                <div>
                  <b className="text-foreground">Шаг 1.</b> На сервере отредактируй файл:
                  <pre className="mt-1 text-[11px] bg-muted/30 rounded px-2 py-1 font-mono overflow-x-auto">nano /opt/remnawave-STEALTHNET-Bot/backend/subpage-00000000-0000-0000-0000-000000000000.json</pre>
                </div>
                <div>
                  <b className="text-foreground">Шаг 2.</b> В админке нажми{" "}
                  <b>«Перезагрузить с сервера»</b> (сбрасывает кэш на бэке, читает файл заново)
                </div>
                <div>
                  <b className="text-foreground">Шаг 3.</b> Появится плашка{" "}
                  <span className="text-emerald-500">«Найдено N новых приложений в файле»</span> 
                  жми <b>«Подмёрж новые»</b>
                </div>
                <div>
                  <b className="text-foreground">Шаг 4.</b> При желании перетащи мышью на нужное место {" "}
                  <b>«Сохранить»</b>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-amber-500/90">
                 Если файл редактируется в редакторе IDE на ПК — копируй его на сервер через scp/sftp{" "}
                в ту же директорию <code className="text-xs">/opt/remnawave-STEALTHNET-Bot/backend/</code>.
              </p>
            </li>
          </ol>
        </section>

        {/* Платформы */}
        <section>
          <h5 className="font-semibold mb-2">Платформы</h5>
          <p className="text-muted-foreground text-[13px] mb-2">
            Приложения добавляются внутри <code className="text-xs bg-muted/50 rounded px-1">platforms.&lt;ключ&gt;.apps[]</code>.
            Доступные ключи:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {["ios", "android", "macos", "windows", "linux", "other"].map((p) => (
              <code key={p} className="text-xs bg-muted/50 rounded px-2 py-0.5">{p}</code>
            ))}
          </div>
        </section>

        {/* Структура приложения */}
        <section>
          <h5 className="font-semibold mb-2">Структура приложения</h5>
          <ul className="space-y-1.5 text-[13px]">
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">name</code> —{" "}
              <span className="text-muted-foreground">обязательное, имя приложения. Используется для дедупа при подмёрже.</span>
            </li>
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">featured</code> —{" "}
              <span className="text-muted-foreground">опц., <code className="text-xs">true</code> выделяет приложение как «рекомендованное» в карточке.</span>
            </li>
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">blocks[]</code> —{" "}
              <span className="text-muted-foreground">массив шагов установки (обычно 2–3: установить, добавить подписку, подключиться).</span>
            </li>
          </ul>
        </section>

        {/* Структура шага */}
        <section>
          <h5 className="font-semibold mb-2">Структура шага (block)</h5>
          <ul className="space-y-1.5 text-[13px]">
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">title</code>,{" "}
              <code className="text-xs bg-muted/50 rounded px-1">description</code> —{" "}
              <span className="text-muted-foreground">мультиязычные объекты <code className="text-xs">{`{ "ru": "...", "en": "..." }`}</code>.
                Поддерживаются: <code className="text-xs">en, ru, zh, fa, fr</code>. Если язык отсутствует — берётся английский.
              </span>
            </li>
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">svgIconKey</code> — иконка шага. Доступные:
              <div className="flex flex-wrap gap-1 mt-1">
                {["DownloadIcon", "CloudDownload", "Check", "Gear", "AppleIcon", "Android", "Windows", "macOS", "Ubuntu", "TV"].map((k) => (
                  <code key={k} className="text-[10px] bg-muted/50 rounded px-1.5 py-0.5">{k}</code>
                ))}
              </div>
            </li>
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">svgIconColor</code> —{" "}
              <span className="text-muted-foreground">цвет иконки.</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {[
                  ["violet", "bg-violet-500"],
                  ["cyan", "bg-cyan-500"],
                  ["teal", "bg-teal-500"],
                  ["red", "bg-red-500"],
                ].map(([name, cls]) => (
                  <span key={name} className="inline-flex items-center gap-1 text-[10px] bg-muted/50 rounded px-1.5 py-0.5">
                    <span className={`h-2 w-2 rounded-full ${cls}`}></span>
                    {name}
                  </span>
                ))}
              </div>
            </li>
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">buttons[]</code> —{" "}
              <span className="text-muted-foreground">массив кнопок (см. ниже).</span>
            </li>
          </ul>
        </section>

        {/* Структура кнопки */}
        <section>
          <h5 className="font-semibold mb-2">Структура кнопки (button)</h5>
          <ul className="space-y-1.5 text-[13px]">
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">link</code> —{" "}
              <span className="text-muted-foreground">URL. Поддерживает шаблонные переменные:</span>
              <div className="mt-1 space-y-1 text-[12px]">
                <div>
                  <code className="text-xs bg-muted/50 rounded px-1">{`{{SUBSCRIPTION_LINK}}`}</code>{" "}
                  <span className="text-muted-foreground">— ссылка подписки клиента (с happ-шифрованием, если включено)</span>
                </div>
                <div>
                  <code className="text-xs bg-muted/50 rounded px-1">{`{{HAPP_CRYPT4_LINK}}`}</code>,{" "}
                  <code className="text-xs bg-muted/50 rounded px-1">{`{{HAPP_CRYPT3_LINK}}`}</code>{" "}
                  <span className="text-muted-foreground">— то же самое (для совместимости с Remna sub-page)</span>
                </div>
                <div>
                  <code className="text-xs bg-muted/50 rounded px-1">{`{{USERNAME}}`}</code>{" "}
                  <span className="text-muted-foreground">— имя пользователя в Remna</span>
                </div>
              </div>
            </li>
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">text</code> —{" "}
              <span className="text-muted-foreground">мультиязычный объект.</span>
            </li>
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">type</code>:
              <ul className="ml-4 mt-1 space-y-0.5 text-muted-foreground text-[12px]">
                <li><code className="text-xs">"external"</code> — обычная ссылка (открывается в браузере / App Store)</li>
                <li><code className="text-xs">"subscriptionLink"</code> — кнопка добавления подписки в приложение (deep-link)</li>
              </ul>
            </li>
            <li>
              <code className="text-xs bg-muted/50 rounded px-1">svgIconKey</code> — обычно{" "}
              <code className="text-xs">ExternalLink</code> или <code className="text-xs">Plus</code>.
            </li>
          </ul>
        </section>

        {/* Пример */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h5 className="font-semibold">Готовый пример</h5>
            <button
              type="button"
              onClick={copyExample}
              className="inline-flex items-center gap-1.5 text-[11px] rounded-lg border border-border px-2 py-1 hover:bg-muted/30 transition"
            >
              {copied ? (
                <>
                  <CheckIcon className="h-3 w-3 text-emerald-500" />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Скопировать JSON
                </>
              )}
            </button>
          </div>
          <pre className="text-[11px] leading-relaxed bg-muted/30 rounded-lg p-3 overflow-x-auto font-mono max-h-[400px]">
            {EXAMPLE_APP_JSON}
          </pre>
          <p className="text-[11px] text-muted-foreground mt-2">
            Скопируйте этот объект в массив <code className="text-xs bg-muted/50 rounded px-1">platforms.ios.apps[]</code>{" "}
            (или другой платформы) в JSON-файле.
          </p>
        </section>

        {/* Чек-лист */}
        <section>
          <h5 className="font-semibold mb-2">Чек-лист</h5>
          <ul className="space-y-1 text-[13px] text-muted-foreground">
            <li> Уникальное <code className="text-xs">name</code> (без него подмёрж не сработает)</li>
            <li> Минимум один блок с <code className="text-xs">title</code> и <code className="text-xs">description</code></li>
            <li> Хотя бы одна кнопка типа <code className="text-xs">subscriptionLink</code> со ссылкой <code className="text-xs">{`...{{SUBSCRIPTION_LINK}}...`}</code></li>
            <li> Иконки и цвета — только из списков выше</li>
            <li> Все языки переведены (или хотя бы <code className="text-xs">en</code> + <code className="text-xs">ru</code>)</li>
          </ul>
        </section>
      </div>
    </details>
  );
}

function SortableAppRow({
  item,
  onToggle,
}: {
  item: EditorApp;
  onToggle: (enabled: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const name = (item.app as { name?: string }).name ?? "—";
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2 ${isDragging ? "opacity-80 z-10" : ""}`}
    >
      <span
        className="flex h-8 w-8 shrink-0 cursor-grab active:cursor-grabbing items-center justify-center rounded-lg bg-muted/80 text-muted-foreground hover:bg-muted"
        {...attributes}
        {...listeners}
        title="Перетащите для изменения порядка"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <Checkbox
        id={item.id}
        checked={item.enabled}
        onCheckedChange={(v) => onToggle(v === true)}
        className="shrink-0"
      />
      <Label htmlFor={item.id} className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
        <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium truncate">{name}</span>
      </Label>
    </li>
  );
}

export function SubscriptionPageEditor({
  currentConfigJson,
  defaultConfig,
  onFetchDefault,
  onSave,
  saving,
}: {
  currentConfigJson: string | null;
  defaultConfig: SubscriptionPageConfig | null;
  /** Вызывается по клику «Загрузить базовый конфиг», если конфиг ещё не загружен */
  onFetchDefault?: () => Promise<SubscriptionPageConfig | null>;
  onSave: (configJson: string) => void;
  saving: boolean;
}) {
  const [editorState, setEditorState] = useState<Record<string, { apps: EditorApp[] }>>(() =>
    parseConfigJson(currentConfigJson)
  );
  const [loadDefaultLoading, setLoadDefaultLoading] = useState(false);
  const [loadDefaultError, setLoadDefaultError] = useState<string | null>(null);
  const [latestDefault, setLatestDefault] = useState<SubscriptionPageConfig | null>(defaultConfig ?? null);

  useEffect(() => {
    if (defaultConfig) setLatestDefault(defaultConfig);
  }, [defaultConfig]);

  // Первичная инициализация state'а редактора при изменении входных props.
  // Логика merge: всегда складываем БД и дефолт — кастомные не теряются, новые показываются как enabled.
  useEffect(() => {
    const parsed = parseConfigJson(currentConfigJson);
    const hasAny = Object.keys(parsed).some((k) => (parsed[k]?.apps?.length ?? 0) > 0);
    if (hasAny && latestDefault) {
      // В БД что-то есть + есть дефолт  mergeFirstLoad: порядок из дефолта, кастомные добавлены в конец
      setEditorState(mergeWithDefault(parsed, latestDefault, false));
    } else if (hasAny) {
      // В БД что-то есть, но дефолта нет (ещё не подгружен)  используем то что в БД
      setEditorState(parsed);
    } else if (latestDefault) {
      // В БД пусто + есть дефолт  берём дефолт целиком
      setEditorState(mergeWithDefault({}, latestDefault, false));
    }
  }, [currentConfigJson, latestDefault]);

  // Считаем сколько новых приложений в файле по сравнению с тем что сейчас в редакторе.
  const missingApps = countMissingFromDefault(editorState, latestDefault);
  const totalMissing = Object.values(missingApps).reduce((sum, arr) => sum + arr.length, 0);

  const loadDefault = useCallback(async () => {
    setLoadDefaultError(null);
    setLoadDefaultLoading(true);
    try {
      let config = latestDefault;
      if (onFetchDefault) {
        // ВСЕГДА перечитываем с сервера, чтобы подхватить замену файла на диске.
        const fresh = await onFetchDefault();
        if (fresh) {
          config = fresh;
          setLatestDefault(fresh);
        }
      }
      if (!config) {
        setLoadDefaultError("Не удалось загрузить базовый конфиг. Проверьте, что файл subpage-00000000-0000-0000-0000-000000000000.json есть в корне проекта на сервере.");
        return;
      }
      // Полная загрузка с заменой текущего state'а. Кастомные апы из БД сохранятся в конце.
      const merged = mergeWithDefault(editorState, config, false);
      setEditorState(merged);
    } catch (e) {
      setLoadDefaultError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoadDefaultLoading(false);
    }
  }, [latestDefault, editorState, onFetchDefault]);

  /**
   * «Подмёрж новые приложения из файла» — добавляет в конец только те, которых ещё нет.
   * Существующий порядок и enabled-состояния не трогает.
   */
  const mergeMissing = useCallback(async () => {
    setLoadDefaultError(null);
    setLoadDefaultLoading(true);
    try {
      let config = latestDefault;
      if (onFetchDefault) {
        const fresh = await onFetchDefault();
        if (fresh) {
          config = fresh;
          setLatestDefault(fresh);
        }
      }
      if (!config) {
        setLoadDefaultError("Не удалось загрузить базовый конфиг.");
        return;
      }
      setEditorState(mergeWithDefault(editorState, config, true));
    } catch (e) {
      setLoadDefaultError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoadDefaultLoading(false);
    }
  }, [latestDefault, editorState, onFetchDefault]);

  // Загрузка JSON-файла с компьютера администратора.
  // Альтернатива замене файла на сервере (которая не работает в Docker без пересборки).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleUploadJson = useCallback((file: File) => {
    setLoadDefaultError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const parsed = JSON.parse(text) as SubscriptionPageConfig;
        if (!parsed || typeof parsed !== "object" || !parsed.platforms) {
          setLoadDefaultError("Файл невалидный: ожидается объект с полем 'platforms'.");
          return;
        }
        setLatestDefault(parsed);
        // Сразу подмёрживаем — добавляем недостающие приложения, существующий порядок не трогаем.
        setEditorState(mergeWithDefault(editorState, parsed, true));
      } catch (e) {
        setLoadDefaultError(e instanceof Error ? `Не удалось прочитать JSON: ${e.message}` : "Не удалось прочитать JSON");
      }
    };
    reader.onerror = () => setLoadDefaultError("Ошибка чтения файла");
    reader.readAsText(file);
  }, [editorState]);

  const setPlatformApps = useCallback((platform: string, apps: EditorApp[]) => {
    setEditorState((s) => ({ ...s, [platform]: { apps } }));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent, platform: string) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const plat = editorState[platform];
      if (!plat) return;
      const ids = plat.apps.map((a) => a.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      setPlatformApps(platform, arrayMove(plat.apps, oldIndex, newIndex));
    },
    [editorState, setPlatformApps]
  );

  const handleToggle = useCallback(
    (platform: string, appId: string, enabled: boolean) => {
      const plat = editorState[platform];
      if (!plat) return;
      setPlatformApps(
        platform,
        plat.apps.map((a) => (a.id === appId ? { ...a, enabled } : a))
      );
    },
    [editorState, setPlatformApps]
  );

  const handleSubmit = useCallback(() => {
    onSave(configToJson(editorState, defaultConfig ?? undefined));
  }, [editorState, defaultConfig, onSave]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={loadDefault}
          disabled={loadDefaultLoading}
          title="Перечитать subpage-default.json с сервера"
        >
          {loadDefaultLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Перезагрузить с сервера
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={loadDefaultLoading}
          title="Загрузить subpage-default.json с компьютера (минуя Docker)"
        >
          <Upload className="h-4 w-4" />
          Загрузить JSON с ПК
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUploadJson(file);
            // Сброс, чтобы повторная загрузка того же файла триггерила onChange
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
        {loadDefaultError && (
          <p className="text-sm text-destructive">{loadDefaultError}</p>
        )}
        <Button type="button" onClick={handleSubmit} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Файл <code className="text-xs">subpage-00000000-...json</code> примонтирован как volume —
        замена на сервере подхватывается без пересборки. Кнопка «Перезагрузить с сервера» сбросит кэш
        и подтянет свежий файл. Альтернатива — «Загрузить JSON с ПК» (без захода на сервер).
      </p>

      <HowToAddAppGuide />

      {/* Плашка с найденными новыми приложениями в файле */}
      {totalMissing > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold mb-1">
                В файле {totalMissing} {totalMissing === 1 ? "новое приложение" : totalMissing < 5 ? "новых приложения" : "новых приложений"}
              </h4>
              <div className="text-xs text-muted-foreground space-y-1">
                {Object.entries(missingApps).map(([platform, names]) => (
                  <div key={platform}>
                    <span className="font-medium">{PLATFORM_LABELS[platform] ?? platform}:</span>{" "}
                    <span>{names.join(", ")}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Подмёрж добавит их в конец списка как включённые. Существующие приложения и порядок не изменятся.
                Не забудьте сохранить.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              onClick={mergeMissing}
              disabled={loadDefaultLoading}
            >
              {loadDefaultLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Подмёрж новые
            </Button>
          </div>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Включите или отключите приложения для каждой платформы и измените порядок перетаскиванием. В кабинете клиента будут показаны только включённые приложения в указанном порядке.
      </p>
      <div className="space-y-6">
        {PLATFORM_ORDER.map((platformKey) => {
          const plat = editorState[platformKey] ?? { apps: [] };
          const apps = plat.apps;
          if (apps.length === 0) return null;
          return (
            <Card key={platformKey}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {PLATFORM_LABELS[platformKey] ?? platformKey}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) => handleDragEnd(e, platformKey)}
                >
                  <SortableContext
                    items={apps.map((a) => a.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-2">
                      {apps.map((item) => (
                        <SortableAppRow
                          key={item.id}
                          item={item}
                          onToggle={(enabled) => handleToggle(platformKey, item.id, enabled)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
