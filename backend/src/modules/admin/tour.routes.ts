import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { uploadMascotImage, uploadVideo, mascotUrl, videoUploadUrl, removeUploadedFile } from "../../lib/upload.js";

export const adminTourStepsRouter = Router();
export const adminTourMascotsRouter = Router();

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// ——— Tour Steps (конструктор тура) ———

const tourStepIdSchema = z.object({ id: z.string().min(1) });

const TOUR_PLACEMENTS = ["top", "bottom", "left", "right", "center"] as const;
const TOUR_MOODS = ["wave", "point", "happy", "think"] as const;

const createTourStepSchema = z.object({
  target: z.string().min(1).max(500),
  targetLabel: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(5000),
  videoUrl: z.string().max(1000).nullable().optional(),
  placement: z.enum(TOUR_PLACEMENTS).optional(),
  route: z.string().max(255).nullable().optional(),
  mascotId: z.string().max(100).nullable().optional(),
  mood: z.enum(TOUR_MOODS).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const updateTourStepSchema = z.object({
  target: z.string().min(1).max(500).optional(),
  targetLabel: z.string().min(1).max(255).optional(),
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(5000).optional(),
  videoUrl: z.string().max(1000).nullable().optional(),
  placement: z.enum(TOUR_PLACEMENTS).optional(),
  route: z.string().max(255).nullable().optional(),
  mascotId: z.string().max(100).nullable().optional(),
  mood: z.enum(TOUR_MOODS).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const reorderTourStepsSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    sortOrder: z.number().int(),
  })),
});

function tourStepToJson(s: {
  id: string; target: string; targetLabel: string; title: string; content: string;
  videoUrl: string | null; placement: string; route: string | null; mascotId: string | null; mood: string;
  sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
  mascot?: { id: string; name: string; imageUrl: string; isBuiltIn: boolean; emotions?: { id: string; mood: string; imageUrl: string }[] } | null;
}) {
  return {
    id: s.id,
    target: s.target,
    targetLabel: s.targetLabel,
    title: s.title,
    content: s.content,
    videoUrl: s.videoUrl,
    placement: s.placement,
    route: s.route,
    mascotId: s.mascotId,
    mood: s.mood,
    sortOrder: s.sortOrder,
    isActive: s.isActive,
    mascot: s.mascot ? { id: s.mascot.id, name: s.mascot.name, imageUrl: s.mascot.imageUrl, isBuiltIn: s.mascot.isBuiltIn, emotions: (s.mascot.emotions ?? []).map(e => ({ id: e.id, mood: e.mood, imageUrl: e.imageUrl })) } : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

adminTourStepsRouter.get("/", asyncRoute(async (_req, res) => {
  const steps = await prisma.tourStep.findMany({
    include: { mascot: { include: { emotions: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return res.json({ items: steps.map(tourStepToJson) });
}));

adminTourStepsRouter.post("/", asyncRoute(async (req, res) => {
  const body = createTourStepSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });

  const created = await prisma.tourStep.create({
    data: {
      target: body.data.target,
      targetLabel: body.data.targetLabel,
      title: body.data.title,
      content: body.data.content,
      videoUrl: body.data.videoUrl ?? null,
      placement: body.data.placement ?? "bottom",
      route: body.data.route ?? null,
      mascotId: body.data.mascotId ?? null,
      mood: body.data.mood ?? "point",
      sortOrder: body.data.sortOrder ?? 0,
      isActive: body.data.isActive ?? true,
    },
    include: { mascot: { include: { emotions: true } } },
  });
  return res.status(201).json(tourStepToJson(created));
}));

// IMPORTANT: /reorder MUST be before /:id
adminTourStepsRouter.patch("/reorder", asyncRoute(async (req, res) => {
  const body = reorderTourStepsSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });

  await prisma.$transaction(
    body.data.items.map(item =>
      prisma.tourStep.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })
    )
  );
  return res.json({ success: true });
}));

adminTourStepsRouter.patch("/:id", asyncRoute(async (req, res) => {
  const idParse = tourStepIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });

  const body = updateTourStepSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });

  const data: Record<string, unknown> = {};
  if (body.data.target !== undefined) data.target = body.data.target;
  if (body.data.targetLabel !== undefined) data.targetLabel = body.data.targetLabel;
  if (body.data.title !== undefined) data.title = body.data.title;
  if (body.data.content !== undefined) data.content = body.data.content;
  if (body.data.videoUrl !== undefined) data.videoUrl = body.data.videoUrl;
  if (body.data.placement !== undefined) data.placement = body.data.placement;
  if (body.data.route !== undefined) data.route = body.data.route;
  if (body.data.mascotId !== undefined) data.mascotId = body.data.mascotId;
  if (body.data.mood !== undefined) data.mood = body.data.mood;
  if (body.data.sortOrder !== undefined) data.sortOrder = body.data.sortOrder;
  if (body.data.isActive !== undefined) data.isActive = body.data.isActive;

  const updated = await prisma.tourStep.update({
    where: { id: idParse.data.id },
    data,
    include: { mascot: { include: { emotions: true } } },
  });
  return res.json(tourStepToJson(updated));
}));

adminTourStepsRouter.delete("/:id", asyncRoute(async (req, res) => {
  const idParse = tourStepIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });

  await prisma.tourStep.delete({ where: { id: idParse.data.id } });
  return res.json({ success: true });
}));

adminTourStepsRouter.post("/seed-defaults", asyncRoute(async (_req, res) => {
  // Удаляем все существующие шаги
  await prisma.tourStep.deleteMany();

  // Берём первого встроенного маскота (если есть)
  const builtIn = await prisma.tourMascot.findFirst({ where: { isBuiltIn: true } });

  const defaults = [
    {
      target: "body",
      targetLabel: "Приветствие",
      title: "Добро пожаловать! 👋",
      content: "Привет! Это твой личный кабинет STEALTHNET. Давай я покажу, что тут есть! Тур автоматически переключит вкладки — просто нажимай «Дальше».",
      placement: "center",
      route: null,
      mascotId: builtIn?.id ?? null,
      mood: "wave",
      sortOrder: 0,
    },
    {
      target: '[data-tour="subscription"]',
      targetLabel: "Подписка",
      title: "Твоя подписка 🔑",
      content: "Здесь ты видишь статус своей VPN-подписки, оставшиеся дни и трафик.",
      placement: "bottom",
      route: "/cabinet/dashboard",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 1,
    },
    {
      target: '[data-tour="balance"]',
      targetLabel: "Баланс",
      title: "Твой баланс 💰",
      content: "Тут отображается баланс аккаунта. Пополняй и оплачивай тарифы!",
      placement: "left",
      route: "/cabinet/dashboard",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 2,
    },
    {
      target: '[data-tour="tariffs"]',
      targetLabel: "Тарифы (навигация)",
      title: "Раздел тарифов 📦",
      content: "Нажми сюда, чтобы перейти к тарифам. Сейчас я покажу тебе, что там внутри!",
      placement: "bottom",
      route: "/cabinet/dashboard",
      mascotId: builtIn?.id ?? null,
      mood: "think",
      sortOrder: 3,
    },
    {
      target: '[data-tour="tariff-list"]',
      targetLabel: "Список тарифов",
      title: "Выбирай тариф 📦",
      content: "Здесь все доступные тарифы. Выбирай подходящий по цене и возможностям!",
      placement: "top",
      route: "/cabinet/tariffs",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 4,
    },
    {
      target: '[data-tour="referrals"]',
      targetLabel: "Рефералы (навигация)",
      title: "Реферальная программа 👥",
      content: "Приглашай друзей и получай бонусы! Давай глянем подробнее...",
      placement: "bottom",
      route: "/cabinet/tariffs",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 5,
    },
    {
      target: '[data-tour="referral-link"]',
      targetLabel: "Реферальная ссылка",
      title: "Твоя реферальная ссылка 🔗",
      content: "Скопируй ссылку и отправь друзьям. За каждого приглашённого — бонусы на баланс!",
      placement: "bottom",
      route: "/cabinet/referral",
      mascotId: builtIn?.id ?? null,
      mood: "happy",
      sortOrder: 6,
    },
    {
      target: '[data-tour="referral-stats"]',
      targetLabel: "Статистика рефералов",
      title: "Статистика приглашений 📊",
      content: "Тут видно сколько друзей ты пригласил и сколько бонусов заработал. До 3 уровней глубины!",
      placement: "top",
      route: "/cabinet/referral",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 7,
    },
    {
      target: '[data-tour="profile"]',
      targetLabel: "Профиль (навигация)",
      title: "Твой профиль 👤",
      content: "Здесь можно настроить аккаунт. Давай заглянем!",
      placement: "bottom",
      route: "/cabinet/referral",
      mascotId: builtIn?.id ?? null,
      mood: "think",
      sortOrder: 8,
    },
    {
      target: '[data-tour="profile-settings"]',
      targetLabel: "Данные профиля",
      title: "Данные профиля ✏️",
      content: "Карточка с твоими личными данными — имя, email и другая информация.",
      placement: "bottom",
      route: "/cabinet/profile",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 9,
    },
    {
      target: '[data-tour="language-currency"]',
      targetLabel: "Язык и валюта",
      title: "Язык и валюта 🌐",
      content: "Выбирай удобный язык интерфейса и валюту для отображения цен.",
      placement: "bottom",
      route: "/cabinet/profile",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 10,
    },
    {
      target: '[data-tour="password-change"]',
      targetLabel: "Смена пароля",
      title: "Безопасность 🔐",
      content: "Тут можно сменить пароль от аккаунта. Рекомендуем использовать надёжный пароль!",
      placement: "top",
      route: "/cabinet/profile",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 11,
    },
    {
      target: '[data-tour="floating-chat"]',
      targetLabel: "Сообщения",
      title: "Чат и поддержка 💬",
      content: "Нужна помощь? Нажми на эту кнопку — здесь AI-ассистент и поддержка. Мы обязательно поможем!",
      placement: "left",
      route: "/cabinet/profile",
      mascotId: builtIn?.id ?? null,
      mood: "wave",
      sortOrder: 12,
    },
    {
      target: '[data-tour="gifts"]',
      targetLabel: "Подарки",
      title: "Подарки 🎁",
      content: "Здесь ты можешь купить подписку в подарок другу или активировать подарочный код для себя.",
      placement: "right",
      route: "/cabinet/profile",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 13,
    },
    {
      target: '[data-tour="gifts-buy-button"]',
      targetLabel: "Купить подарок",
      title: "Купить подписку 🛒",
      content: "Нажми сюда, чтобы купить дополнительную подписку — для себя или в подарок другу.",
      placement: "bottom",
      route: "/cabinet/gifts",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 14,
    },
    {
      target: '[data-tour="gifts-redeem"]',
      targetLabel: "Активировать код",
      title: "Активация кода 🎫",
      content: "Получил подарочный код? Введи его здесь — подписка активируется мгновенно!",
      placement: "bottom",
      route: "/cabinet/gifts",
      mascotId: builtIn?.id ?? null,
      mood: "happy",
      sortOrder: 15,
    },
    {
      target: '[data-tour="gifts-subscriptions"]',
      targetLabel: "Мои подписки",
      title: "Мои подписки 📋",
      content: "Тут отображаются все твои дополнительные подписки. Одна активирована для себя, другая подарена — удобно, правда?",
      placement: "top",
      route: "/cabinet/gifts",
      mascotId: builtIn?.id ?? null,
      mood: "happy",
      sortOrder: 16,
    },
    {
      target: '[data-tour="gifts-history"]',
      targetLabel: "История подарков",
      title: "История действий 📜",
      content: "Все действия с подарками — покупки, активации, отправки — записываются здесь.",
      placement: "top",
      route: "/cabinet/gifts",
      mascotId: builtIn?.id ?? null,
      mood: "idle",
      sortOrder: 17,
    },
    {
      target: "body",
      targetLabel: "Завершение",
      title: "Всё готово! 🎉",
      content: "Теперь ты знаешь все разделы кабинета. Удачного использования STEALTHNET! Если забудешь — тур можно перезапустить в профиле.",
      placement: "center",
      route: null,
      mascotId: builtIn?.id ?? null,
      mood: "happy",
      sortOrder: 18,
    },
  ];

  const created = await prisma.$transaction(
    defaults.map(step => prisma.tourStep.create({ data: step }))
  );

  return res.json({ items: created.map(s => tourStepToJson({ ...s, mascot: builtIn && s.mascotId === builtIn.id ? builtIn : null })) });
}));

// ——————————————————————————————————————————————————————————
// Tour Mascots CRUD
// ——————————————————————————————————————————————————————————

adminTourMascotsRouter.get("/", asyncRoute(async (_req, res) => {
  const mascots = await prisma.tourMascot.findMany({
    include: { emotions: true },
    orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }],
  });
  return res.json({ items: mascots.map(m => ({
    id: m.id, name: m.name, imageUrl: m.imageUrl, isBuiltIn: m.isBuiltIn, createdAt: m.createdAt.toISOString(),
    emotions: m.emotions.map(e => ({ id: e.id, mood: e.mood, imageUrl: e.imageUrl })),
  })) });
}));

adminTourMascotsRouter.post("/", uploadMascotImage.single("image"), asyncRoute(async (req, res) => {
  const name = typeof req.body.name === "string" && req.body.name.trim() ? req.body.name.trim() : "Маскот";
  const imageUrl = req.file ? mascotUrl(req.file.filename) : "";

  const mascot = await prisma.tourMascot.create({
    data: {
      name,
      imageUrl,
      isBuiltIn: false,
    },
    include: { emotions: true },
  });

  return res.status(201).json({
    id: mascot.id, name: mascot.name, imageUrl: mascot.imageUrl, isBuiltIn: mascot.isBuiltIn,
    createdAt: mascot.createdAt.toISOString(), emotions: [],
  });
}));

adminTourMascotsRouter.patch("/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const mascot = await prisma.tourMascot.findUnique({ where: { id } });
  if (!mascot) return res.status(404).json({ message: "Маскот не найден" });

  const name = typeof req.body.name === "string" && req.body.name.trim() ? req.body.name.trim() : undefined;
  const updated = await prisma.tourMascot.update({
    where: { id },
    data: { ...(name ? { name } : {}) },
    include: { emotions: true },
  });

  return res.json({
    id: updated.id, name: updated.name, imageUrl: updated.imageUrl, isBuiltIn: updated.isBuiltIn,
    createdAt: updated.createdAt.toISOString(),
    emotions: updated.emotions.map(e => ({ id: e.id, mood: e.mood, imageUrl: e.imageUrl })),
  });
}));

adminTourMascotsRouter.delete("/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const mascot = await prisma.tourMascot.findUnique({ where: { id } });
  if (!mascot) return res.status(404).json({ message: "Маскот не найден" });
  if (mascot.isBuiltIn) return res.status(400).json({ message: "Нельзя удалить встроенного маскота" });

  // Убираем mascotId у шагов, использующих этого маскота
  await prisma.tourStep.updateMany({ where: { mascotId: id }, data: { mascotId: null } });
  await prisma.tourMascot.delete({ where: { id } });

  // Удаляем файл
  const filename = mascot.imageUrl.split("/").pop();
  if (filename) removeUploadedFile(`mascots/${filename}`);

  return res.json({ success: true });
}));

// ——————————————————————————————————————————————————————————
// Tour Mascot Emotions CRUD
// ——————————————————————————————————————————————————————————

const validMoods = ["wave", "point", "happy", "think"] as const;

adminTourMascotsRouter.post("/:id/emotions", uploadMascotImage.single("image"), asyncRoute(async (req, res) => {
  const mascotId = req.params.id;
  const mascot = await prisma.tourMascot.findUnique({ where: { id: mascotId } });
  if (!mascot) return res.status(404).json({ message: "Маскот не найден" });
  if (!req.file) return res.status(400).json({ message: "Изображение не загружено" });

  const mood = typeof req.body.mood === "string" ? req.body.mood.trim() : "";
  if (!validMoods.includes(mood as typeof validMoods[number])) {
    removeUploadedFile(`mascots/${req.file.filename}`);
    return res.status(400).json({ message: `Недопустимая эмоция. Доступные: ${validMoods.join(", ")}` });
  }

  // Если уже есть такая эмоция — заменяем файл
  const existing = await prisma.mascotEmotion.findUnique({ where: { mascotId_mood: { mascotId, mood } } });
  if (existing) {
    const oldFilename = existing.imageUrl.split("/").pop();
    if (oldFilename) removeUploadedFile(`mascots/${oldFilename}`);

    const updated = await prisma.mascotEmotion.update({
      where: { id: existing.id },
      data: { imageUrl: mascotUrl(req.file.filename) },
    });
    return res.json({ id: updated.id, mood: updated.mood, imageUrl: updated.imageUrl });
  }

  const emotion = await prisma.mascotEmotion.create({
    data: {
      mascotId,
      mood,
      imageUrl: mascotUrl(req.file.filename),
    },
  });

  // Если это первая эмоция — установить как дефолтную картинку маскота
  if (!mascot.imageUrl) {
    await prisma.tourMascot.update({ where: { id: mascotId }, data: { imageUrl: mascotUrl(req.file.filename) } });
  }

  return res.status(201).json({ id: emotion.id, mood: emotion.mood, imageUrl: emotion.imageUrl });
}));

adminTourMascotsRouter.delete("/:id/emotions/:emotionId", asyncRoute(async (req, res) => {
  const { id: mascotId, emotionId } = req.params;
  const emotion = await prisma.mascotEmotion.findFirst({ where: { id: emotionId, mascotId } });
  if (!emotion) return res.status(404).json({ message: "Эмоция не найдена" });

  const filename = emotion.imageUrl.split("/").pop();
  if (filename) removeUploadedFile(`mascots/${filename}`);

  await prisma.mascotEmotion.delete({ where: { id: emotionId } });
  return res.json({ success: true });
}));

// ——————————————————————————————————————————————————————————
// Tour Step — Video Upload
// ——————————————————————————————————————————————————————————

adminTourStepsRouter.post("/:id/video", uploadVideo.single("video"), asyncRoute(async (req, res) => {
  const id = req.params.id;
  const step = await prisma.tourStep.findUnique({ where: { id } });
  if (!step) return res.status(404).json({ message: "Шаг не найден" });

  if (!req.file) return res.status(400).json({ message: "Видео не загружено" });

  // Удаляем старый файл если это был загруженный файл
  if (step.videoUrl?.startsWith("/api/uploads/videos/")) {
    const oldFilename = step.videoUrl.split("/").pop();
    if (oldFilename) removeUploadedFile(`videos/${oldFilename}`);
  }

  const updated = await prisma.tourStep.update({
    where: { id },
    data: { videoUrl: videoUploadUrl(req.file.filename) },
    include: { mascot: { include: { emotions: true } } },
  });
  return res.json(tourStepToJson(updated));
}));

adminTourStepsRouter.delete("/:id/video", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const step = await prisma.tourStep.findUnique({ where: { id } });
  if (!step) return res.status(404).json({ message: "Шаг не найден" });

  // Удаляем файл если это был загруженный файл
  if (step.videoUrl?.startsWith("/api/uploads/videos/")) {
    const oldFilename = step.videoUrl.split("/").pop();
    if (oldFilename) removeUploadedFile(`videos/${oldFilename}`);
  }

  const updated = await prisma.tourStep.update({
    where: { id },
    data: { videoUrl: null },
    include: { mascot: { include: { emotions: true } } },
  });
  return res.json(tourStepToJson(updated));
}));
