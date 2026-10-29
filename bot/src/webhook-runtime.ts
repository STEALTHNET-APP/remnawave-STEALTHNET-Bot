import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Update } from "grammy/types";

export type RuntimeConfig = { enabled: boolean; url: string | null; secret: string | null };
type Runner = { isRunning(): boolean; stop(): Promise<void> };

export function internalBotCredential(token: string): string {
  return token ? createHmac("sha256", token).update("stealthnet-bot-internal-v1").digest("hex") : "";
}

export function createModeController(deps: {
  config(): Promise<RuntimeConfig>;
  setWebhook(url: string, secret: string): Promise<unknown>;
  deleteWebhook(): Promise<unknown>;
  startPolling(): Runner;
}) {
  let runner: Runner | null = null;
  let mode: "polling" | "webhook" | "unavailable" = "unavailable";
  let applied: string | null = null;
  let flight: Promise<string> | null = null;
  return {
    mode: () => mode === "polling" && !runner?.isRunning() ? "unavailable" : mode,
    async stop() {
      if (flight) await flight.catch(() => {});
      if (runner) await runner.stop();
      mode = "unavailable";
      applied = null;
    },
    reload() {
      if (flight) return flight;
      flight = (async () => {
        const config = await deps.config();
        const key = JSON.stringify(config);
        if (key === applied && (mode === "webhook" || runner?.isRunning())) return mode;
        if (config.enabled && (!config.secret || !config.url?.startsWith("https://"))) throw new Error("Invalid webhook configuration");
        if (runner) { await runner.stop(); runner = null; }
        mode = "unavailable";
        applied = null;
        if (config.enabled) {
          await deps.setWebhook(config.url!, config.secret!);
          mode = "webhook";
        } else {
          await deps.deleteWebhook();
          runner = deps.startPolling();
          if (!runner.isRunning()) throw new Error("Polling failed to start");
          mode = "polling";
        }
        applied = key;
        return mode;
      })().finally(() => { flight = null; });
      return flight;
    },
  };
}

export function createUpdateProcessor(handleUpdate: (update: Update) => Promise<void>) {
  const running = new Map<number, Promise<void>>();
  const completed = new Map<number, number>();
  return (update: Update) => {
    const now = Date.now();
    for (const [id, expires] of completed) {
      if (expires > now) break;
      completed.delete(id);
    }
    if (completed.has(update.update_id)) return Promise.resolve();
    const existing = running.get(update.update_id);
    if (existing) return existing;
    if (running.size >= 100) return Promise.reject(new Error("Bot busy"));
    const promise = Promise.resolve().then(() => handleUpdate(update)).then(() => {
      completed.set(update.update_id, Date.now() + 24 * 60 * 60_000);
      if (completed.size > 50_000) completed.delete(completed.keys().next().value!);
    }).finally(() => running.delete(update.update_id));
    running.set(update.update_id, promise);
    return promise;
  };
}

export function createBotServer(options: {
  credential: string;
  mode(): string;
  reload(): Promise<string>;
  process(update: Update): Promise<void>;
}) {
  return http.createServer(async (req, res) => {
    const actual = req.headers["x-bot-internal-auth"];
    const expected = Buffer.from(options.credential);
    if (!expected.length || typeof actual !== "string" || Buffer.byteLength(actual) !== expected.length || !timingSafeEqual(expected, Buffer.from(actual))) {
      res.writeHead(401).end(); return;
    }
    res.setHeader("Content-Type", "application/json");
    const send = (status: number, body: unknown) => { if (!res.writableEnded) res.writeHead(status).end(JSON.stringify(body)); };
    try {
      if (req.method === "GET" && req.url === "/health") { send(200, { mode: options.mode() }); return; }
      if (req.method === "POST" && req.url === "/internal/reload") { send(200, { ok: true, mode: await options.reload() }); return; }
      if (req.method !== "POST" || req.url !== "/webhook") { send(404, { ok: false }); return; }
      if (options.mode() !== "webhook") { send(503, { ok: false }); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { send(413, { ok: false }); return; }
        chunks.push(Buffer.from(chunk));
      }
      let update: Update;
      try { update = JSON.parse(Buffer.concat(chunks).toString()); } catch { send(400, { ok: false }); return; }
      if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) { send(400, { ok: false }); return; }
      await options.process(update);
      send(200, { ok: true });
    } catch {
      send(503, { ok: false });
    }
  });
}
