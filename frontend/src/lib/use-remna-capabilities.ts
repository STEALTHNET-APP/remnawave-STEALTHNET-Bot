/**
 * Что умеет подключённая Remnawave.
 *
 * В 3.x из API вырезаны целые разделы, и завязанные на них блоки панели
 * работать не могут. Бэкенд определяет версию и отдаёт набор возможностей —
 * здесь мы его кэшируем на весь сеанс, чтобы каждый экран не спрашивал заново.
 *
 * Пока ответа нет (или он не пришёл), считаем, что доступно ВСЁ: лучше
 * показать блок, который не сработает, чем спрятать рабочий.
 */

import { useEffect, useState } from "react";
import { api, type RemnaCapabilities } from "@/lib/api";
import { useAuth } from "@/contexts/auth";

const ALL_AVAILABLE: RemnaCapabilities = {
  major: null,
  ipControl: true,
  happCrypt: true,
  realtimeBandwidth: true,
};

let cache: RemnaCapabilities | null = null;
let inflight: Promise<RemnaCapabilities> | null = null;

export function useRemnaCapabilities(): RemnaCapabilities {
  const token = useAuth().state.accessToken ?? "";
  const [caps, setCaps] = useState<RemnaCapabilities>(cache ?? ALL_AVAILABLE);

  useEffect(() => {
    if (!token || cache) return;
    let alive = true;
    inflight = inflight ?? api.getRemnaCapabilities(token).catch(() => ALL_AVAILABLE);
    inflight.then((r) => {
      cache = r;
      inflight = null;
      if (alive) setCaps(r);
    });
    return () => { alive = false; };
  }, [token]);

  return caps;
}
