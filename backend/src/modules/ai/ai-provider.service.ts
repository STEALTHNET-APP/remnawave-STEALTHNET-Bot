import { proxyFetch } from "../proxy-util/proxy-fetch.js";

export const AI_PROVIDER_TYPES = ["gemini", "deepseek", "groq", "openrouter", "openai", "custom"] as const;

export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number];

export const AI_PROVIDERS_CONFIG: Record<AiProviderType, {
  name: string;
  baseUrl: string;
  defaultModel: string;
  modelsEndpoint: string;
  keyHintUrl?: string;
}> = {
  gemini: {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    modelsEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    keyHintUrl: "https://aistudio.google.com/app/apikey",
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    modelsEndpoint: "https://api.deepseek.com/models",
    keyHintUrl: "https://platform.deepseek.com/api_keys",
  },
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    modelsEndpoint: "https://api.groq.com/openai/v1/models",
    keyHintUrl: "https://console.groq.com/keys",
  },
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.0-flash-exp:free",
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    keyHintUrl: "https://openrouter.ai/keys",
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    modelsEndpoint: "https://api.openai.com/v1/models",
    keyHintUrl: "https://platform.openai.com/api-keys",
  },
  custom: {
    name: "Custom (OpenAI-compatible)",
    baseUrl: "",
    defaultModel: "",
    modelsEndpoint: "",
  },
};

export interface AiSettings {
  aiProvider?: string | null;
  aiApiKey?: string | null;
  aiBaseUrl?: string | null;
  aiModel?: string | null;
  aiFallback1?: string | null;
  aiFallback2?: string | null;
  aiFallback3?: string | null;
  groqApiKey?: string | null;
  groqModel?: string | null;
  groqFallback1?: string | null;
  groqFallback2?: string | null;
  groqFallback3?: string | null;
}

export interface ResolvedAiConfig {
  provider: AiProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModels: string[];
}

export interface AiChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export class AiProviderError extends Error {
  status?: number;
  details?: string;

  constructor(message: string, status?: number, details?: string) {
    super(message);
    this.name = "AiProviderError";
    this.status = status;
    this.details = details;
  }
}

export function isAiProviderType(value: unknown): value is AiProviderType {
  return typeof value === "string" && (AI_PROVIDER_TYPES as readonly string[]).includes(value);
}

function normalizeBaseUrl(url: string | null | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

function readTrimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function resolveAiConfig(cfg: AiSettings): ResolvedAiConfig {
  const requested = readTrimmed(cfg.aiProvider).toLowerCase();
  const legacyGroqKey = readTrimmed(cfg.groqApiKey);
  const provider: AiProviderType = isAiProviderType(requested)
    ? requested
    : legacyGroqKey
      ? "groq"
      : "gemini";
  const preset = AI_PROVIDERS_CONFIG[provider];

  const explicitKey = readTrimmed(cfg.aiApiKey);
  const apiKey = explicitKey || (provider === "groq" ? legacyGroqKey : "");

  const baseUrl = provider === "custom" ? normalizeBaseUrl(cfg.aiBaseUrl) : preset.baseUrl;

  const legacyModel = provider === "groq" ? readTrimmed(cfg.groqModel) : "";
  const model = readTrimmed(cfg.aiModel) || legacyModel || preset.defaultModel;

  const legacyFallbacks = provider === "groq"
    ? [cfg.groqFallback1, cfg.groqFallback2, cfg.groqFallback3]
    : [];
  const fallbackModels = [cfg.aiFallback1, cfg.aiFallback2, cfg.aiFallback3]
    .map((value, index) => readTrimmed(value) || readTrimmed(legacyFallbacks[index]))
    .filter((value): value is string => Boolean(value));

  return { provider, apiKey, baseUrl, model, fallbackModels };
}

export async function sendAiChatRequest(params: {
  provider: AiProviderType;
  apiKey: string;
  baseUrl: string;
  modelsToTry: string[];
  messages: AiChatMessage[];
  aiProxy?: string | null;
}): Promise<{ reply: string; model: string }> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  if (!baseUrl) {
    throw new AiProviderError("Не задан Base URL AI-провайдера", 400);
  }
  const endpoint = `${baseUrl}/chat/completions`;
  const models = params.modelsToTry.map(readTrimmed).filter(Boolean);

  let lastStatus: number | undefined;
  let lastDetails = "";

  for (const model of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await proxyFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: params.messages,
          temperature: 0.5,
          max_tokens: 1024,
        }),
        signal: controller.signal,
      }, params.aiProxy ?? null);

      if (response.ok) {
        const data = await response.json() as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply) return { reply, model };
        lastDetails = "Провайдер вернул пустой ответ";
        console.error(`[ai/${params.provider}] Empty response (model: ${model})`);
        continue;
      }

      lastStatus = response.status;
      lastDetails = await response.text().catch(() => "");
      console.error(`[ai/${params.provider}] Error (model: ${model}):`, response.status, lastDetails);
    } catch (err) {
      lastDetails = err instanceof Error ? err.message : String(err);
      console.error(`[ai/${params.provider}] Network/Abort error (model: ${model}):`, err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new AiProviderError("Ошибка сервиса AI или превышены лимиты", lastStatus, lastDetails);
}

export async function fetchAiModels(params: {
  provider: AiProviderType;
  apiKey: string;
  baseUrl?: string | null;
  aiProxy?: string | null;
}): Promise<string[]> {
  const preset = AI_PROVIDERS_CONFIG[params.provider];
  const baseUrl = params.provider === "custom"
    ? normalizeBaseUrl(params.baseUrl)
    : preset.baseUrl;

  if (!baseUrl) {
    throw new AiProviderError("Не задан Base URL AI-провайдера", 400);
  }

  const endpoint = params.provider === "custom"
    ? `${baseUrl}/models`
    : preset.modelsEndpoint;
  const signal = AbortSignal.timeout(10_000);

  let response: Response;
  try {
    response = await proxyFetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${params.apiKey}` },
      signal,
    }, params.aiProxy ?? null);
  } catch (err) {
    const aborted = signal.aborted;
    throw new AiProviderError(
      aborted
        ? "AI-провайдер не ответил за 10 секунд. Повторите попытку позже."
        : "Не удалось связаться с AI-провайдером. Проверьте настройки подключения и повторите попытку.",
      aborted ? 504 : undefined,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? "AI-провайдер отклонил API-ключ. Проверьте ключ в настройках."
      : response.status === 429
        ? "AI-провайдер ограничил число запросов. Повторите попытку позже."
        : response.status === 404
          ? "AI-провайдер не вернул список моделей. Проверьте Base URL."
          : "AI-провайдер временно недоступен. Повторите попытку позже.";
    throw new AiProviderError(message, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (signal.aborted) {
      throw new AiProviderError("AI-провайдер не ответил за 10 секунд. Повторите попытку позже.", 504);
    }
    throw new AiProviderError("AI-провайдер вернул некорректный список моделей");
  }

  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new AiProviderError("AI-провайдер вернул некорректный список моделей");
  }

  const filtered = ((payload as { data: unknown[] }).data)
    .filter((model): model is { id: string; active?: unknown } => {
      if (!model || typeof model !== "object" || Array.isArray(model)) return false;
      const entry = model as { id?: unknown; active?: unknown };
      return typeof entry.id === "string" && entry.id.trim().length > 0 && entry.id.length <= 200 && entry.active !== false;
    })
    .map((model) => model.id.trim().replace(/^models\//, ""))
    .filter((id) => {
      const lower = id.toLowerCase();
      return !lower.includes("whisper")
        && !lower.includes("tts")
        && !lower.includes("audio")
        && !lower.includes("embed")
        && !lower.includes("moderation");
    });

  return Array.from(new Set(filtered)).sort();
}
