import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`email-unsubscribe:v1:${payload}`).digest();
}

export function signUnsubscribeToken(email: string, secret: string): string {
  const normalized = normalizeEmail(email);
  z.string().email().max(254).parse(normalized);
  const payload = Buffer.from(JSON.stringify([1, normalized])).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function readUnsubscribeToken(token: unknown, secret: string): string | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [payload, supplied] = parts;
  const expected = signature(payload, secret);
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Array.isArray(data) || data.length !== 2 || data[0] !== 1 || typeof data[1] !== "string") return null;
    const email = z.string().email().max(254).safeParse(data[1]);
    return email.success && email.data === normalizeEmail(email.data) ? email.data : null;
  } catch {
    return null;
  }
}
