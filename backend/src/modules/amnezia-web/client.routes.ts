import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { buyWebRenewal, quoteWebRenewal, WebRenewalError } from "./renewal.js";
import { reconcileWebPanels } from "./service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";

export const webClientRouter = Router();
webClientRouter.get("/singbox-slots/:id/renewal", async (req, res, next) => {
  try {
    const clientId = (req as unknown as { client: { id: string } }).client.id;
    res.set("Cache-Control", "no-store").json(await quoteWebRenewal(clientId, req.params.id));
  } catch (error) {
    if (error instanceof WebRenewalError) res.status(error.status).json({ message: error.message });
    else next(error);
  }
});
webClientRouter.post("/singbox-slots/:id/renewal", async (req, res, next) => {
  try {
    const input = z.object({ requestId: z.string().uuid(), quoteHash: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(req.body);
    if (!input.success) { res.status(400).json({ message: "Некорректный запрос продления" }); return; }
    const clientId = (req as unknown as { client: { id: string } }).client.id;
    const result = await buyWebRenewal(clientId, req.params.id, input.data.requestId, input.data.quoteHash);
    await distributeReferralRewards(result.paymentId).catch(() => {});
    void reconcileWebPanels().catch(() => console.error("[Amnezia Web Panel] Не удалось запустить синхронизацию"));
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { balance: true } });
    res.status(202).json({ ...result, newBalance: client?.balance, message: "Продление оплачено. Настройки доступа обновятся автоматически; повторно платить не нужно." });
  } catch (error) {
    if (error instanceof WebRenewalError) res.status(error.status).json({ message: error.message });
    else next(error);
  }
});
