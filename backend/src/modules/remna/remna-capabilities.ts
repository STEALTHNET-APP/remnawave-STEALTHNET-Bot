/**
 * Что умеет подключённая Remnawave.
 *
 * В 3.x из API вырезаны целые разделы, и завязанные на них блоки панели
 * молча перестают работать. Чтобы не показывать администратору мёртвые
 * кнопки, определяем мажорную версию и отдаём набор возможностей.
 *
 * Как определяем версию: отдельной ручки с номером у Remnawave нет
 * (`/api/system/metadata` в спецификации описан безымянным объектом),
 * поэтому смотрим на форму данных — в 3.x у пользователя числовой `id`
 * и нет `uuid`. Тот же признак использует стартовая миграция
 * `scripts/migrate-remna-ids.ts`.
 *
 * Если определить не удалось (Remnawave недоступна, пользователей ещё нет),
 * возвращаем `major: null` и НИЧЕГО не прячем: лучше показать блок, который
 * не сработает, чем спрятать рабочий.
 */

import { isRemnaConfigured, remnaGetUsers } from "./remna.client.js";

export interface RemnaCapabilities {
  /** 2 | 3 | null — null означает «не удалось определить» */
  major: 2 | 3 | null;
  /** /api/ip-control/* — гео-карта клиентов, сброс соединений. Вырезан в 3.x. */
  ipControl: boolean;
  /** /api/system/tools/happ/encrypt — ссылки happ://. Вырезан в 3.x. */
  happCrypt: boolean;
  /** /api/bandwidth-stats/nodes/realtime. Вырезан в 3.x. */
  realtimeBandwidth: boolean;
}

const TTL_MS = 10 * 60 * 1000;
let cache: { value: RemnaCapabilities; at: number } | null = null;

function fromMajor(major: 2 | 3 | null): RemnaCapabilities {
  const gone = major === 3;
  return {
    major,
    ipControl: !gone,
    happCrypt: !gone,
    realtimeBandwidth: !gone,
  };
}

async function detectMajor(): Promise<2 | 3 | null> {
  if (!isRemnaConfigured()) return null;
  // remnaFetch отдаёт обёртку { data, error, status }, а Remnawave заворачивает
  // полезную нагрузку ещё и в response.
  const res = (await remnaGetUsers({ size: 1 })) as { data?: unknown };
  const body = (res?.data ?? res) as Record<string, unknown> | undefined;
  const resp = (body?.response ?? body) as Record<string, unknown> | undefined;
  const users = (resp?.users ?? resp?.items) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(users) || users.length === 0) return null;

  const u = users[0];
  if (typeof u.uuid === "string" && u.uuid) return 2;
  if (typeof u.id === "number") return 3;
  return null;
}

export async function getRemnaCapabilities(force = false): Promise<RemnaCapabilities> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let major: 2 | 3 | null = null;
  try {
    major = await detectMajor();
  } catch {
    major = null;
  }
  const value = fromMajor(major);
  // Неопределённость не кэшируем надолго: Remnawave могла просто лежать.
  cache = { value, at: major === null ? Date.now() - TTL_MS + 30_000 : Date.now() };
  return value;
}

/** Сбросить кэш — например после смены адреса Remnawave в настройках. */
export function resetRemnaCapabilitiesCache(): void {
  cache = null;
}
