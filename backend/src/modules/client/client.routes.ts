import { cloudClientRouter } from "../cloudpayments/cloudpayments.routes.js";
import { Router } from "express";
import { prisma } from "../../db.js";
import { requireClientAuth, requireRemnaOnline, requireRemnaPaymentOnline } from "./client.middleware.js";
export { requireRemnaOnline };
export { requireRemnaPaymentOnline };

import { clientAuthRouter } from "./client-auth.routes.js";
import { clientProfileRouter } from "./client-profile.routes.js";
import { clientReferralsRouter } from "./client-referrals.routes.js";
import { clientTrialsPromoRouter } from "./client-trials-promo.routes.js";
import { clientSubscriptionsRouter } from "./client-subscriptions.routes.js";
import { clientPaymentsBalanceRouter } from "./client-payments-balance.routes.js";
import { clientPaymentsFiatRouter, handleYoomoneyCallback } from "./client-payments-fiat.routes.js";
import { clientPaymentsCryptoRouter } from "./client-payments-crypto.routes.js";
import { clientSlotsRouter } from "./client-slots.routes.js";
import { clientAiChatRouter } from "./client-ai-chat.routes.js";
import { clientTicketsRouter } from "./client-tickets.routes.js";
export { fetchAvailableTrialsForClient } from "./client-trials-promo.routes.js";

// Единый роутер /api/client: /auth (логин, регистрация, me) + кабинет (подписка, платежи)
export const clientRouter = Router();
clientRouter.use("/auth", clientAuthRouter);

// ЮMoney OAuth callback — без авторизации клиента (редирект с ЮMoney)
clientRouter.get("/yoomoney/callback", handleYoomoneyCallback);

// ——— Tour Steps (публичные, без авторизации — ПЕРЕД requireClientAuth!) ———
clientRouter.get("/tour-steps", async (_req, res) => {
  try {
    const steps = await prisma.tourStep.findMany({
      where: { isActive: true },
      include: { mascot: { include: { emotions: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return res.json({
      items: steps.map(s => ({
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
        mascot: s.mascot ? {
          id: s.mascot.id, name: s.mascot.name, imageUrl: s.mascot.imageUrl,
          emotions: (s.mascot.emotions ?? []).map((e: { id: string; mood: string; imageUrl: string }) => ({
            id: e.id, mood: e.mood, imageUrl: e.imageUrl,
          })),
        } : null,
      })),
    });
  } catch (e) {
    console.error("GET /tour-steps error:", e);
    return res.status(500).json({ message: "Ошибка загрузки шагов тура" });
  }
});

clientRouter.use(requireClientAuth);
clientRouter.use("/cloudpayments", cloudClientRouter);
clientRouter.use(clientProfileRouter);
clientRouter.use(clientReferralsRouter);
clientRouter.use(clientTrialsPromoRouter);
clientRouter.use(clientSlotsRouter);
clientRouter.use(clientSubscriptionsRouter);
clientRouter.use(clientPaymentsBalanceRouter);
clientRouter.use(clientPaymentsFiatRouter);
clientRouter.use(clientPaymentsCryptoRouter);
clientRouter.use(clientAiChatRouter);
clientRouter.use(clientTicketsRouter);

export { publicConfigRouter } from "./client-public.routes.js";
