import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type { RemnaConfigProfile } from "@/lib/api";
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
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Server as ServerIcon,
  Copy,
  Check,
  Download,
  Braces,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { motion } from "framer-motion";

/** Правильное русское склонение: plural(3, ["инбаунд","инбаунда","инбаундов"]). */
function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return `${n} ${forms[2]}`;
  if (last === 1) return `${n} ${forms[0]}`;
  if (last >= 2 && last <= 4) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}

const DEFAULT_CONFIG = `{
  "log": { "loglevel": "warning" },
  "inbounds": [],
  "outbounds": [
    { "protocol": "freedom", "tag": "DIRECT" },
    { "protocol": "blackhole", "tag": "BLOCK" }
  ],
  "routing": { "rules": [] }
}`;

// Стартовые Xray-шаблоны (как «шаблоны» в Remnawave). Теги инбаундов уникальны в рамках панели.
const TEMPLATES: { name: string; config: string }[] = [
  {
    name: "Shadowsocks",
    config: `{
  "log": { "loglevel": "info" },
  "inbounds": [
    {
      "tag": "Shadowsocks",
      "port": 1234,
      "protocol": "shadowsocks",
      "settings": { "method": "chacha20-ietf-poly1305", "clients": [], "network": "tcp,udp" },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "DIRECT" },
    { "protocol": "blackhole", "tag": "BLOCK" }
  ],
  "routing": { "rules": [] }
}`,
  },
  {
    name: "VLESS Reality",
    config: `{
  "log": { "loglevel": "info" },
  "inbounds": [
    {
      "tag": "VLESS-REALITY",
      "port": 443,
      "protocol": "vless",
      "settings": { "clients": [], "decryption": "none" },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "google.com:443",
          "xver": 0,
          "serverNames": ["google.com"],
          "privateKey": "ЗАМЕНИТЬ_приватным_ключом_x25519",
          "shortIds": [""]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "DIRECT" },
    { "protocol": "blackhole", "tag": "BLOCK" }
  ],
  "routing": { "rules": [] }
}`,
  },
  {
    name: "VLESS Vision TLS",
    config: `{
  "log": { "loglevel": "info" },
  "inbounds": [
    {
      "tag": "VLESS-Vision",
      "port": 443,
      "protocol": "vless",
      "settings": { "clients": [], "decryption": "none" },
      "streamSettings": {
        "network": "tcp",
        "security": "tls",
        "tlsSettings": {
          "certificates": [
            { "certificateFile": "/etc/ssl/fullchain.pem", "keyFile": "/etc/ssl/privkey.pem" }
          ]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "DIRECT" },
    { "protocol": "blackhole", "tag": "BLOCK" }
  ],
  "routing": { "rules": [] }
}`,
  },
  {
    name: "Trojan TLS",
    config: `{
  "log": { "loglevel": "info" },
  "inbounds": [
    {
      "tag": "Trojan-TLS",
      "port": 443,
      "protocol": "trojan",
      "settings": { "clients": [] },
      "streamSettings": {
        "network": "tcp",
        "security": "tls",
        "tlsSettings": {
          "certificates": [
            { "certificateFile": "/etc/ssl/fullchain.pem", "keyFile": "/etc/ssl/privkey.pem" }
          ]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "DIRECT" },
    { "protocol": "blackhole", "tag": "BLOCK" }
  ],
  "routing": { "rules": [] }
}`,
  },
];

export function RemnaProfilesPage() {
  const { state } = useAuth();
  const token = state.accessToken!;
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState<RemnaConfigProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [configText, setConfigText] = useState(DEFAULT_CONFIG);

  const configValidation = useMemo(() => {
    try {
      const parsed = JSON.parse(configText) as { inbounds?: unknown[] };
      const inbounds = Array.isArray(parsed?.inbounds) ? parsed.inbounds.length : 0;
      return { valid: true as const, inbounds };
    } catch (e) {
      return { valid: false as const, error: e instanceof Error ? e.message : "Некорректный JSON" };
    }
  }, [configText]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getRemnaConfigProfiles(token);
      setProfiles(res.response?.configProfiles ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const openCreate = () => {
    setEditingUuid(null);
    setName("");
    setConfigText(DEFAULT_CONFIG);
    setShowForm(true);
  };

  const openEdit = (p: RemnaConfigProfile) => {
    setEditingUuid(p.uuid);
    setName(p.name);
    try {
      setConfigText(JSON.stringify(p.config ?? {}, null, 2));
    } catch {
      setConfigText(DEFAULT_CONFIG);
    }
    setShowForm(true);
  };

  const applyTemplate = (t: { name: string; config: string }) => {
    if (configText.trim() && configText !== DEFAULT_CONFIG && !confirm(`Заменить текущий конфиг шаблоном «${t.name}»?`)) return;
    setConfigText(t.config);
  };

  const formatConfig = () => {
    try {
      setConfigText(JSON.stringify(JSON.parse(configText), null, 2));
    } catch {
      /* кнопка отключена при невалидном JSON */
    }
  };

  const copyUuid = (uuid: string) => {
    navigator.clipboard.writeText(uuid);
    setCopiedUuid(uuid);
    setTimeout(() => setCopiedUuid(null), 2000);
  };

  const downloadConfig = (p: RemnaConfigProfile) => {
    const blob = new Blob([JSON.stringify(p.config ?? {}, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.name || "profile"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!configValidation.valid) {
      alert("Config не является корректным JSON.");
      return;
    }
    const config = JSON.parse(configText);
    setSaving(true);
    try {
      if (editingUuid) {
        await api.remnaConfigProfileUpdate(token, editingUuid, { name: name.trim(), config });
      } else {
        await api.remnaConfigProfileCreate(token, { name: name.trim(), config });
      }
      setShowForm(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: RemnaConfigProfile) => {
    if (!confirm(`Удалить профиль «${p.name}»? Ноды и хосты, привязанные к нему, потеряют конфигурацию.`)) return;
    setBusy(p.uuid);
    try {
      await api.remnaConfigProfileDelete(token, p.uuid);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем профили…</p>
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
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">Config-профили</h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Xray-конфигурации с инбаундами. К профилю привязываются ноды, хосты и сквады.</p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-1.5 rounded-xl">
          <Plus className="h-4 w-4" />
          Создать профиль
        </Button>
      </motion.div>

      {profiles.length === 0 ? (
        <Card className="bg-card border-border rounded-2xl p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <h3 className="text-[13.5px] font-bold tracking-tight">Нет профилей</h3>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Создайте первый config-профиль.</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {profiles.map((p, idx) => (
            <motion.div key={p.uuid} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }} whileHover={{ y: -2 }}>
              <Card className="bg-card border-border rounded-2xl p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="font-semibold text-base tracking-tight">{p.name}</h3>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20 px-2.5 py-0.5 text-[11px] font-medium">{plural((p.inbounds ?? []).length, ["инбаунд", "инбаунда", "инбаундов"])}</span>
                      {(p.nodes?.length ?? 0) > 0 && (
                        <button
                          type="button"
                          title={`Ноды: ${(p.nodes ?? []).map((nd) => (typeof nd === "string" ? nd : ((nd as { name?: string; uuid?: string }).name ?? (nd as { uuid?: string }).uuid?.slice(0, 8) ?? ""))).join(", ")} — открыть раздел «Ноды»`}
                          onClick={() => navigate("/admin/remna-nodes")}
                          className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 text-cyan-500 dark:text-cyan-400 border border-cyan-500/20 px-2.5 py-0.5 text-[11px] font-medium hover:bg-cyan-500/20 transition-colors"
                        ><ServerIcon className="h-3 w-3" /> {plural(p.nodes?.length ?? 0, ["нода", "ноды", "нод"])}</button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="font-mono text-[10px] text-muted-foreground/70">{String(p.uuid ?? "").slice(0, 8)}…</code>
                      {(p.inbounds ?? []).map((ib) => (
                        <code key={ib.uuid} className="font-mono text-[11px] bg-foreground/[0.04] dark:bg-white/[0.03] border border-border px-1.5 py-0.5 rounded text-muted-foreground">{ib.tag ?? String(ib.uuid ?? "").slice(0, 8)}{ib.port ? ` :${ib.port}` : ""}</code>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Скопировать UUID" onClick={() => copyUuid(p.uuid)}>
                      {copiedUuid === p.uuid ? <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Скачать config" onClick={() => downloadConfig(p)}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Редактировать Xray-конфиг" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" title="Удалить" disabled={busy === p.uuid} onClick={() => handleDelete(p)}>
                      {busy === p.uuid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(open) => !open && setShowForm(false)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
                {editingUuid ? <Pencil className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
              </div>
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">{editingUuid ? "Редактировать" : "Создать"} config-профиль</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Xray-конфигурация в формате JSON. Теги инбаундов должны быть уникальны.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Название</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main profile" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Шаблон:</span>
              {TEMPLATES.map((t) => (
                <button key={t.name} type="button" onClick={() => applyTemplate(t)} className="rounded-lg border border-border bg-foreground/[0.03] dark:bg-white/[0.02] hover:border-border hover:text-primary px-2.5 py-1 text-xs transition-colors">
                  {t.name}
                </button>
              ))}
              <div className="flex-1" />
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 rounded-lg text-xs" disabled={!configValidation.valid} onClick={formatConfig}>
                <Braces className="h-3.5 w-3.5" /> Форматировать
              </Button>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Config (Xray JSON)</Label>
              <textarea
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                spellCheck={false}
                rows={18}
                className={`w-full rounded-xl border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-xs font-mono leading-relaxed focus-visible:outline-none focus-visible:ring-2 ${configValidation.valid ? "border-border focus-visible:ring-primary/50" : "border-red-500/40 focus-visible:ring-red-500/40"}`}
              />
              {configValidation.valid ? (
                <div className="flex items-center gap-2 text-xs text-emerald-500 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Xray-конфиг валиден · {configValidation.inbounds} инбаунд(ов)
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" /> Ошибка JSON: {configValidation.error}
                </div>
              )}
            </div>

            <DialogFooter className="mt-2 gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-xl">Отмена</Button>
              <Button onClick={handleSave} disabled={saving || !name.trim() || !configValidation.valid} className="gap-2 rounded-xl">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingUuid ? "Сохранить" : "Создать"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
