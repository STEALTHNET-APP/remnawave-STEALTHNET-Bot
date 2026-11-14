import { prisma } from "../../db.js";
import { hashPassword } from "./auth.service.js";

export function validateRecoveryPassword(password: string) {
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Пароль должен содержать минимум 8 символов и не более 72 байт UTF-8");
  }
}

export async function resetAdminPassword(email: string, password: string) {
  if (!email.trim()) throw new Error("Укажите email администратора");
  validateRecoveryPassword(password);
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async tx => {
    const admins = await tx.admin.findMany({ where: { email: { equals: email.trim(), mode: "insensitive" }, role: "ADMIN" }, take: 2 });
    if (admins.length !== 1) throw new Error(admins.length ? "Найдено несколько администраторов с таким email" : "Администратор с таким email не найден");
    const admin = admins[0];
    await tx.admin.update({ where: { id: admin.id }, data: { passwordHash, mustChangePassword: false } });
    await tx.refreshToken.deleteMany({ where: { adminId: admin.id } });
    await tx.adminEvent.create({ data: { kind: "admin.password_recovery", actorId: admin.id, targetType: "admin", targetId: admin.id, payload: { source: "console" } } });
    return { email: admin.email, totpEnabled: admin.totpEnabled };
  });
}
