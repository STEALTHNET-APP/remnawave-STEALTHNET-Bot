import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  REMNA_API_URL: z.preprocess(
    (s) => (typeof s === "string" && s.trim() === "" ? undefined : s),
    z.string().url().optional()
  ),
  REMNA_ADMIN_TOKEN: z.string().optional(),
  CORS_ORIGIN: z.string().default("*"),
  /** Cron для авто-рассылки (например "0 9 * * *" = 9:00 каждый день). Пусто = по умолчанию 9:00. */
  AUTO_BROADCAST_CRON: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:", result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
