import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { uploadTicketAttachment } from "../../lib/upload.js";
import {
  notifyAdminsAboutSupportReply,
  notifyAdminsAboutTicketStatusChange,
} from "../notification/telegram-notify.service.js";
import {
  filesToAttachments,
  serializeAttachments,
  parseAttachments,
  pickField as pickTicketField,
  pickBooleanField,
} from "../ticket/attachments.js";
import { notifyClientAboutSupportReply } from "../ticket/ticket-client-notify.service.js";
import { deleteTickets } from "../ticket/ticket-delete.service.js";

export const adminTicketsRouter = Router();

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// ——— Тикеты (админ: список, просмотр, закрытие, ответ, массовые действия)
adminTicketsRouter.get("/", asyncRoute(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = status === "open" || status === "closed" ? { status } : {};
  const list = await prisma.ticket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: {
      client: { select: { id: true, email: true, telegramUsername: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, authorType: true, content: true, createdAt: true, isRead: true },
      },
    },
  });
  return res.json({
    items: list.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      closedAt: t.closedAt ? t.closedAt.toISOString() : null,
      client: t.client,
      lastMessage: t.messages[0]
        ? {
            id: t.messages[0].id,
            authorType: t.messages[0].authorType,
            content: t.messages[0].content,
            createdAt: t.messages[0].createdAt.toISOString(),
            isRead: t.messages[0].isRead,
          }
        : null,
    })),
  });
}));

adminTicketsRouter.get("/:id", asyncRoute(async (req, res) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: {
      client: { select: { id: true, email: true, telegramUsername: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) return res.status(404).json({ message: "Тикет не найден" });
  return res.json({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    closedAt: ticket.closedAt ? ticket.closedAt.toISOString() : null,
    client: ticket.client,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      content: m.content,
      attachments: parseAttachments(m.attachments),
      createdAt: m.createdAt.toISOString(),
    })),
  });
}));

adminTicketsRouter.patch("/:id", asyncRoute(async (req, res) => {
  const body = z.object({ status: z.enum(["open", "closed"]) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const status = body.data.status;
  const closedAt = status === "closed" ? new Date() : null;
  const ticket = await prisma.ticket.update({
    where: { id: req.params.id },
    data: { status, closedAt },
    select: { id: true, clientId: true, subject: true, status: true, closedAt: true },
  });
  notifyAdminsAboutTicketStatusChange({
    ticketId: ticket.id,
    clientId: ticket.clientId,
    subject: ticket.subject,
    status: ticket.status,
  }).catch(() => {});
  return res.json({ id: ticket.id, status: ticket.status, closedAt: ticket.closedAt?.toISOString() ?? null });
}));

// Ответ поддержки. multipart/form-data — если приложены фото.
const adminTicketMessageSchema = z.object({ content: z.string().max(10000).optional().default("") });
adminTicketsRouter.post("/:id/messages", uploadTicketAttachment.array("files", 5), asyncRoute(async (req, res) => {
  const content = pickTicketField(req, "content");
  const body = adminTicketMessageSchema.safeParse({ content });
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ message: "Тикет не найден" });
  const attachments = filesToAttachments(req.files as Express.Multer.File[] | undefined);
  const trimmed = body.data.content.trim();
  if (!trimmed && attachments.length === 0) {
    return res.status(400).json({ message: "Пустое сообщение" });
  }
  const msg = await prisma.$transaction(async tx => {
    await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
    return tx.ticketMessage.create({ data: { ticketId: ticket.id, authorType: "support", content: trimmed, attachments: serializeAttachments(attachments) } });
  });
  notifyAdminsAboutSupportReply({
    ticketId: ticket.id,
    clientId: ticket.clientId,
    content: trimmed,
    attachmentsCount: attachments.length,
  }).catch(() => {});
  notifyClientAboutSupportReply({
    ticketId: ticket.id,
    clientId: ticket.clientId,
    replyContent: trimmed,
    attachmentsCount: attachments.length,
  }).catch((err) => {
    console.warn("[admin-ticket] failed to notify client about reply:", err);
  });
  return res.status(201).json({
    id: msg.id,
    authorType: msg.authorType,
    content: msg.content,
    attachments: parseAttachments(msg.attachments),
    createdAt: msg.createdAt.toISOString(),
  });
}));

// Массовое изменение статуса выбранных тикетов
adminTicketsRouter.post("/bulk-status", asyncRoute(async (req, res) => {
  const schema = z.object({
    ticketIds: z.array(z.string().min(1)).min(1).max(500),
    status: z.enum(["open", "closed"]),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });

  const { ticketIds, status } = body.data;

  if (status === "closed") {
    // Закрываем только открытые тикеты (чтобы не сбрасывать таймер retention у уже закрытых)
    const updateOpen = await prisma.ticket.updateMany({
      where: { id: { in: ticketIds }, status: { not: "closed" } },
      data: { status: "closed", closedAt: new Date(), updatedAt: new Date() },
    });
    // Если среди закрытых были легаси тикеты с closedAt == null, дозаполняем
    const backfilled = await prisma.ticket.updateMany({
      where: { id: { in: ticketIds }, status: "closed", closedAt: null },
      data: { closedAt: new Date(), updatedAt: new Date() },
    });
    return res.json({ success: true, count: ticketIds.length, updatedCount: updateOpen.count + backfilled.count, status });
  } else {
    // Открываем все выбранные тикеты со сбросом closedAt
    const result = await prisma.ticket.updateMany({
      where: { id: { in: ticketIds } },
      data: { status: "open", closedAt: null, updatedAt: new Date() },
    });
    return res.json({ success: true, count: result.count, status });
  }
}));

// Массовый ответ выбранным тикетам (с поддержкой фото-вложений и опции автозакрытия)
adminTicketsRouter.post("/bulk-reply", uploadTicketAttachment.array("files", 5), asyncRoute(async (req, res) => {
  const content = pickTicketField(req, "content");
  const closeAfterReply = pickBooleanField(req, "closeAfterReply");

  let ticketIds: string[] = [];
  const rawTicketIds = (req.body as Record<string, unknown> | undefined)?.ticketIds;
  if (Array.isArray(rawTicketIds)) {
    ticketIds = rawTicketIds.map(String).filter(Boolean);
  } else if (typeof rawTicketIds === "string") {
    try {
      const parsed = JSON.parse(rawTicketIds);
      if (Array.isArray(parsed)) ticketIds = parsed.map(String).filter(Boolean);
      else ticketIds = [rawTicketIds];
    } catch {
      ticketIds = rawTicketIds.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  ticketIds = [...new Set(ticketIds)];
  if (ticketIds.length > 500 || content.length > 10000) return res.status(400).json({ message: "Не более 500 тикетов и 10000 символов" });
  if (ticketIds.length === 0) {
    return res.status(400).json({ message: "Не указаны тикеты для ответа" });
  }

  const attachments = filesToAttachments(req.files as Express.Multer.File[] | undefined);
  const trimmed = content.trim();
  if (!trimmed && attachments.length === 0) {
    return res.status(400).json({ message: "Пустое сообщение" });
  }

  const tickets = await prisma.ticket.findMany({
    where: { id: { in: ticketIds } },
    select: { id: true, clientId: true, status: true, closedAt: true },
  });

  if (tickets.length === 0) {
    return res.status(404).json({ message: "Выбранные тикеты не найдены" });
  }

  const serializedAtt = serializeAttachments(attachments);
  await prisma.$transaction(async tx => {
    for (const ticket of [...tickets].sort((a, b) => a.id.localeCompare(b.id))) {
      const staysClosed = closeAfterReply || ticket.status === "closed";
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          updatedAt: new Date(),
          status: staysClosed ? "closed" : "open",
          closedAt: staysClosed ? (ticket.closedAt ?? new Date()) : null,
        },
      });
      await tx.ticketMessage.create({ data: { ticketId: ticket.id, authorType: "support", content: trimmed, attachments: serializedAtt } });
    }
  }, { timeout: 60_000 });
  for (const ticket of tickets) {
    notifyAdminsAboutSupportReply({
      ticketId: ticket.id,
      clientId: ticket.clientId,
      content: trimmed,
      attachmentsCount: attachments.length,
    }).catch(() => {});

    notifyClientAboutSupportReply({
      ticketId: ticket.id,
      clientId: ticket.clientId,
      replyContent: trimmed,
      attachmentsCount: attachments.length,
    }).catch((err) => {
      console.warn(`[admin-ticket] bulk reply notify failed for client ${ticket.clientId}:`, err);
    });
  }

  return res.json({ success: true, count: tickets.length, closedAfterReply: closeAfterReply });
}));

// Массовое удаление выбранных тикетов
adminTicketsRouter.post("/bulk-delete", asyncRoute(async (req, res) => {
  const schema = z.object({
    ticketIds: z.array(z.string().min(1)).min(1).max(500),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });

  const { ticketIds } = body.data;
  const count = await deleteTickets({ id: { in: ticketIds } });
  return res.json({ success: true, count });
}));

// Удаление всех тикетов (только закрытых или абсолютно всех)
adminTicketsRouter.post("/delete-all", asyncRoute(async (req, res) => {
  const schema = z.object({
    scope: z.enum(["closed", "all"]).default("closed"),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });

  const scope = body.data.scope;
  const where = scope === "closed" ? { status: "closed" } : {};

  const count = await deleteTickets(where);
  return res.json({ success: true, count, scope });
}));

// Удаление тикета админом (каскадное удаление сообщений в БД + удаление файлов с диска)
adminTicketsRouter.delete("/:id", asyncRoute(async (req, res) => {
  const count = await deleteTickets({ id: req.params.id });
  if (!count) return res.status(404).json({ message: "Тикет не найден" });
  return res.json({ success: true, id: req.params.id });
}));
