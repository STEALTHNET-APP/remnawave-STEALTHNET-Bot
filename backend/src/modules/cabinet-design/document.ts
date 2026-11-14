import { randomUUID } from "node:crypto";
import { DEFAULT_DESIGN, type CabinetDesign, type DesignDocument } from "./contract.js";
export type DesignCommand = { action: "save" | "publish"; design: CabinetDesign } | { action: "discard" } | { action: "restore"; id: string };
export function changeDesign(doc: DesignDocument, revision: number, command: DesignCommand, now = new Date().toISOString()): DesignDocument {
  if (doc.revision !== revision) throw new Error("CONFLICT");
  const next = { ...doc, revision: doc.revision + 1 };
  if (command.action === "save") return { ...next, draft: command.design };
  if (command.action === "discard") return { ...next, draft: null };
  if (command.action === "restore") {
    const snapshot = doc.history.find(s => s.id === command.id);
    if (!snapshot) throw new Error("NOT_FOUND");
    return { ...next, draft: snapshot.design ?? { ...DEFAULT_DESIGN, enabled: false, name: "Исходное оформление" } };
  }
  return { ...next, published: command.design, draft: null, publishedAt: now, history: [{ id: randomUUID(), at: now, name: doc.published?.name ?? "Исходное оформление", design: doc.published }, ...doc.history].slice(0, 12) };
}
