/**
 * Страховка от «рассылка началась и висит».
 *
 * API только кладёт задание в очередь (status='pending'), а забирает его
 * отдельный сервис broadcast-worker. Если после обновления не прогнали
 * `docker compose up -d`, контейнера broadcast-worker просто нет — задание
 * лежит в очереди вечно, и никакой ошибки нигде не появляется: в админке
 * бесконечный прогресс, в логах тишина. Поймано на боевой установке, где
 * рассылка провисела 19 часов и закрылась только кнопкой отмены.
 *
 * Сам воркер такое заметить не может — он же и не запущен. Поэтому сторожа
 * держим в API.
 *
 * Осторожно с гонками: при рестарте воркер возвращает недоделанную рассылку в
 * 'pending' со СТАРЫМ started_at, и живой воркер подхватывает её за ~3 секунды.
 * Поэтому (а) первую проверку не делаем на старте, а только через интервал, и
 * (б) в UPDATE повторно требуем status='pending', чтобы не затоптать задание,
 * которое забрали между выборкой и записью.
 */

import { prisma } from "../../db.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 15 * 60 * 1000;

const HINT =
  "Рассылку никто не забрал из очереди — похоже, не запущен сервис broadcast-worker " +
  "(проверьте `docker compose ps broadcast-worker`, поднимите `docker compose up -d`)";

let timer: NodeJS.Timeout | null = null;

async function sweepStalePending(): Promise<void> {
  const threshold = new Date(Date.now() - STALE_AFTER_MS);
  const stuck = await prisma.broadcastHistory.findMany({
    where: { status: "pending", startedAt: { lt: threshold } },
    select: { id: true, startedAt: true },
  });
  if (stuck.length === 0) return;

  const minutes = Math.round(STALE_AFTER_MS / 60000);
  console.error(
    `[broadcast-stale] ${stuck.length} рассылок висят в очереди дольше ${minutes} мин — ` +
      `${HINT}. id: ${stuck.map((s) => s.id).join(", ")}`,
  );

  const res = await prisma.broadcastHistory.updateMany({
    where: { id: { in: stuck.map((s) => s.id) }, status: "pending" },
    data: { status: "error", finishedAt: new Date(), error: HINT },
  });
  if (res.count > 0) {
    console.error(`[broadcast-stale] помечено ошибкой: ${res.count}`);
  }
}

export function startBroadcastStaleScheduler(): void {
  if (timer) return;
  // Намеренно НЕ проверяем сразу на старте: если стек поднимается целиком,
  // воркеру нужно несколько секунд, чтобы забрать возвращённые в очередь
  // задания. Первая проверка — через интервал.
  timer = setInterval(() => {
    void sweepStalePending().catch((e) => {
      console.error("[broadcast-stale] проверка не удалась:", e instanceof Error ? e.message : e);
    });
  }, CHECK_INTERVAL_MS);
  console.log(
    `[broadcast-stale] Scheduler started: проверка раз в ${Math.round(CHECK_INTERVAL_MS / 60000)} мин, ` +
      `порог ${Math.round(STALE_AFTER_MS / 60000)} мин`,
  );
}

export function stopBroadcastStaleScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
