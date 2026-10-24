import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function pickFirst(val: unknown): string {
  if (val == null) return "";
  if (Array.isArray(val)) return String(val[0] ?? "").trim();
  return String(val).trim();
}

export function verifyYooMoneyHmacSign(body: Record<string, unknown>, secret: string): boolean {
  const receivedSign = body.sign;
  if (typeof receivedSign !== "string" || !/^[a-f0-9]{64}$/i.test(receivedSign)) return false;
  if (Object.values(body).some((value) => typeof value !== "string")) return false;

  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "sign") continue;
    params[key] = value;
  }

  const sortedKeys = Object.keys(params).sort();
  const dataString = sortedKeys
    .map((key) => {
      const value = params[key] as string;
      const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      return `${key}=${encoded}`;
    })
    .join("&");

  const computedSign = createHmac("sha256", secret)
    .update(dataString, "utf8")
    .digest("hex");

  return timingSafeEqual(Buffer.from(computedSign, "hex"), Buffer.from(receivedSign, "hex"));
}

export function computeYooMoneySha1(
  notificationType: string,
  operationId: string,
  amount: string,
  currency: string,
  datetime: string,
  sender: string,
  codepro: string,
  notificationSecret: string,
  label: string
): string {
  const str = [
    notificationType,
    operationId,
    amount,
    currency,
    datetime,
    sender,
    codepro,
    notificationSecret,
    label,
  ].join("&");
  return createHash("sha1").update(str, "utf8").digest("hex");
}
