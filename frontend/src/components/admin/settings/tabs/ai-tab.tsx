import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { ModelCombobox } from "@/components/model-combobox";
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

  const provider = resolveAiProviderId(settings.aiProvider, settings.groqApiKey);
  const preset = AI_PROVIDER_PRESETS[provider];
  const apiKeyValue = settings.aiApiKey ?? (provider === "groq" ? (settings.groqApiKey ?? "") : "");
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
                onChange={(e) => setSettings((s) => (s ? { ...s, aiBaseUrl: e.target.value || null } : s))}
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
    </TabsContent>
  );
}
