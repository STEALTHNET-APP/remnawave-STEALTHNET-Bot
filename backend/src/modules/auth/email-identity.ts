import { z } from "zod";
import { prisma } from "../../db.js";

export const emailSchema = z.string().trim().email();

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailWhere(email: string) {
  const literal = normalizeEmail(email).replace(/[\\%_]/g, "\\$&");
  return { email: { equals: literal, mode: "insensitive" as const } };
}

export async function resolveClientEmail(email: string, allowExactLegacyMatch = false) {
  const matches = await prisma.client.findMany({ where: emailWhere(email), take: 2 });
  if (matches.length < 2) return { client: matches[0] ?? null, ambiguous: false };
  if (allowExactLegacyMatch) {
    const exact = await prisma.client.findUnique({ where: { email: email.trim() } });
    if (exact) return { client: exact, ambiguous: false };
  }
  return { client: null, ambiguous: true };
}

export async function resolveAdminEmail(email: string) {
  const matches = await prisma.admin.findMany({ where: emailWhere(email), take: 2 });
  if (matches.length < 2) return matches[0] ?? null;
  return prisma.admin.findUnique({ where: { email: email.trim() } });
}
