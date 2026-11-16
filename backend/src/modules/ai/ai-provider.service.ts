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
    defaultModel: "gemini-flash-latest",
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
    defaultModel: "openrouter/free",
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
  const value = (url ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new AiProviderError("Некорректный Base URL AI-провайдера", 400); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AiProviderError("Base URL должен быть HTTP(S)-адресом без пароля и параметров", 400);
  }
  return parsed.toString().replace(/\/+$/, "");
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

export function resolveAiRequestConfig(cfg: AiSettings, request: {
  provider?: AiProviderType;
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string;
  fallbackModels?: string[];
}): ResolvedAiConfig {
  const saved = resolveAiConfig(cfg);
  const provider = request.provider ?? saved.provider;
  const preset = AI_PROVIDERS_CONFIG[provider];
  const baseUrl = provider === "custom"
    ? normalizeBaseUrl(request.baseUrl === undefined ? (provider === saved.provider ? saved.baseUrl : "") : request.baseUrl)
    : preset.baseUrl;
  const sameEndpoint = provider === saved.provider && baseUrl === saved.baseUrl;
  const typedKey = readTrimmed(request.apiKey);
  const apiKey = typedKey && typedKey !== "********" ? typedKey : sameEndpoint ? saved.apiKey : "";
  return {
    provider, apiKey, baseUrl,
    model: readTrimmed(request.model) || (sameEndpoint ? saved.model : preset.defaultModel),
    fallbackModels: request.fallbackModels ?? (sameEndpoint ? saved.fallbackModels : []),
  };
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
  const models = [...new Set(params.modelsToTry.map(readTrimmed).filter(Boolean))].slice(0, 4);

  let lastStatus: number | undefined;
  let lastDetails = "";

  for (const model of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await proxyFetch(endpoint, {
        method: "POST",
        redirect: "error",
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
      lastDetails = `HTTP ${response.status}`;
      await response.body?.cancel();
      console.error(`[ai/${params.provider}] Request failed:`, response.status);
      if (response.status === 401 || response.status === 403) break;
    } catch (err) {
      lastDetails = "Ошибка соединения с AI-провайдером";
      console.error(`[ai/${params.provider}] Network/Abort error`);
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
      redirect: "error",
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
      undefined,
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
