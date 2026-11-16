export const AI_PROVIDER_IDS = ["gemini", "deepseek", "groq", "openrouter", "openai", "custom"] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiProviderPreset {
  labelKey: string;
  hintKey: string;
  keyPlaceholder: string;
  keyHintUrl?: string;
  baseUrlPlaceholder?: string;
  models: string[];
}

export const AI_PROVIDER_PRESETS: Record<AiProviderId, AiProviderPreset> = {
  gemini: {
    labelKey: "admin.settings.ai_provider_gemini",
    hintKey: "admin.settings.ai_provider_gemini_hint",
    keyPlaceholder: "AIza...",
    keyHintUrl: "https://aistudio.google.com/app/apikey",
    models: ["gemini-flash-latest"],
  },
  deepseek: {
    labelKey: "admin.settings.ai_provider_deepseek",
    hintKey: "admin.settings.ai_provider_deepseek_hint",
    keyPlaceholder: "sk-...",
    keyHintUrl: "https://platform.deepseek.com/api_keys",
    models: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-pro"],
  },
  groq: {
    labelKey: "admin.settings.ai_provider_groq",
    hintKey: "admin.settings.ai_provider_groq_hint",
    keyPlaceholder: "gsk_...",
    keyHintUrl: "https://console.groq.com/keys",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
  },
  openrouter: {
    labelKey: "admin.settings.ai_provider_openrouter",
    hintKey: "admin.settings.ai_provider_openrouter_hint",
    keyPlaceholder: "sk-or-v1-...",
    keyHintUrl: "https://openrouter.ai/keys",
    models: ["openrouter/free"],
  },
  openai: {
    labelKey: "admin.settings.ai_provider_openai",
    hintKey: "admin.settings.ai_provider_openai_hint",
    keyPlaceholder: "sk-...",
    keyHintUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-4o-mini", "gpt-4o", "o3-mini"],
  },
  custom: {
    labelKey: "admin.settings.ai_provider_custom",
    hintKey: "admin.settings.ai_provider_custom_hint",
    keyPlaceholder: "sk-...",
    baseUrlPlaceholder: "http://localhost:11434/v1",
    models: ["llama3.3", "mistral", "qwen2.5"],
  },
};

export function isAiProviderId(value: string | null | undefined): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

export function resolveAiProviderId(
  provider: string | null | undefined,
  groqApiKey: string | null | undefined,
): AiProviderId {
  if (isAiProviderId(provider)) return provider;
  return groqApiKey ? "groq" : "gemini";
}

export function aiProviderDefaultModel(provider: AiProviderId): string {
  return AI_PROVIDER_PRESETS[provider].models[0] ?? "";
}
