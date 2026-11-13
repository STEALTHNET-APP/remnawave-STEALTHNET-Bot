/**
 * Чистая логика переходов статуса Platega-платежа (без БД) — тестируется отдельно.
 *
 * Проблема (#198): при SBP/QR, оплаченном с другого телефона, Platega шлёт сначала
 * CANCELED, потом CONFIRMED по той же транзакции. CANCELED переводил платёж в FAILED,
 * а CONFIRMED умел только PENDING → PAID — деньги списаны, ничего не выдано.
 *
 * Решение: CANCELED-webhook оставляет в metadata маркер `plategaFailedByWebhook`
 * с id транзакции. CONFIRMED может вернуть FAILED → PAID только если маркер есть,
 * id транзакции совпадает и платёж не возвращался (refundedAt). FAILED по другим
 * причинам (ошибка создания, ручной mark-failed, refund-fallback) маркера не имеет
 * и не воскрешается.
 */

export const PLATEGA_CANCEL_MARKER_KEY = "plategaFailedByWebhook";

export type PlategaCancelMarker = {
  status: string;
  transactionId: string;
  at: string;
};

/** Результат API double-check: confirmed — API подтвердил; unverified — креды не заданы; rejected — не подтвердил. */
export type PlategaApiCheck = "confirmed" | "unverified" | "rejected";

export type PlategaConfirmedDecision =
  | { kind: "from_pending" }
  | { kind: "recover_failed"; nextMetadata: string }
  | { kind: "already_paid" }
  | { kind: "not_recoverable"; reason: string };

type MetaObject = Record<string, unknown>;

function parseMetaObject(raw: string | null): MetaObject {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as MetaObject;
  } catch {
    return {};
  }
}

export function readPlategaCancelMarker(rawMetadata: string | null): PlategaCancelMarker | null {
  const value = parseMetaObject(rawMetadata)[PLATEGA_CANCEL_MARKER_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const marker = value as Record<string, unknown>;
  if (typeof marker.transactionId !== "string" || !marker.transactionId.trim()) return null;
  return {
    status: typeof marker.status === "string" ? marker.status : "",
    transactionId: marker.transactionId,
    at: typeof marker.at === "string" ? marker.at : "",
  };
}

/** metadata для PENDING → FAILED по webhook'у Platega (маркер нужен только при известном id транзакции). */
export function withPlategaCancelMarker(
  rawMetadata: string | null,
  status: string,
  transactionId: string | null,
  nowIso: string,
): string | null {
  if (!transactionId?.trim()) return rawMetadata;
  const marker: PlategaCancelMarker = { status, transactionId: transactionId.trim(), at: nowIso };
  return JSON.stringify({ ...parseMetaObject(rawMetadata), [PLATEGA_CANCEL_MARKER_KEY]: marker });
}

/**
 * Что делать с CONFIRMED-webhook'ом для платежа в текущем состоянии.
 * `transactionId` — id только из тела webhook'а (без fallback на payment.externalId).
 * Атомарность обеспечивает вызывающий: условный updateMany по статусу (и metadata для FAILED).
 */
export function decidePlategaConfirmed(
  row: { status: string; metadata: string | null },
  transactionId: string | null,
  api: PlategaApiCheck,
  nowIso: string,
): PlategaConfirmedDecision {
  if (api === "rejected") return { kind: "not_recoverable", reason: "platega_api_not_confirmed" };
  if (row.status === "PAID") return { kind: "already_paid" };
  if (row.status === "PENDING") return { kind: "from_pending" };
  if (row.status !== "FAILED") return { kind: "not_recoverable", reason: `status_${row.status.toLowerCase()}` };

  const meta = parseMetaObject(row.metadata);
  if (meta.refundedAt != null) return { kind: "not_recoverable", reason: "failed_after_refund" };
  const marker = readPlategaCancelMarker(row.metadata);
  if (!marker) return { kind: "not_recoverable", reason: "failed_not_by_platega_webhook" };
  if (!transactionId?.trim() || transactionId.trim() !== marker.transactionId) {
    return { kind: "not_recoverable", reason: "transaction_id_mismatch" };
  }

  const next: MetaObject = { ...meta };
  delete next[PLATEGA_CANCEL_MARKER_KEY];
  next.plategaRecoveredAfterCancel = { canceledStatus: marker.status, canceledAt: marker.at, recoveredAt: nowIso, api };
  return { kind: "recover_failed", nextMetadata: JSON.stringify(next) };
}
