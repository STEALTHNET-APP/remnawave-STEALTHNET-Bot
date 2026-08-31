import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type { RemnaConfigProfile, TariffRecord } from "@/lib/api";
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
import { Plus, Pencil, Trash2, Loader2, Users as UsersIcon, Copy, Check, Tag, Unlink } from "lucide-react";
import { motion } from "framer-motion";

interface InternalSquad {
  uuid: string;
  name: string;
  info?: { membersCount?: number; inboundsCount?: number };
  inbounds?: ({ uuid: string } | string)[];
}

/** Правильное русское склонение: plural(3, ["инбаунд","инбаунда","инбаундов"]). */
function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return `${n} ${forms[2]}`;
  if (last === 1) return `${n} ${forms[0]}`;
  if (last >= 2 && last <= 4) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}

export function RemnaSquadsPage() {
  const { state } = useAuth();
  const token = state.accessToken!;
  const navigate = useNavigate();

  const [squads, setSquads] = useState<InternalSquad[]>([]);
  const [profiles, setProfiles] = useState<RemnaConfigProfile[]>([]);
  const [tariffs, setTariffs] = useState<TariffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; inbounds: string[] }>({ name: "", inbounds: [] });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [squadsRaw, profRes, tariffsRes] = await Promise.all([
        api.getRemnaSquadsInternal(token),
        api.getRemnaConfigProfiles(token),
        // тарифы — чтобы показать связность «какие тарифы выдают этот сквад».
        api.getTariffs(token).catch(() => ({ items: [] as TariffRecord[] })),
      ]);
      const sr = squadsRaw as { response?: { internalSquads?: InternalSquad[] } };
      setSquads(sr.response?.internalSquads ?? []);
      setProfiles(profRes.response?.configProfiles ?? []);
      setTariffs(tariffsRes.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  /** uuid инбаунда  {tag,type,port} из config-профилей (для чипов). */
  const inboundByUuid = useMemo(() => {
    const map = new Map<string, { tag?: string; type?: string; port?: number | null }>();
    for (const p of profiles) {
      for (const ib of p.inbounds ?? []) {
        map.set(ib.uuid, { tag: ib.tag ?? undefined, type: ib.type ?? undefined, port: ib.port ?? null });
      }
    }
    return map;
  }, [profiles]);

  /** squadUuid  тарифы, которые его выдают (Tariff.internalSquadUuids). */
  const tariffsBySquad = useMemo(() => {
    const map = new Map<string, TariffRecord[]>();
    for (const t of tariffs) {
      for (const su of t.internalSquadUuids ?? []) {
        const arr = map.get(su) ?? [];
        arr.push(t);
        map.set(su, arr);
      }
    }
    return map;
  }, [tariffs]);

  const squadInboundUuids = (s: InternalSquad): string[] =>
    (s.inbounds ?? []).map((i) => (typeof i === "string" ? i : i.uuid));

  const copyUuid = (uuid: string) => {
    navigator.clipboard.writeText(uuid);
    setCopiedUuid(uuid);
    setTimeout(() => setCopiedUuid(null), 2000);
  };

  const openCreate = () => {
    setEditingUuid(null);
    setForm({ name: "", inbounds: [] });
    setShowForm(true);
  };

  const openEdit = (s: InternalSquad) => {
    setEditingUuid(s.uuid);
    setForm({
      name: s.name,
      inbounds: squadInboundUuids(s),
    });
    setShowForm(true);
  };

  const toggleInbound = (uuid: string) => {
    setForm((f) => ({
      ...f,
      inbounds: f.inbounds.includes(uuid) ? f.inbounds.filter((u) => u !== uuid) : [...f.inbounds, uuid],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingUuid) {
        await api.remnaSquadUpdate(token, editingUuid, { name: form.name.trim(), inbounds: form.inbounds });
      } else {
        await api.remnaSquadCreate(token, { name: form.name.trim(), inbounds: form.inbounds });
      }
      setShowForm(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: InternalSquad) => {
    const linked = tariffsBySquad.get(s.uuid) ?? [];
    const warn = linked.length
      ? `\n\n Сквад выдают ${plural(linked.length, ["тариф", "тарифа", "тарифов"])}: ${linked.map((t) => t.name).join(", ")} — они потеряют его.`
      : "";
    if (!confirm(`Удалить сквад «${s.name}»?${warn}`)) return;
    setBusy(s.uuid);
    try {
      await api.remnaSquadDelete(token, s.uuid);
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
          <p className="text-sm text-muted-foreground">Загружаем сквады…</p>
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
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">Сквады</h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Internal-сквады: наборы инбаундов, которые выдаются подпискам.</p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-1.5 rounded-xl">
          <Plus className="h-4 w-4" />
          Создать сквад
        </Button>
      </motion.div>

      {squads.length === 0 ? (
        <Card className="bg-card border-border rounded-2xl p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <h3 className="text-[13.5px] font-bold tracking-tight">Нет сквадов</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">Сквад — это набор инбаундов из config-профилей. Подписка получает сквад, а с ним — доступ к нодам.</p>
            <Button onClick={openCreate} className="gap-1.5 rounded-xl mt-5">
              <Plus className="h-4 w-4" />
              Создать первый сквад
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {squads.map((s, idx) => {
            const linkedTariffs = tariffsBySquad.get(s.uuid) ?? [];
            const ibUuids = squadInboundUuids(s);
            return (
              <motion.div key={s.uuid} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }} whileHover={{ y: -2 }}>
                <Card className="relative bg-card border-border rounded-2xl p-4 pl-6 overflow-visible">
                  <div className={`absolute left-2.5 top-5 bottom-5 w-1 rounded-full ${linkedTariffs.length > 0 ? "bg-violet-500" : "bg-zinc-500/50"}`} />
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-[240px] space-y-2">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="font-semibold text-base tracking-tight">{s.name}</h3>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 text-cyan-500 dark:text-cyan-400 border border-cyan-500/20 px-2.5 py-0.5 text-[11px] font-medium">
                          <UsersIcon className="h-3 w-3" /> {plural(s.info?.membersCount ?? 0, ["пользователь", "пользователя", "пользователей"])}
                        </span>
                      </div>
                      {/* Инбаунды сквада — читаемые теги вместо голого счётчика */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground shrink-0">{plural(s.info?.inboundsCount ?? ibUuids.length, ["инбаунд", "инбаунда", "инбаундов"])}:</span>
                        {ibUuids.length === 0 && <span className="text-[11px] text-muted-foreground/60">нет</span>}
                        {ibUuids.map((u) => {
                          const ib = inboundByUuid.get(u);
                          return (
                            <code key={u} className="font-mono text-[11px] bg-foreground/[0.04] dark:bg-white/[0.03] border border-border px-1.5 py-0.5 rounded text-muted-foreground">
                              {ib?.tag ?? u.slice(0, 8)}{ib?.port ? ` :${ib.port}` : ""}
                            </code>
                          );
                        })}
                      </div>
                      {/* Связность: какие тарифы выдают этот сквад */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {linkedTariffs.length > 0 ? (
                          <>
                            <span className="text-[11px] text-muted-foreground shrink-0 inline-flex items-center gap-1"><Tag className="h-3 w-3" /> {plural(linkedTariffs.length, ["тариф", "тарифа", "тарифов"])}:</span>
                            {linkedTariffs.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                title="Открыть тарифы"
                                onClick={() => navigate("/admin/tariffs")}
                                className="rounded-full bg-violet-500/10 text-violet-500 dark:text-violet-400 border border-violet-500/20 px-2.5 py-0.5 text-[11px] font-medium hover:bg-violet-500/20 transition-colors"
                              >
                                {t.name}
                              </button>
                            ))}
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60 inline-flex items-center gap-1">
                            <Unlink className="h-3 w-3" /> не привязан ни к одному тарифу — подписки его не получат
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Скопировать UUID" onClick={() => copyUuid(s.uuid)}>
                        {copiedUuid === s.uuid ? <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Редактировать" onClick={() => openEdit(s)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" title="Удалить" disabled={busy === s.uuid} onClick={() => handleDelete(s)}>
                        {busy === s.uuid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
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
                <DialogTitle className="text-base font-bold tracking-tight">{editingUuid ? "Редактировать" : "Создать"} сквад</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Название и набор инбаундов</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Название</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Premium" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Инбаунды (из config-профилей)</Label>
              <div className="grid gap-2 rounded-xl border border-border bg-foreground/[0.02] p-3 max-h-72 overflow-y-auto">
                {profiles.length === 0 && <span className="text-xs text-muted-foreground">Нет профилей с инбаундами.</span>}
                {profiles.map((p) => (
                  <div key={p.uuid}>
                    <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{p.name}</div>
                    <div className="grid gap-1">
                      {(p.inbounds ?? []).length === 0 && <span className="text-xs text-muted-foreground/70 px-1">— нет инбаундов —</span>}
                      {(p.inbounds ?? []).map((ib) => (
                        <label key={ib.uuid} className="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-foreground/5">
                          <input type="checkbox" className="rounded accent-primary" checked={form.inbounds.includes(ib.uuid)} onChange={() => toggleInbound(ib.uuid)} />
                          <span className="text-sm font-mono">{ib.tag ?? ib.uuid.slice(0, 8)}</span>
                          {ib.type && <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">{ib.type}{ib.port ? ` :${ib.port}` : ""}</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter className="mt-2 gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-xl">Отмена</Button>
              <Button onClick={handleSave} disabled={saving || !form.name.trim() || form.inbounds.length === 0} className="gap-2 rounded-xl">
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
