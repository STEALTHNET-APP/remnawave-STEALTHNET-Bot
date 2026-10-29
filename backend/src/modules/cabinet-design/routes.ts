import { Router, type Request, type Response } from "express";
import { prisma } from "../../db.js";
import { requireAuth, type ReqAdmin } from "../auth/middleware.js";
import { emptyDocument, parseDesign, type DesignDocument } from "./contract.js";
import { changeDesign, type DesignCommand } from "./document.js";
const KEY = "cabinet_design_v1";
export const cabinetDesignAdminRouter = Router();
export const cabinetDesignPublicRouter = Router();
const read = (value?: string): DesignDocument => value ? JSON.parse(value) as DesignDocument : emptyDocument();
cabinetDesignAdminRouter.use(requireAuth, (req, res, next) => {
  if ((req as Request & ReqAdmin).adminRole !== "ADMIN") { res.status(403).json({ message: "Редактор доступен только администратору." }); return; }
  res.setHeader("Cache-Control", "no-store"); next();
});
cabinetDesignAdminRouter.get("/", async (_req, res) => {
  try { const row = await prisma.systemSetting.findUnique({ where: { key: KEY } }); res.json(read(row?.value)); }
  catch { res.status(503).json({ message: "Не удалось загрузить оформление. Повторите позже." }); }
});
async function mutate(req: Request, res: Response, command: DesignCommand) {
  const revision = req.body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) { res.status(400).json({ message: "Не указана версия черновика. Обновите редактор." }); return; }
  try {
    await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(emptyDocument()) }, update: {} });
    const row = await prisma.systemSetting.findUniqueOrThrow({ where: { key: KEY } });
    const next = changeDesign(read(row.value), revision, command);
    const changed = await prisma.systemSetting.updateMany({ where: { key: KEY, value: row.value }, data: { value: JSON.stringify(next) } });
    if (!changed.count) throw new Error("CONFLICT");
    res.json(next);
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "CONFLICT") { res.status(409).json({ message: "Оформление изменилось в другой вкладке. Скопируйте свои настройки через экспорт и загрузите актуальную версию." }); return; }
    if (code === "NOT_FOUND") { res.status(404).json({ message: "Эта версия больше недоступна в истории." }); return; }
    res.status(503).json({ message: "Не удалось сохранить оформление. Ваши изменения остались в редакторе." });
  }
}
for (const action of ["save", "publish"] as const) cabinetDesignAdminRouter.post(`/${action}`, (req, res) => {
  const design = parseDesign(req.body?.design);
  if (!design) { res.status(400).json({ message: "Проверьте цвета, размеры и название оформления." }); return; }
  void mutate(req, res, { action, design });
});
cabinetDesignAdminRouter.post("/discard", (req, res) => { void mutate(req, res, { action: "discard" }); });
cabinetDesignAdminRouter.post("/restore", (req, res) => {
  if (typeof req.body?.id !== "string" || req.body.id.length > 64) { res.status(400).json({ message: "Некорректная версия." }); return; }
  void mutate(req, res, { action: "restore", id: req.body.id });
});
cabinetDesignPublicRouter.get("/", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: KEY } }); const doc = read(row?.value);
    res.json({ design: parseDesign(doc.published), publishedAt: doc.publishedAt });
  } catch { res.status(503).json({ message: "Оформление временно недоступно." }); }
});
