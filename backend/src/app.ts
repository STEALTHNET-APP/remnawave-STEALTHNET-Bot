import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/index.js";
import { authRouter } from "./modules/auth/index.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { clientRouter, publicConfigRouter } from "./modules/client/client.routes.js";
import { remnaWebhooksRouter } from "./modules/webhooks/remna.webhooks.routes.js";
import { plategaWebhooksRouter } from "./modules/webhooks/platega.webhooks.routes.js";
import { yoomoneyWebhooksRouter } from "./modules/webhooks/yoomoney.webhooks.routes.js";

const app = express();

// За nginx: иначе express-rate-limit падает из-за X-Forwarded-For
app.set("trust proxy", 1);

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({
  origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
// Лимит 5MB для настроек с логотипом и favicon (data URL)
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "development" ? 2000 : 500,
  message: { message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "3.1.1" });
});

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/client", clientRouter);
app.use("/api/public", publicConfigRouter);
app.use("/api/webhooks", remnaWebhooksRouter);
app.use("/api/webhooks", plategaWebhooksRouter);
app.use("/api/webhooks", yoomoneyWebhooksRouter);

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

export default app;
