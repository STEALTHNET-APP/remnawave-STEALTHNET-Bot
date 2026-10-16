import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

export async function verifyUpdateDatabase() {
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  for (const model of Prisma.dmmf.datamodel.models) {
    const columns = model.fields.filter((field) => field.kind !== "object").map((field) => quote(field.dbName || field.name));
    if (columns.length) await prisma.$queryRawUnsafe(`SELECT ${columns.join(", ")} FROM ${quote(model.dbName || model.name)} LIMIT 0`);
  }
}
