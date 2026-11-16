import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, RefreshCw, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { ModelCombobox } from "@/components/model-combobox";
import { cn } from "@/lib/utils";
import { api, type AdminSettings } from "@/lib/api";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_PRESETS,
  aiProviderDefaultModel,
  isAiProviderId,
  resolveAiProviderId,
  type AiProviderId,
} from "@/lib/ai-providers";

const SECRET_MASK = "********";

function isMasked(value: string | null | undefined): boolean {
  return value === SECRET_MASK;
}

type TestMessage = {
  role: "user" | "assistant";
  content: string;
  latencyMs?: number;
  model?: string;
};

export function AiTab({
  settings,
  setSettings,
  token,
  saving,
}: {
  settings: AdminSettings;
  setSettings: Dispatch<SetStateAction<AdminSettings | null>>;
  token: string;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [loadedModels, setLoadedModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsMessage, setModelsMessage] = useState<string | null>(null);
  const [testMessages, setTestMessages] = useState<TestMessage[]>([]);
  const [testInput, setTestInput] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const provider = resolveAiProviderId(settings.aiProvider, settings.groqApiKey);
  const preset = AI_PROVIDER_PRESETS[provider];
  const apiKeyValue = settings.aiApiKey || (provider === "groq" ? (settings.groqApiKey ?? "") : "");
  const legacyModel = provider === "groq" ? settings.groqModel : null;
  const modelValue = (settings.aiModel ?? "").trim() || (legacyModel ?? "").trim() || aiProviderDefaultModel(provider);
  const fallbackValues = [
    settings.aiFallback1 ?? (provider === "groq" ? settings.groqFallback1 : null) ?? null,
    settings.aiFallback2 ?? (provider === "groq" ? settings.groqFallback2 : null) ?? null,
    settings.aiFallback3 ?? (provider === "groq" ? settings.groqFallback3 : null) ?? null,
  ];
  const modelOptions = Array.from(new Set([
    ...loadedModels,
    ...preset.models,
    modelValue,
    ...fallbackValues.filter((value): value is string => Boolean(value)),
  ].filter(Boolean)));

  function updateModel(value: string | null) {
    setSettings((s) => (s ? { ...s, aiModel: value } : s));
  }

  function updateFallback(index: 0 | 1 | 2, value: string | null) {
    const field = (["aiFallback1", "aiFallback2", "aiFallback3"] as const)[index];
    setSettings((s) => (s ? { ...s, [field]: value } : s));
  }

  function handleProviderChange(value: string) {
    const next: AiProviderId = isAiProviderId(value) ? value : "gemini";
    setLoadedModels([]);
    setModelsMessage(null);
    setSettings((s) => (s ? {
      ...s,
      aiProvider: next,
      aiApiKey: null,
      aiModel: aiProviderDefaultModel(next),
      aiFallback1: null,
      aiFallback2: null,
      aiFallback3: null,
    } : s));
  }

  async function handleLoadModels() {
    setLoadingModels(true);
    setModelsMessage(null);
    try {
      const res = await api.getAiModels(token, {
        provider,
        apiKey: isMasked(apiKeyValue) ? undefined : (apiKeyValue || undefined),
        baseUrl: provider === "custom" ? (settings.aiBaseUrl || undefined) : undefined,
      });
      setLoadedModels(res.models);
      setModelsMessage(res.models.length
        ? t("admin.settings.ai_models_loaded", { count: res.models.length })
        : t("admin.settings.ai_models_empty"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setModelsMessage(t("admin.settings.ai_models_error", { message }));
    } finally {
      setLoadingModels(false);
    }
  }

  function resetTestChat() {
    setTestMessages([]);
    setTestError(null);
    setTestInput("");
  }

  async function handleTestSend() {
    const message = testInput.trim();
    if (!message || testLoading) return;
    const history = testMessages.map(({ role, content }) => ({ role, content }));
    setTestMessages((prev) => [...prev, { role: "user", content: message }]);
    setTestInput("");
    setTestError(null);
    setTestLoading(true);
    try {
      const res = await api.testAiChat(token, {
        provider,
        apiKey: isMasked(apiKeyValue) ? undefined : (apiKeyValue || undefined),
        baseUrl: provider === "custom" ? (settings.aiBaseUrl || undefined) : undefined,
        model: modelValue,
        fallbackModels: fallbackValues.filter((value): value is string => Boolean(value) && value !== modelValue),
        systemPrompt: settings.aiSystemPrompt ?? undefined,
        message,
        history,
      });
      if (res.ok && res.reply) {
        setTestMessages((prev) => [...prev, {
          role: "assistant",
          content: res.reply ?? "",
          latencyMs: res.latencyMs,
          model: res.model,
        }]);
      } else {
        const status = res.status ? ` ${res.status}` : "";
        setTestError(`${t("admin.settings.ai_test_error")}${status}: ${res.error || t("admin.settings.ai_test_unknown_error")}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTestError(`${t("admin.settings.ai_test_error")}: ${message}`);
    } finally {
      setTestLoading(false);
    }
  }

  return (
    <TabsContent value="ai">
      <Card className="overflow-hidden border-border">
        <div className="relative bg-muted p-4 border-b border-border">
          <div className="absolute inset-0 bg-transparent pointer-events-none" />
          <div className="relative flex items-start gap-5">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                {t("admin.settings.ai_title")}
              </h2>
              <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.ai_subtitle")} {t("admin.settings.ai_integration_hint")}</p>
            </div>
          </div>
        </div>
        <CardContent className="space-y-4 p-4 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ai-provider">{t("admin.settings.ai_provider")}</Label>
              <select
                id="ai-provider"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
              >
                {AI_PROVIDER_IDS.map((id) => (
                  <option key={id} value={id}>{t(AI_PROVIDER_PRESETS[id].labelKey)}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t(preset.hintKey)}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-api-key">{t("admin.settings.ai_api_key")}</Label>
              <Input
                id="ai-api-key"
                type="password"
                value={apiKeyValue}
                onChange={(e) => setSettings((s) => (s ? { ...s, aiApiKey: e.target.value || null } : s))}
                placeholder={preset.keyPlaceholder}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{t("admin.settings.ai_key_hint")}</p>
              {preset.keyHintUrl && (
                <a
                  href={preset.keyHintUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {t("admin.settings.ai_get_key")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          {provider === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="ai-base-url">{t("admin.settings.ai_base_url")}</Label>
              <Input
                id="ai-base-url"
                value={settings.aiBaseUrl ?? ""}
                onChange={(e) => setSettings((s) => (s ? { ...s, aiBaseUrl: e.target.value || null, aiApiKey: null } : s))}
                placeholder={preset.baseUrlPlaceholder}
              />
              <p className="text-xs text-muted-foreground">{t("admin.settings.ai_base_url_hint")}</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("admin.settings.ai_model")}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingModels}
                onClick={handleLoadModels}
              >
                {loadingModels ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                {t("admin.settings.ai_load_models")}
              </Button>
            </div>
            <ModelCombobox
              options={modelOptions}
              value={modelValue}
              onChange={updateModel}
              placeholder={aiProviderDefaultModel(provider)}
            />
            <p className="text-xs text-muted-foreground">{t("admin.settings.ai_model_hint")}</p>
            {modelsMessage && <p className="text-xs text-muted-foreground">{modelsMessage}</p>}
          </div>

          <div className="space-y-2">
            <Label>{t("admin.settings.ai_fallback")}</Label>
            <p className="text-xs text-muted-foreground mb-2">{t("admin.settings.ai_fallback_hint")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([0, 1, 2] as const).map((index) => (
                <div key={index} className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t("admin.settings.ai_no_fallback")} {index + 1}</span>
                  <ModelCombobox
                    options={modelOptions}
                    value={fallbackValues[index]}
                    onChange={(value) => updateFallback(index, value)}
                    placeholder={preset.models[index + 1] ?? ""}
                    allowEmpty
                    emptyLabel={t("admin.settings.ai_no_fallback")}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("admin.settings.ai_system_prompt")}</Label>
            <textarea
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={settings.aiSystemPrompt ?? ""}
              onChange={(e) => setSettings((s) => (s ? { ...s, aiSystemPrompt: e.target.value } : s))}
              placeholder="Ты — лучший менеджер техподдержки VPN-сервиса..."
            />
            <p className="text-xs text-muted-foreground">{t("admin.settings.ai_prompt_hint")}</p>
          </div>
          <div className="pt-2 border-t">
            <Button type="submit" disabled={saving} className="min-w-[140px]">
              {saving ? t("admin.settings.saving") : t("admin.settings.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 overflow-hidden border-border">
        <div className="border-b border-border bg-muted p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                {t("admin.settings.ai_test_title")}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">{t("admin.settings.ai_test_hint")}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetTestChat}
              disabled={testLoading || (testMessages.length === 0 && !testError)}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              {t("admin.settings.ai_test_clear")}
            </Button>
          </div>
        </div>
        <CardContent className="space-y-3 p-4">
          <div className="min-h-[120px] max-h-[340px] space-y-3 overflow-y-auto rounded-lg border border-border bg-background p-3">
            {testMessages.length === 0 && !testLoading && (
              <p className="py-6 text-center text-xs text-muted-foreground">{t("admin.settings.ai_test_empty")}</p>
            )}
            {testMessages.map((item, index) => (
              <div key={index} className={cn("flex", item.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                    item.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                  )}
                >
                  {item.content}
                  {item.role === "assistant" && (
                    <div className="mt-1.5 text-[11px] font-medium text-muted-foreground">
                      ⚡ {item.model || modelValue} • {item.latencyMs ?? 0} {t("admin.settings.ai_test_ms")}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {testLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("admin.settings.ai_test_thinking")}
              </div>
            )}
          </div>
          {testError && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {testError}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleTestSend();
                }
              }}
              placeholder={t("admin.settings.ai_test_placeholder")}
              disabled={testLoading}
              className="h-10"
            />
            <Button
              type="button"
              onClick={() => void handleTestSend()}
              disabled={testLoading || !testInput.trim()}
              className="shrink-0"
            >
              {testLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="ml-1.5 hidden sm:inline">{t("admin.settings.ai_test_send")}</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
