import { createHmac, timingSafeEqual } from "node:crypto";

export function internalBotCredential(token: string): string {
  return token ? createHmac("sha256", token).update("stealthnet-bot-internal-v1").digest("hex") : "";
}

export function matchesSecret(expected: string, actual: unknown): boolean {
  if (!expected || typeof actual !== "string") return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validTelegramUpdate(update: unknown): update is { update_id: number } {
  return !!update && typeof update === "object" && Number.isSafeInteger((update as { update_id?: unknown }).update_id) && Number((update as { update_id: number }).update_id) >= 0;
}

export function botInternalUrl(path: string): string {
  const base = new URL(process.env.BOT_INTERNAL_URL || "http://bot:8080");
  return new URL(path, base).toString();
}

export async function forwardBotUpdate(update: unknown, credential: string, request = fetch): Promise<boolean> {
  const response = await request(botInternalUrl("/webhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bot-Internal-Auth": credential },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(25_000),
  });
  await response.body?.cancel();
  return response.ok;
}
