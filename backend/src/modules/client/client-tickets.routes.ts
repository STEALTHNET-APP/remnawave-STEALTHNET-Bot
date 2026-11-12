import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { uploadTicketAttachment } from "../../lib/upload.js";
import { filesToAttachments, serializeAttachments, parseAttachments, pickField } from "../ticket/attachments.js";
import { notifyAdminsAboutClientTicketMessage, notifyAdminsAboutNewTicket, notifyAdminsAboutTicketStatusChange } from "../notification/telegram-notify.service.js";
import { getPublicConfig } from "./client.service.js";

export const clientTicketsRouter = Router();

// ——— Тикеты (доступны только при включённой тикет-системе в настройках)
async function ensureTicketsEnabled(res: import("express").Response): Promise<boolean> {
  const config = await getPublicConfig();
  if (!config?.ticketsEnabled) {
    res.status(404).json({ message: "Тикет-система отключена" });
    return false;
  }
  return true;
}

// Создание тикета. Принимаем как JSON, так и multipart/form-data (когда прикрепляют фото).
// Текст первого сообщения может быть пустым, если приложены картинки.
const createTicketSchema = z.object({
  subject: z.string().trim().min(3, "Тема должна содержать минимум 3 символа").max(200, "Тема не должна превышать 200 символов"),
  message: z.string().trim().max(5000, "Сообщение не должно превышать 5000 символов").optional().default(""),
});
const MAX_OPEN_TICKETS = 5;
clientTicketsRouter.post("/tickets", uploadTicketAttachment.array("files", 5), async (req, res) => {
  if (!(await ensureTicketsEnabled(res))) return;
  const clientId = (req as unknown as { client: { id: string } }).client.id;
  const subject = pickField(req, "subject");
  const message = pickField(req, "message");
  const body = createTicketSchema.safeParse({ subject, message });
  if (!body.success) {
    return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });
  }
  const attachments = filesToAttachments(req.files as Express.Multer.File[] | undefined);
  const trimmedMessage = body.data.message.trim();
  if (!trimmedMessage && attachments.length === 0) {
    return res.status(400).json({ message: "Пустое сообщение" });
  }
  const ticket = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clientId}, 57))`;
    if (await tx.ticket.count({ where: { clientId, status: "open" } }) >= MAX_OPEN_TICKETS) return null;
    return tx.ticket.create({
    data: {
      clientId,
      subject: body.data.subject.trim(),
      status: "open",
      messages: {
        create: {
          authorType: "client",
          content: trimmedMessage,
          attachments: serializeAttachments(attachments),
        },
      },
    },
    include: { messages: true },
  });
  });
  if (!ticket) return res.status(400).json({ message: "У вас уже есть 5 активных обращений. Закройте неактуальное обращение перед созданием нового." });
  notifyAdminsAboutNewTicket({
    ticketId: ticket.id,
    clientId,
    subject: ticket.subject,
    firstMessage: trimmedMessage,
    attachmentsCount: attachments.length,
  }).catch(() => {});
  return res.status(201).json({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    closedAt: null,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      content: m.content,
      attachments: parseAttachments(m.attachments),
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

clientTicketsRouter.get("/tickets/unread-count", async (req, res) => {
  if (!(await ensureTicketsEnabled(res))) return;
  const clientId = (req as unknown as { client: { id: string } }).client.id;
  const count = await prisma.ticketMessage.count({
    where: {
      ticket: { clientId },
      authorType: "support",
      isRead: false,
    },
  });
  return res.json({ count });
});

clientTicketsRouter.get("/tickets", async (req, res) => {
  if (!(await ensureTicketsEnabled(res))) return;
  const clientId = (req as unknown as { client: { id: string } }).client.id;
  const statusParam = typeof req.query.status === "string" ? req.query.status : "all";
  const where = { clientId, ...(statusParam === "open" || statusParam === "closed" ? { status: statusParam } : {}) };
  const list = await prisma.ticket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: { id: true, subject: true, status: true, createdAt: true, updatedAt: true, closedAt: true },
  });
  return res.json({
    items: list.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    })),
  });
});

clientTicketsRouter.get("/tickets/:id", async (req, res) => {
  if (!(await ensureTicketsEnabled(res))) return;
  const clientId = (req as unknown as { client: { id: string } }).client.id;
  const ticket = await prisma.ticket.findFirst({
    where: { id: req.params.id, clientId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) return res.status(404).json({ message: "Тикет не найден" });

  // Mark support messages as read
  await prisma.ticketMessage.updateMany({
    where: { ticketId: ticket.id, authorType: "support", isRead: false },
    data: { isRead: true },
  });

  return res.json({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    closedAt: ticket.closedAt ? ticket.closedAt.toISOString() : null,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      content: m.content,
      attachments: parseAttachments(m.attachments),
      createdAt: m.createdAt.toISOString(),
      isRead: m.isRead,
    })),
  });
});

// Ответ в тикет. multipart/form-data — если приложены фото.
const replyTicketSchema = z.object({ content: z.string().max(10000).optional().default("") });
clientTicketsRouter.post("/tickets/:id/messages", uploadTicketAttachment.array("files", 5), asyncHandler(async (req, res) => {
  if (!(await ensureTicketsEnabled(res))) return;
  const clientId = (req as unknown as { client: { id: string } }).client.id;
  const content = pickField(req, "content");
  const body = replyTicketSchema.safeParse({ content });
  if (!body.success) {
    return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });
  }
  const ticket = await prisma.ticket.findFirst({ where: { id: req.params.id, clientId } });
  if (!ticket) return res.status(404).json({ message: "Тикет не найден" });
  const attachments = filesToAttachments(req.files as Express.Multer.File[] | undefined);
  const trimmed = body.data.content.trim();
  if (!trimmed && attachments.length === 0) {
    return res.status(400).json({ message: "Пустое сообщение" });
  }
  const msg = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clientId}, 57))`;
    const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    if (current.status !== "open" && await tx.ticket.count({ where: { clientId, status: "open" } }) >= MAX_OPEN_TICKETS) return null;
    await tx.ticket.update({ where: { id: ticket.id, clientId }, data: { updatedAt: new Date(), status: "open", closedAt: null } });
    return tx.ticketMessage.create({ data: { ticketId: ticket.id, authorType: "client", content: trimmed, attachments: serializeAttachments(attachments) } });
  });
  if (!msg) return res.status(400).json({ message: "У вас уже есть 5 активных обращений. Закройте одно из них перед возобновлением." });
  notifyAdminsAboutClientTicketMessage({
    ticketId: ticket.id,
    clientId,
    content: trimmed,
    attachmentsCount: attachments.length,
  }).catch(() => {});
  return res.status(201).json({
    id: msg.id,
    authorType: msg.authorType,
    content: msg.content,
    attachments: parseAttachments(msg.attachments),
    createdAt: msg.createdAt.toISOString(),
  });
}));

// Смена статуса тикета клиентом: закрытие и возобновление.
const updateClientTicketStatusSchema = z.object({ status: z.enum(["open", "closed"]) });
clientTicketsRouter.patch("/tickets/:id/status", async (req, res, next) => {
  try {
    if (!(await ensureTicketsEnabled(res))) return;
    const clientId = (req as unknown as { client: { id: string } }).client.id;
    const body = updateClientTicketStatusSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ message: "Некорректный статус обращения" });
    }
    const ticket = await prisma.ticket.findFirst({ where: { id: req.params.id, clientId } });
    if (!ticket) return res.status(404).json({ message: "Тикет не найден" });

    const isClosing = body.data.status === "closed";
    const updated = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clientId}, 57))`;
      const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      if (!isClosing && current.status !== "open" && await tx.ticket.count({ where: { clientId, status: "open" } }) >= MAX_OPEN_TICKETS) return null;
      return tx.ticket.update({
      where: { id: ticket.id, clientId },
      data: {
        status: body.data.status,
        closedAt: isClosing ? new Date() : null,
        updatedAt: new Date(),
      },
      select: { id: true, clientId: true, subject: true, status: true, closedAt: true, updatedAt: true },
    });
    });
    if (!updated) return res.status(400).json({ message: "У вас уже есть 5 активных обращений. Закройте одно из них перед возобновлением." });
    notifyAdminsAboutTicketStatusChange({
      ticketId: updated.id,
      clientId: updated.clientId,
      subject: updated.subject,
      status: updated.status,
    }).catch(() => {});

    return res.json({
      id: updated.id,
      subject: updated.subject,
      status: updated.status,
      closedAt: updated.closedAt ? updated.closedAt.toISOString() : null,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) { next(error); }
});

// Удаление обращений клиенту недоступно: только закрытие и возобновление.
clientTicketsRouter.delete("/tickets/:id", async (_req, res) => {
  return res.status(403).json({
    message: "Удаление обращений недоступно. Вы можете закрыть тикет, когда вопрос решён.",
  });
});
