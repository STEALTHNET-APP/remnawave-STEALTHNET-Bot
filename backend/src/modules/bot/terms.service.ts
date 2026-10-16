import { createHash } from "node:crypto";
import { prisma } from "../../db.js";

const documentKeys = ["agreement_link", "offer_link", "refund_link"] as const;

export async function botTerms(telegramId: string, input: { pendingStart?: string; acceptVersion?: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${BigInt(telegramId)})::text`;
    const settings = await tx.systemSetting.findMany({ where: { key: { in: [...documentKeys] } } });
    const documents = documentKeys.flatMap((key) => {
      const url = settings.find((item) => item.key === key)?.value.trim();
      if (!url) return [];
      try {
        const parsed = new URL(url);
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return [];
      } catch { return []; }
      return [{ kind: key.replace("_link", ""), url }];
    });
    if (!documents.length) return { required: false, accepted: true, documents, version: "", completed: false, pendingStart: null };
    const version = createHash("sha256").update(JSON.stringify(documents)).digest("hex").slice(0, 32);
    const existing = await tx.telegramConsent.findUnique({ where: { telegramId } });
    const accepted = existing?.acceptedVersion === version;
    if (input.acceptVersion !== undefined) {
      if (input.acceptVersion !== version || existing?.presentedVersion !== version) {
        return { required: true, accepted: false, documents, version, stale: true, completed: false, pendingStart: null };
      }
      if (accepted) return { required: true, accepted: true, documents, version, completed: false, pendingStart: null };
      await tx.telegramConsent.update({ where: { telegramId }, data: {
        acceptedVersion: version, acceptedDocuments: JSON.stringify(documents), acceptedAt: new Date(), pendingStart: null,
      } });
      return { required: true, accepted: true, documents, version, completed: true, pendingStart: existing.pendingStart };
    }
    if (!accepted) {
      await tx.telegramConsent.upsert({ where: { telegramId }, create: {
        telegramId, presentedVersion: version, pendingStart: input.pendingStart || null,
      }, update: { presentedVersion: version, ...(input.pendingStart ? { pendingStart: input.pendingStart } : {}) } });
    }
    return { required: true, accepted, documents, version, completed: false, pendingStart: null };
  });
}
