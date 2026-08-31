import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type { RemnaConfigProfile, RemnaHost } from "@/lib/api";
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
import { Plus, Pencil, Trash2, Loader2, Network, Power, Settings2, ChevronDown, CheckSquare, Square, X } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface HostForm {
  remark: string;
  address: string;
  port: number;
  configProfileUuid: string;
  configProfileInboundUuid: string;
  sni: string;
  host: string;
  path: string;
  tags: string;
  security: string;
  alpn: string;
  fingerprint: string;
  isDisabled: boolean;
}

const EMPTY: HostForm = {
  remark: "",
  address: "",
  port: 443,
  configProfileUuid: "",
  configProfileInboundUuid: "",
  sni: "",
  host: "",
  path: "",
  tags: "",
  security: "",
  alpn: "",
  fingerprint: "",
  isDisabled: false,
};

const FINGERPRINTS = ["chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random", "randomized"];
const ALPN_OPTIONS = ["h3", "h2", "http/1.1", "h2,http/1.1", "h3,h2,http/1.1", "h3,h2"];

export function RemnaHostsPage() {
  const { state } = useAuth();
  const token = state.accessToken!;

  const [hosts, setHosts] = useState<RemnaHost[]>([]);
  const [profiles, setProfiles] = useState<RemnaConfigProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [form, setForm] = useState<HostForm>(EMPTY);
  // Bulk-выделение хостов (API 2.8 /hosts/bulk/{enable|disable|delete}).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const toggleSel = (uuid: string) => setSelected((prev) => { const n = new Set(prev); n.has(uuid) ? n.delete(uuid) : n.add(uuid); return n; });
  const bulkAction = async (action: "enable" | "disable" | "delete") => {
    const uuids = [...selected];
    if (uuids.length === 0) return;
    if (action === "delete" && !confirm(`Удалить ${uuids.length} хост(ов)? Действие необратимо.`)) return;
    setBulkBusy(true);
    try { await api.remnaHostsBulk(token, action, uuids); setSelected(new Set()); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Ошибка массового действия"); }
    finally { setBulkBusy(false); }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [hostsRes, profRes, tagsRes] = await Promise.all([
        api.getRemnaHosts(token),
        api.getRemnaConfigProfiles(token),
        api.getRemnaHostTags(token).catch(() => null),
      ]);
      const raw = hostsRes.response;
      const list = Array.isArray(raw) ? raw : raw?.hosts ?? [];
      setHosts(list);
      setProfiles(profRes.response?.configProfiles ?? []);
      setTags(tagsRes?.response?.tags ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.uuid === form.configProfileUuid),
    [profiles, form.configProfileUuid],
  );

  const inboundTag = (h: RemnaHost): string => {
    const iu = h.inbound?.configProfileInboundUuid;
    if (!iu) return "—";
    for (const p of profiles) {
      const ib = (p.inbounds ?? []).find((x) => x.uuid === iu);
      if (ib) return ib.tag ?? iu.slice(0, 8);
    }
    return iu.slice(0, 8);
  };

  const openCreate = () => {
    setEditingUuid(null);
    setShowAdvanced(false);
    const first = profiles[0];
    const firstInb = first?.inbounds?.[0];
    setForm({
      ...EMPTY,
      configProfileUuid: first?.uuid ?? "",
      configProfileInboundUuid: firstInb?.uuid ?? "",
      port: firstInb?.port ?? EMPTY.port,
    });
    setShowForm(true);
  };

  const openEdit = (h: RemnaHost) => {
    setEditingUuid(h.uuid);
    const raw = h as unknown as { securityLayer?: string; alpn?: string; fingerprint?: string };
    const sec = raw.securityLayer && raw.securityLayer !== "DEFAULT" ? raw.securityLayer : "";
    setForm({
      remark: h.remark ?? "",
      address: h.address ?? "",
      port: h.port ?? 443,
      configProfileUuid: h.inbound?.configProfileUuid ?? profiles[0]?.uuid ?? "",
      configProfileInboundUuid: h.inbound?.configProfileInboundUuid ?? "",
      sni: h.sni ?? "",
      host: h.host ?? "",
      path: h.path ?? "",
      tags: (h.tags ?? []).join(", "),
      security: sec,
      alpn: raw.alpn ?? "",
      fingerprint: raw.fingerprint ?? "",
      isDisabled: !!h.isDisabled,
    });
    setShowAdvanced(!!(h.tags?.length || sec || raw.alpn || raw.fingerprint));
    setShowForm(true);
  };

  const onProfileChange = (uuid: string) => {
    const prof = profiles.find((p) => p.uuid === uuid);
    const firstInb = prof?.inbounds?.[0];
    setForm((f) => ({ ...f, configProfileUuid: uuid, configProfileInboundUuid: firstInb?.uuid ?? "", port: firstInb?.port ?? f.port }));
  };

  // Порт хоста берётся из выбранного инбаунда (как в Remnawave), но остаётся редактируемым — для схем за CDN/reverse-proxy.
  const onInboundChange = (inboundUuid: string) => {
    const prof = profiles.find((p) => p.uuid === form.configProfileUuid);
    const ib = prof?.inbounds?.find((x) => x.uuid === inboundUuid);
    setForm((f) => ({ ...f, configProfileInboundUuid: inboundUuid, port: ib?.port ?? f.port }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        remark: form.remark.trim(),
        address: form.address.trim(),
        port: form.port,
        inbound: {
          configProfileUuid: form.configProfileUuid,
          configProfileInboundUuid: form.configProfileInboundUuid,
        },
        isDisabled: form.isDisabled,
      };
      if (form.sni.trim()) body.sni = form.sni.trim();
      if (form.host.trim()) body.host = form.host.trim();
      if (form.path.trim()) body.path = form.path.trim();
      const tags = form.tags.split(/[\s,;]+/).map((t) => t.trim().toUpperCase().replace(/[^A-Z0-9_:]/g, "")).filter(Boolean);
      if (tags.length) body.tags = tags;
      if (form.security) body.securityLayer = form.security;
      if (form.alpn) body.alpn = form.alpn;
      if (form.fingerprint) body.fingerprint = form.fingerprint;
      if (editingUuid) {
        await api.remnaHostUpdate(token, editingUuid, body);
      } else {
        await api.remnaHostCreate(token, body);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (h: RemnaHost) => {
    if (!confirm(`Удалить хост «${h.remark || h.address}»?`)) return;
    setBusy(h.uuid);
    try {
      await api.remnaHostDelete(token, h.uuid);
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
          <p className="text-sm text-muted-foreground">Загружаем хосты…</p>
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
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">Хосты</h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Точки подключения (host-строки) для инбаундов, попадают в подписку клиента.</p>
          </div>
        </div>
        <Button onClick={openCreate} disabled={profiles.length === 0} className="gap-1.5 rounded-xl">
          <Plus className="h-4 w-4" />
          Добавить хост
        </Button>
      </motion.div>

      {selected.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="sticky top-3 z-30 flex items-center gap-2 flex-wrap rounded-xl border border-border bg-primary/[0.07] px-4 py-2.5"
        >
          <span className="text-sm font-semibold text-primary inline-flex items-center gap-2">
            <CheckSquare className="h-4 w-4" /> Выбрано: {selected.size}
          </span>
          <span className="flex-1" />
          <Button variant="outline" size="sm" className="rounded-lg gap-1.5" disabled={bulkBusy} onClick={() => bulkAction("enable")}>
            {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />} Включить
          </Button>
          <Button variant="outline" size="sm" className="rounded-lg gap-1.5" disabled={bulkBusy} onClick={() => bulkAction("disable")}>
            {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />} Отключить
          </Button>
          <Button variant="outline" size="sm" className="rounded-lg gap-1.5 text-red-500 dark:text-red-400 hover:bg-red-500/10" disabled={bulkBusy} onClick={() => bulkAction("delete")}>
            {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Удалить
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Снять выделение" onClick={() => setSelected(new Set())}>
            <X className="h-4 w-4" />
          </Button>
        </motion.div>
      )}

      {tags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Тег:</span>
          <button type="button" onClick={() => setTagFilter(null)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", tagFilter === null ? "border-border bg-primary/10 text-primary" : "border-border bg-foreground/[0.03] dark:bg-white/[0.02] text-muted-foreground hover:text-foreground")}>Все</button>
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => setTagFilter(t === tagFilter ? null : t)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", tagFilter === t ? "border-border bg-primary/10 text-primary" : "border-border bg-foreground/[0.03] dark:bg-white/[0.02] text-muted-foreground hover:text-foreground")}>{t}</button>
          ))}
        </div>
      )}

      {hosts.length === 0 ? (
        <Card className="bg-card border-border rounded-2xl p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <h3 className="text-[13.5px] font-bold tracking-tight">Нет хостов</h3>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Добавьте первый хост.</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {(tagFilter ? hosts.filter((h) => (h.tags ?? []).includes(tagFilter)) : hosts).map((h, idx) => (
            <motion.div key={h.uuid} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }} whileHover={{ y: -2 }}>
              <Card className={cn("bg-card border-border rounded-2xl p-4 transition-colors", selected.has(h.uuid) && "ring-1 ring-primary/40 border-border")}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <button type="button" onClick={() => toggleSel(h.uuid)} className="shrink-0 text-muted-foreground hover:text-primary transition-colors" title="Выбрать для массового действия">
                    {selected.has(h.uuid) ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
                  </button>
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="font-semibold text-base tracking-tight">{h.remark || "(без названия)"}</h3>
                      {h.isDisabled ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20 px-2.5 py-0.5 text-[11px] font-medium">Отключён</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium">Активен</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                      <code className="font-mono text-xs bg-foreground/[0.04] dark:bg-white/[0.03] border border-border px-2 py-0.5 rounded-md text-foreground">{h.address}{h.port ? `:${h.port}` : ""}</code>
                      <span className="text-muted-foreground/40">•</span>
                      <span className="inline-flex items-center gap-1"><Network className="h-3 w-3" /> {inboundTag(h)}</span>
                      {h.sni && (<><span className="text-muted-foreground/40">•</span><span>SNI {h.sni}</span></>)}
                      {(h.tags ?? []).map((t) => (
                        <button key={t} type="button" onClick={(e) => { e.stopPropagation(); setTagFilter(t); }} className="rounded-full bg-primary/10 text-primary border border-border px-2 py-0.5 text-[10px] font-medium hover:bg-primary/20 transition-colors">#{t}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Редактировать" onClick={() => openEdit(h)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" title="Удалить" disabled={busy === h.uuid} onClick={() => handleDelete(h)}>
                      {busy === h.uuid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(open) => !open && setShowForm(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
                {editingUuid ? <Pencil className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
              </div>
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">{editingUuid ? "Редактировать" : "Добавить"} хост</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Адрес, порт и привязка к инбаунду</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Название (remark)</Label>
              <Input value={form.remark} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} placeholder=" Germany" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-1.5 col-span-2">
                <Label className="text-xs text-muted-foreground">Адрес (домен)</Label>
                <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="de1.example.com" className="font-mono rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Порт (из инбаунда)</Label>
                <Input type="number" value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) || 0 }))} className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Config-профиль</Label>
              <select
                className="flex h-10 w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                value={form.configProfileUuid}
                onChange={(e) => onProfileChange(e.target.value)}
              >
                {profiles.map((p) => (<option key={p.uuid} value={p.uuid}>{p.name}</option>))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Инбаунд</Label>
              <select
                className="flex h-10 w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                value={form.configProfileInboundUuid}
                onChange={(e) => onInboundChange(e.target.value)}
              >
                <option value="">Выберите инбаунд</option>
                {(selectedProfile?.inbounds ?? []).map((ib) => (
                  <option key={ib.uuid} value={ib.uuid}>{ib.tag ?? String(ib.uuid ?? "").slice(0, 8)}{ib.type ? ` · ${ib.type}` : ""}{ib.port ? ` · :${ib.port}` : ""}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">SNI</Label>
                <Input value={form.sni} onChange={(e) => setForm((f) => ({ ...f, sni: e.target.value }))} placeholder="необязательно" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Host</Label>
                <Input value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} placeholder="необязательно" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Path</Label>
              <Input value={form.path} onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))} placeholder="необязательно" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
            </div>

            <button type="button" onClick={() => setShowAdvanced((s) => !s)} className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
              <Settings2 className="h-3.5 w-3.5" /> Расширенные параметры
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")} />
            </button>
            {showAdvanced && (
              <div className="space-y-4 rounded-xl border border-border bg-foreground/[0.02] p-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Теги (через запятую)</Label>
                  <Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value.toUpperCase() }))} placeholder="PREMIUM, EU" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Только A–Z, 0–9, «_» и «:» (нижний регистр авто-конвертируется).</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">Security Layer</Label>
                    <select
                      className="flex h-10 w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      value={form.security}
                      onChange={(e) => setForm((f) => ({ ...f, security: e.target.value }))}
                    >
                      <option value="">По умолчанию</option>
                      <option value="TLS">TLS</option>
                      <option value="NONE">None</option>
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">Отпечаток (fingerprint)</Label>
                    <select
                      className="flex h-10 w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      value={form.fingerprint}
                      onChange={(e) => setForm((f) => ({ ...f, fingerprint: e.target.value }))}
                    >
                      <option value="">—</option>
                      {FINGERPRINTS.map((fp) => <option key={fp} value={fp}>{fp}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">ALPN</Label>
                  <select
                    className="flex h-10 w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    value={form.alpn}
                    onChange={(e) => setForm((f) => ({ ...f, alpn: e.target.value }))}
                  >
                    <option value="">По умолчанию</option>
                    {ALPN_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            )}

            <label className={cn(
              "flex items-center gap-2 cursor-pointer rounded-xl border px-3 py-2.5 transition-colors",
              form.isDisabled ? "border-zinc-500/30 bg-zinc-500/5" : "border-border bg-foreground/[0.03] dark:bg-white/[0.02]"
            )}>
              <input type="checkbox" checked={form.isDisabled} onChange={(e) => setForm((f) => ({ ...f, isDisabled: e.target.checked }))} className="rounded accent-zinc-500" />
              <Power className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Отключён</span>
            </label>

            <DialogFooter className="mt-2 gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-xl">Отмена</Button>
              <Button onClick={handleSave} disabled={saving || !form.remark.trim() || !form.address.trim() || !form.configProfileInboundUuid} className="gap-2 rounded-xl">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingUuid ? "Сохранить" : "Добавить"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
