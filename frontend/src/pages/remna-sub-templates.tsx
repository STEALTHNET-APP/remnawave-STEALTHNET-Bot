import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type { RemnaSubTemplate, RemnaTemplateType } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Pencil,
  Loader2,
  Braces,
  Copy,
  Check,
  Download,
  CheckCircle2,
  AlertCircle,
  Settings2,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/** base64  UTF-8 (для encodedTemplateYaml клиентских шаблонов). */
function b64decode(b64: string): string {
  try { return decodeURIComponent(escape(atob(b64))); } catch { return ""; }
}
function b64encode(str: string): string {
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return ""; }
}

const TYPE_META: Record<RemnaTemplateType, { label: string; kind: "json" | "yaml"; cls: string }> = {
  XRAY_JSON: { label: "Xray JSON", kind: "json", cls: "bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/20" },
  XRAY_BASE64: { label: "Xray Base64", kind: "json", cls: "bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/20" },
  MIHOMO: { label: "Mihomo", kind: "yaml", cls: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20" },
  STASH: { label: "Stash", kind: "yaml", cls: "bg-cyan-500/10 text-cyan-500 dark:text-cyan-400 border-cyan-500/20" },
  CLASH: { label: "Clash", kind: "yaml", cls: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20" },
  SINGBOX: { label: "sing-box", kind: "yaml", cls: "bg-violet-500/10 text-violet-500 dark:text-violet-400 border-violet-500/20" },
};

export function RemnaSubTemplatesPage() {
  const { state } = useAuth();
  const token = state.accessToken!;

  const [templates, setTemplates] = useState<RemnaSubTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<RemnaSubTemplate | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState(""); // JSON-строка или YAML (декодированный)
  const [kind, setKind] = useState<"json" | "yaml">("json");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Настройки страницы подписки (API 2.8 /subscription-settings)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subSettings, setSubSettings] = useState<Record<string, unknown> | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const openSettings = async () => {
    setSettingsOpen(true);
    setSettingsLoading(true);
    try { const res = await api.getRemnaSubSettings(token); setSubSettings(res.response ?? null); }
    finally { setSettingsLoading(false); }
  };
  const setS = (k: string, v: unknown) => setSubSettings((s) => ({ ...(s ?? {}), [k]: v }));
  const saveSettings = async () => {
    if (!subSettings) return;
    setSavingSettings(true);
    try {
      await api.remnaUpdateSubSettings(token, {
        uuid: subSettings.uuid,
        profileTitle: subSettings.profileTitle,
        supportLink: subSettings.supportLink,
        profileUpdateInterval: Number(subSettings.profileUpdateInterval) || undefined,
        isProfileWebpageUrlEnabled: !!subSettings.isProfileWebpageUrlEnabled,
        serveJsonAtBaseSubscription: !!subSettings.serveJsonAtBaseSubscription,
      });
      setSettingsOpen(false);
    } catch (e) { alert(e instanceof Error ? e.message : "Ошибка сохранения"); }
    finally { setSavingSettings(false); }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getRemnaSubTemplates(token);
      setTemplates(res.response?.templates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [token]);

  const jsonValidation = useMemo(() => {
    if (kind !== "json") return { valid: true as const };
    try { JSON.parse(text); return { valid: true as const }; }
    catch (e) { return { valid: false as const, error: e instanceof Error ? e.message : "Некорректный JSON" }; }
  }, [text, kind]);

  const openEdit = async (t: RemnaSubTemplate) => {
    setEditing(t);
    setName(t.name);
    setKind(TYPE_META[t.templateType]?.kind ?? "json");
    setText("");
    setEditLoading(true);
    try {
      const res = await api.getRemnaSubTemplate(token, t.uuid);
      const full = res.response;
      if (TYPE_META[t.templateType]?.kind === "yaml") {
        setText(full?.encodedTemplateYaml ? b64decode(full.encodedTemplateYaml) : "");
      } else {
        setText(full?.templateJson != null ? JSON.stringify(full.templateJson, null, 2) : "{}");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось загрузить шаблон");
      setEditing(null);
    } finally {
      setEditLoading(false);
    }
  };

  const formatJson = () => {
    try { setText(JSON.stringify(JSON.parse(text), null, 2)); } catch { /* disabled при невалидном */ }
  };

  const handleSave = async () => {
    if (!editing) return;
    if (kind === "json" && !jsonValidation.valid) { alert("JSON невалиден."); return; }
    setSaving(true);
    try {
      const body: { uuid: string; name?: string; templateJson?: unknown; encodedTemplateYaml?: string } = {
        uuid: editing.uuid,
        name: name.trim() || editing.name,
      };
      if (kind === "yaml") body.encodedTemplateYaml = b64encode(text);
      else body.templateJson = JSON.parse(text);
      await api.remnaUpdateSubTemplate(token, body);
      setEditing(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const copyText = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const downloadText = () => {
    if (!editing) return;
    const ext = kind === "yaml" ? "yaml" : "json";
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${editing.name || "template"}.${ext}`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем шаблоны…</p>
        </Card>
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 relative">

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">Шаблоны подписки</h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Как приложения (Happ, Clash, sing-box…) видят конфиг подписки. Правьте прямо здесь — в ремну ходить не нужно.</p>
          </div>
        </div>
        <Button variant="outline" onClick={openSettings} className="gap-1.5 rounded-xl">
          <Settings2 className="h-4 w-4" /> Настройки страницы
        </Button>
      </motion.div>

      <Dialog open={settingsOpen} onOpenChange={(open) => !open && setSettingsOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">Настройки страницы подписки</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Заголовок профиля, поддержка, интервал обновления</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {settingsLoading || !subSettings ? (
            <div className="py-14 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-4 py-3">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Заголовок профиля</Label>
                <Input value={String(subSettings.profileTitle ?? "")} onChange={(e) => setS("profileTitle", e.target.value)} className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Ссылка поддержки</Label>
                <Input value={String(subSettings.supportLink ?? "")} onChange={(e) => setS("supportLink", e.target.value)} placeholder="https://t.me/…" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Интервал обновления профиля (часы)</Label>
                <Input type="number" min={1} value={Number(subSettings.profileUpdateInterval ?? 12)} onChange={(e) => setS("profileUpdateInterval", Number(e.target.value) || 12)} className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2.5">
                <input type="checkbox" checked={!!subSettings.isProfileWebpageUrlEnabled} onChange={(e) => setS("isProfileWebpageUrlEnabled", e.target.checked)} className="rounded accent-primary" />
                <span className="text-sm font-medium">Открывать веб-страницу профиля</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2.5">
                <input type="checkbox" checked={!!subSettings.serveJsonAtBaseSubscription} onChange={(e) => setS("serveJsonAtBaseSubscription", e.target.checked)} className="rounded accent-primary" />
                <span className="text-sm font-medium">Отдавать JSON на базовом URL подписки</span>
              </label>
              <DialogFooter className="mt-2 gap-2">
                <Button variant="outline" onClick={() => setSettingsOpen(false)} className="rounded-xl">Отмена</Button>
                <Button onClick={saveSettings} disabled={savingSettings} className="gap-2 rounded-xl">
                  {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Сохранить
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {templates.length === 0 ? (
        <Card className="bg-card border-border rounded-2xl p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <h3 className="text-[13.5px] font-bold tracking-tight">Нет шаблонов</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">Шаблоны создаются в Remnawave. Здесь можно их редактировать.</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {templates.map((t, idx) => {
            const meta = TYPE_META[t.templateType] ?? { label: t.templateType, kind: "json" as const, cls: "bg-foreground/[0.04] text-muted-foreground border-border" };
            return (
              <motion.div key={t.uuid} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }} whileHover={{ y: -2 }}>
                <Card
                  className="bg-card border-border rounded-2xl p-4 cursor-pointer flex items-center justify-between gap-4"
                  onClick={() => openEdit(t)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-base tracking-tight truncate">{t.name}</h3>
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium mt-1", meta.cls)}>
                        {meta.label} · {meta.kind.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg shrink-0"><Pencil className="h-4 w-4" /></Button>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">Шаблон — {editing?.name}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {editing && (TYPE_META[editing.templateType]?.label ?? editing.templateType)} · {kind === "yaml" ? "YAML (клиентский конфиг)" : "Xray JSON"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {editLoading ? (
            <div className="py-16 flex justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-4 py-3">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Название</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">{kind === "yaml" ? "YAML-шаблон" : "Xray JSON"}</Label>
                <div className="flex items-center gap-1">
                  {kind === "json" && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 rounded-lg text-xs" disabled={!jsonValidation.valid} onClick={formatJson}>
                      <Braces className="h-3.5 w-3.5" /> Формат
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 rounded-lg text-xs" onClick={copyText}>
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 rounded-lg text-xs" onClick={downloadText}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                rows={20}
                className={cn(
                  "w-full rounded-xl border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-xs font-mono leading-relaxed focus-visible:outline-none focus-visible:ring-2",
                  kind === "json" && !jsonValidation.valid ? "border-red-500/40 focus-visible:ring-red-500/40" : "border-border focus-visible:ring-primary/50"
                )}
              />
              {kind === "json" ? (
                jsonValidation.valid ? (
                  <div className="flex items-center gap-2 text-xs text-emerald-500 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> JSON валиден</div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400"><AlertCircle className="h-3.5 w-3.5 shrink-0" /> {jsonValidation.error}</div>
                )
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><AlertCircle className="h-3.5 w-3.5 shrink-0" /> YAML сохраняется как есть (кодируется в base64 автоматически). Отступы важны.</div>
              )}
              <DialogFooter className="mt-2 gap-2">
                <Button variant="outline" onClick={() => setEditing(null)} className="rounded-xl">Отмена</Button>
                <Button onClick={handleSave} disabled={saving || (kind === "json" && !jsonValidation.valid)} className="gap-2 rounded-xl">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Сохранить
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
