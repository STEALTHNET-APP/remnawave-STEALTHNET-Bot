import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type {
  RemnaNode,
  RemnaConfigProfile,
  RemnaNodeCreatePayload,
  RemnaNodeUsersUsageResponse,
  RemnaSystemStats,
  RemnaNodesMetricsResponse,
  RemnaBandwidthStatsResponse,
  RemnaInfraBillingNodesResponse,
  RemnaRecapResponse,
  RemnaHwidStatsResponse,
  RemnaHwidTopUsersResponse,
} from "@/lib/api";
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
  Server,
  Power,
  RefreshCw,
  Terminal,
  Copy,
  Check,
  Gauge,
  Users as UsersIcon,
  Wifi,
  WifiOff,
  BarChart3,
  Cpu,
  Clock,
  ArrowDown,
  ArrowUp,
  Activity,
  MoreVertical,
  MemoryStick,
  Globe,
  ChevronDown,
  RotateCcw,
  CalendarClock,
  HardDrive,
  ShieldAlert,
  Trophy,
  Sparkles,
  Puzzle,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "0";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb % 1 === 0 ? 0 : 1)} ГБ`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(0)} МБ`;
  // суб-мегабайтные значения не схлопываем в «0 МБ» — честные КБ.
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

function formatUptime(sec?: number | null): string {
  if (!sec || sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d ? `${d}д` : "", h ? `${h}ч` : "", `${m}м`].filter(Boolean).join(" ");
}

function formatRate(bps?: number | null): string {
  if (!bps || bps <= 0) return "0 КБ/с";
  const kb = bps / 1024;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} МБ/с`;
  return `${kb.toFixed(1)} КБ/с`;
}

/**  из ISO-кода страны (регионrandom indicator symbols). */
function flagEmoji(cc?: string | null): string {
  const code = (cc ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** CPU % из loadAvg[0] / cpus (приближение, как в htop-обзорах). */
function cpuPct(n: RemnaNode): number | null {
  const load = n.system?.stats?.loadAvg?.[0];
  const cpus = n.system?.info?.cpus;
  if (load == null || !cpus) return null;
  return Math.min(100, Math.round((load / cpus) * 100));
}

function ramPct(n: RemnaNode): number | null {
  const used = n.system?.stats?.memoryUsed ?? 0;
  const total = n.system?.info?.memoryTotal ?? 0;
  if (!total) return null;
  return Math.min(100, Math.round((used / total) * 100));
}

function barColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

/** Мини-бар «подпись + % + полоска» для строки ноды. */
function MiniBar({ label, pct, color }: { label: string; pct: number; color?: string }) {
  return (
    <div className="w-24">
      <div className="flex items-center justify-between text-[10px] leading-none mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-foreground/[0.08] dark:bg-white/[0.08] overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-700", color ?? barColor(pct))} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

interface NodeForm {
  name: string;
  address: string;
  port: number;
  countryCode: string;
  consumptionMultiplier: number;
  trafficLimitGb: number;
  isTrafficTrackingActive: boolean;
  note: string;
  activeConfigProfileUuid: string;
  activeInbounds: string[];
}

const EMPTY_FORM: NodeForm = {
  name: "",
  address: "",
  port: 2222,
  countryCode: "",
  consumptionMultiplier: 1,
  trafficLimitGb: 0,
  isTrafficTrackingActive: true,
  note: "",
  activeConfigProfileUuid: "",
  activeInbounds: [],
};

const REFRESH_MS = 15_000;

export function RemnaNodesPage() {
  const { state } = useAuth();
  const token = state.accessToken!;

  const [nodes, setNodes] = useState<RemnaNode[]>([]);
  const [profiles, setProfiles] = useState<RemnaConfigProfile[]>([]);
  const [pubKey, setPubKey] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  // Обзор самой панели Remnawave (юзеры по статусам, RAM, uptime) — чтобы не ходить в ремну.
  const [panelStats, setPanelStats] = useState<RemnaSystemStats["response"] | null>(null);
  // Метрики нод (инбаунды/аутбаунды + провайдер) — для «Система»-диалога.
  const [nodeMetrics, setNodeMetrics] = useState<NonNullable<NonNullable<RemnaNodesMetricsResponse["response"]>["nodes"]>>([]);
  // Сводка трафика панели (сегодня/7д/месяц) + ближайшие оплаты серверов (infra-billing).
  const [bandwidth, setBandwidth] = useState<RemnaBandwidthStatsResponse["response"] | null>(null);
  const [billingNodes, setBillingNodes] = useState<NonNullable<NonNullable<RemnaInfraBillingNodesResponse["response"]>["billingNodes"]>>([]);
  const [recap, setRecap] = useState<RemnaRecapResponse["response"] | null>(null);
  // Инфра-биллинг: управление провайдерами + привязка нод к оплате.
  const [billingOpen, setBillingOpen] = useState(false);
  const [providers, setProviders] = useState<{ uuid: string; name: string; loginUrl?: string; faviconLink?: string }[]>([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderUrl, setNewProviderUrl] = useState("");
  const [billForm, setBillForm] = useState<{ providerUuid: string; nodeUuid: string; date: string }>({ providerUuid: "", nodeUuid: "", date: "" });
  const [billBusy, setBillBusy] = useState(false);
  // HWID (устройства) + торрент-блокер — по кнопкам в шапке.
  const [hwidOpen, setHwidOpen] = useState(false);
  const [hwidStats, setHwidStats] = useState<RemnaHwidStatsResponse["response"] | null>(null);
  const [hwidTop, setHwidTop] = useState<RemnaHwidTopUsersResponse["response"] | null>(null);
  const [hwidLoading, setHwidLoading] = useState(false);
  const [torrentOpen, setTorrentOpen] = useState(false);
  const [torrentStats, setTorrentStats] = useState<Record<string, unknown> | null>(null);
  const [torrentReports, setTorrentReports] = useState<unknown[]>([]);
  const [torrentLoading, setTorrentLoading] = useState(false);
  // Плагины нод (API 2.8 node-plugins): список + удаление.
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [plugins, setPlugins] = useState<{ uuid: string; name: string }[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [form, setForm] = useState<NodeForm>(EMPTY_FORM);

  const [installNode, setInstallNode] = useState<RemnaNode | null>(null);
  // «Система» хранит uuid (не снапшот) — диалог живой: обновляется вместе со списком.
  const [detailUuid, setDetailUuid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedStep, setCopiedStep] = useState<string | null>(null);
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const [statsNode, setStatsNode] = useState<RemnaNode | null>(null);
  const [statsDays, setStatsDays] = useState(7);
  const [statsData, setStatsData] = useState<RemnaNodeUsersUsageResponse["response"] | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const detailNode = useMemo(() => nodes.find((n) => n.uuid === detailUuid) ?? null, [nodes, detailUuid]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nodesRes, profRes, keyRes, statsRes, metricsRes, bwRes, billRes, recapRes] = await Promise.all([
        api.getRemnaNodes(token),
        api.getRemnaConfigProfiles(token),
        api.getRemnaPubKey(token).catch(() => ({ response: { pubKey: "" } })),
        api.getRemnaSystemStats(token).catch(() => null),
        api.getRemnaNodesMetrics(token).catch(() => null),
        api.getRemnaBandwidthStats(token).catch(() => null),
        api.getRemnaInfraBillingNodes(token).catch(() => null),
        api.getRemnaRecap(token).catch(() => null),
      ]);
      setNodes(nodesRes.response ?? []);
      setProfiles(profRes.response?.configProfiles ?? []);
      setPubKey(keyRes.response?.pubKey ?? "");
      setPanelStats(statsRes?.response ?? null);
      setNodeMetrics(metricsRes?.response?.nodes ?? []);
      setBandwidth(bwRes?.response ?? null);
      setBillingNodes(billRes?.response?.billingNodes ?? []);
      setRecap(recapRes?.response ?? null);
      setRefreshedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  // Живая панель: тихо перечитываем список нод каждые 15 секунд —
  // метрики CPU/RAM/сеть приходят вместе со списком, отдельных запросов не нужно.
  const formOpenRef = useRef(false);
  formOpenRef.current = showForm;
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden || formOpenRef.current) return;
      try {
        const [res, statsRes, metricsRes, bwRes] = await Promise.all([
          api.getRemnaNodes(token),
          api.getRemnaSystemStats(token).catch(() => null),
          api.getRemnaNodesMetrics(token).catch(() => null),
          api.getRemnaBandwidthStats(token).catch(() => null),
        ]);
        setNodes(res.response ?? []);
        if (statsRes?.response) setPanelStats(statsRes.response);
        if (metricsRes?.response?.nodes) setNodeMetrics(metricsRes.response.nodes);
        if (bwRes?.response) setBandwidth(bwRes.response);
        setRefreshedAt(Date.now());
      } catch { /* тихий фон — не роняем страницу */ }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [token]);

  const openHwid = async () => {
    setHwidOpen(true);
    setHwidLoading(true);
    try {
      const [st, top] = await Promise.all([
        api.getRemnaHwidStats(token).catch(() => null),
        api.getRemnaHwidTopUsers(token).catch(() => null),
      ]);
      setHwidStats(st?.response ?? null);
      setHwidTop(top?.response ?? null);
    } finally { setHwidLoading(false); }
  };

  const openTorrent = async () => {
    setTorrentOpen(true);
    setTorrentLoading(true);
    try {
      const [st, rep] = await Promise.all([
        api.getRemnaTorrentStats(token).catch(() => null),
        api.getRemnaTorrentReports(token).catch(() => null),
      ]);
      // живая 2.8: { response: { stats: {...}, topUsers, topNodes } } — берём вложенный stats
      const sResp = (st as { response?: { stats?: unknown } & Record<string, unknown> } | null)?.response;
      const statsObj = (sResp?.stats && typeof sResp.stats === "object" ? sResp.stats : sResp) as Record<string, unknown> | undefined;
      setTorrentStats(statsObj && typeof statsObj === "object" ? statsObj : null);
      const rResp = (rep as { response?: unknown } | null)?.response;
      const rObj = (rResp && typeof rResp === "object" ? rResp : {}) as Record<string, unknown>;
      const arr = Array.isArray(rResp) ? rResp
        : Array.isArray(rObj.reports) ? (rObj.reports as unknown[])
        : Array.isArray(rObj.records) ? (rObj.records as unknown[])
        : [];
      setTorrentReports(arr);
    } finally { setTorrentLoading(false); }
  };

  const openBilling = async () => {
    setBillingOpen(true);
    setBillingLoading(true);
    try {
      const [prov, bill] = await Promise.all([
        api.getRemnaInfraProviders(token).catch(() => null),
        api.getRemnaInfraBillingNodes(token).catch(() => null),
      ]);
      setProviders(prov?.response?.providers ?? []);
      setBillingNodes(bill?.response?.billingNodes ?? []);
    } finally { setBillingLoading(false); }
  };
  const createProvider = async () => {
    if (!newProviderName.trim()) return;
    setBillBusy(true);
    try { await api.remnaCreateInfraProvider(token, { name: newProviderName.trim(), loginUrl: newProviderUrl.trim() || undefined }); setNewProviderName(""); setNewProviderUrl(""); await openBilling(); }
    catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
    finally { setBillBusy(false); }
  };
  const deleteProvider = async (uuid: string, name: string) => {
    if (!confirm(`Удалить провайдера «${name}»? Привязки нод к нему тоже уйдут.`)) return;
    try { await api.remnaDeleteInfraProvider(token, uuid); await openBilling(); }
    catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
  };
  const createBillingNode = async () => {
    if (!billForm.providerUuid || !billForm.nodeUuid || !billForm.date) { alert("Выберите провайдера, ноду и дату"); return; }
    setBillBusy(true);
    try {
      await api.remnaCreateInfraBillingNode(token, { providerUuid: billForm.providerUuid, nodeUuid: billForm.nodeUuid, nextBillingAt: new Date(billForm.date).toISOString() });
      setBillForm({ providerUuid: "", nodeUuid: "", date: "" });
      await openBilling();
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
    finally { setBillBusy(false); }
  };
  const deleteBillingNode = async (uuid: string) => {
    if (!confirm("Убрать ноду из биллинга?")) return;
    try { await api.remnaDeleteInfraBillingNode(token, uuid); await openBilling(); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
  };

  const openPlugins = async () => {
    setPluginsOpen(true);
    setPluginsLoading(true);
    try {
      const res = await api.getRemnaNodePlugins(token).catch(() => null);
      const r = (res as { response?: unknown } | null)?.response;
      const ro = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const arr = Array.isArray(r) ? r
        : Array.isArray(ro.nodePlugins) ? (ro.nodePlugins as unknown[])
        : Array.isArray(ro.plugins) ? (ro.plugins as unknown[])
        : [];
      setPlugins((arr as Record<string, unknown>[]).map((p) => ({ uuid: String(p.uuid ?? ""), name: String(p.name ?? "—") })).filter((p) => p.uuid));
    } finally { setPluginsLoading(false); }
  };
  const deletePlugin = async (uuid: string, name: string) => {
    if (!confirm(`Удалить плагин «${name}»?`)) return;
    try { await api.remnaDeleteNodePlugin(token, uuid); setPlugins((ps) => ps.filter((p) => p.uuid !== uuid)); }
    catch (e) { alert(e instanceof Error ? e.message : "Ошибка удаления"); }
  };

  const kpi = useMemo(() => {
    const online = nodes.filter((n) => !n.isDisabled && n.isConnected).length;
    const offline = nodes.filter((n) => !n.isDisabled && !n.isConnected).length;
    const disabled = nodes.filter((n) => n.isDisabled).length;
    const users = nodes.reduce((s, n) => s + (n.usersOnline ?? 0), 0);
    const traffic = nodes.reduce((s, n) => s + Number(n.trafficUsedBytes ?? 0), 0);
    return { online, offline, disabled, users, traffic };
  }, [nodes]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.uuid === form.activeConfigProfileUuid),
    [profiles, form.activeConfigProfileUuid],
  );

  const openCreate = () => {
    setEditingUuid(null);
    const first = profiles[0];
    setForm({
      ...EMPTY_FORM,
      activeConfigProfileUuid: first?.uuid ?? "",
      activeInbounds: (first?.inbounds ?? []).map((i) => i.uuid),
    });
    setShowForm(true);
  };

  const openEdit = (n: RemnaNode) => {
    setEditingUuid(n.uuid);
    const raw = n as unknown as {
      configProfile?: { activeConfigProfileUuid?: string; activeInbounds?: (string | { uuid: string })[] };
      consumptionMultiplier?: number;
      note?: string;
    };
    const profUuid = raw.configProfile?.activeConfigProfileUuid ?? profiles[0]?.uuid ?? "";
    const prof = profiles.find((p) => p.uuid === profUuid);
    const inbounds = (raw.configProfile?.activeInbounds ?? []).map((i) =>
      typeof i === "string" ? i : i.uuid,
    );
    setForm({
      name: n.name,
      address: n.address,
      port: n.port ?? 2222,
      countryCode: n.countryCode ?? "",
      consumptionMultiplier: raw.consumptionMultiplier ?? 1,
      trafficLimitGb: n.trafficLimitBytes ? Number(n.trafficLimitBytes) / 1024 ** 3 : 0,
      isTrafficTrackingActive: n.isTrafficTrackingActive ?? true,
      note: raw.note ?? "",
      activeConfigProfileUuid: profUuid,
      activeInbounds: inbounds.length ? inbounds : (prof?.inbounds ?? []).map((i) => i.uuid),
    });
    setShowForm(true);
  };

  const copyNodeUuid = (uuid: string) => {
    navigator.clipboard.writeText(uuid);
    setCopiedUuid(uuid);
    setTimeout(() => setCopiedUuid(null), 2000);
  };

  const onProfileChange = (uuid: string) => {
    const prof = profiles.find((p) => p.uuid === uuid);
    setForm((f) => ({
      ...f,
      activeConfigProfileUuid: uuid,
      activeInbounds: (prof?.inbounds ?? []).map((i) => i.uuid),
    }));
  };

  const toggleInbound = (uuid: string) => {
    setForm((f) => ({
      ...f,
      activeInbounds: f.activeInbounds.includes(uuid)
        ? f.activeInbounds.filter((u) => u !== uuid)
        : [...f.activeInbounds, uuid],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: RemnaNodeCreatePayload = {
        name: form.name.trim(),
        address: form.address.trim(),
        port: form.port || undefined,
        countryCode: form.countryCode.trim().toUpperCase() || undefined,
        consumptionMultiplier: form.consumptionMultiplier || undefined,
        trafficLimitBytes: form.trafficLimitGb > 0 ? Math.round(form.trafficLimitGb * 1024 ** 3) : undefined,
        isTrafficTrackingActive: form.isTrafficTrackingActive,
        note: form.note.trim() || undefined,
        configProfile: {
          activeConfigProfileUuid: form.activeConfigProfileUuid,
          activeInbounds: form.activeInbounds,
        },
      };
      if (editingUuid) {
        await api.remnaNodeUpdate(token, editingUuid, payload);
      } else {
        await api.remnaNodeCreate(token, payload);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (uuid: string, action: "enable" | "disable" | "restart") => {
    setBusy(uuid + action);
    try {
      if (action === "enable") await api.remnaNodeEnable(token, uuid);
      else if (action === "disable") await api.remnaNodeDisable(token, uuid);
      else await api.remnaNodeRestart(token, uuid);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (n: RemnaNode) => {
    if (!confirm(`Удалить ноду «${n.name}»? Это действие необратимо.`)) return;
    setBusy(n.uuid + "del");
    try {
      await api.remnaNodeDelete(token, n.uuid);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setBusy(null);
    }
  };

  const openStats = async (n: RemnaNode, days = 7) => {
    setStatsNode(n);
    setStatsDays(days);
    setStatsLoading(true);
    setStatsData(null);
    try {
      const res = await api.getRemnaNodeUsersUsage(token, n.uuid, days);
      setStatsData(res.response ?? null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка загрузки статистики");
    } finally {
      setStatsLoading(false);
    }
  };

  const composeYaml = (port: number) =>
    `services:
  remnanode:
    container_name: remnanode
    hostname: remnanode
    image: remnawave/node:latest
    restart: always
    network_mode: host
    environment:
      - NODE_PORT=${port || 2222}
      - SECRET_KEY="${pubKey || "<ключ появится после загрузки панели>"}"`;

  const installCommand = (n: RemnaNode) => composeYaml(n.port ?? 2222);

  const copyYaml = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyStep = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedStep(key);
    setTimeout(() => setCopiedStep(null), 2000);
  };

  function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
      <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4">
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">{icon} {label}</div>
        <div className="text-sm font-medium mt-1 truncate">{value}</div>
      </div>
    );
  }

  function KpiCard({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: string; sub?: string; tone?: "emerald" | "red" | "primary" | "cyan" }) {
    const toneCls =
      tone === "emerald" ? "bg-muted text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
      : tone === "red" ? "bg-muted text-red-500 dark:text-red-400 border-red-500/20"
      : tone === "cyan" ? "bg-muted text-cyan-500 dark:text-cyan-400 border-cyan-500/20"
      : "bg-muted text-primary border-border";
    return (
      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
        <div className={cn("h-10 w-10 rounded-xl  border flex items-center justify-center shrink-0", toneCls)}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground leading-none">{label}</div>
          <div className="text-[13.5px] font-bold tracking-tight tabular-nums leading-tight mt-1 truncate">{value}</div>
          {sub && <div className="text-[10px] text-muted-foreground/70 leading-none mt-0.5 truncate">{sub}</div>}
        </div>
      </div>
    );
  }

  function InstallStep({ n, title, cmd }: { n: number; title: string; cmd: string }) {
    const key = "s" + n;
    return (
      <div className="flex gap-3">
        <div className="h-6 w-6 rounded-full bg-primary/15 border border-border text-primary text-xs font-bold flex items-center justify-center shrink-0">{n}</div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-sm font-medium">{title}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-[11px] font-mono bg-foreground/[0.04] dark:bg-white/[0.03] border border-border rounded-lg px-2.5 py-1.5 overflow-x-auto whitespace-nowrap">{cmd}</code>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg shrink-0" title="Копировать команду" onClick={() => copyStep(cmd, key)}>
              {copiedStep === key ? <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function StatusBadge({ n }: { n: RemnaNode }) {
    if (n.isDisabled) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20 px-2.5 py-0.5 text-[11px] font-medium">
          <Power className="h-3 w-3" /> Отключена
        </span>
      );
    }
    if (n.isConnected) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Онлайн
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-500 dark:text-red-400 border border-red-500/20 px-2.5 py-0.5 text-[11px] font-medium">
        <WifiOff className="h-3 w-3" /> {n.isConnecting ? "Подключается…" : "Не в сети"}
      </span>
    );
  }

  /** Пункт kebab-меню. */
  function MenuItem({ icon, label, danger, disabled, onClick }: { icon: ReactNode; label: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={cn(
          "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors text-left disabled:opacity-50",
          danger ? "text-red-500 dark:text-red-400 hover:bg-red-500/10" : "hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06]"
        )}
      >
        <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        {label}
      </button>
    );
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем ноды…</p>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400">
          {error}
        </div>
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
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
              Ноды
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">
              Регистрация и управление нодами Remnawave прямо из панели.
              {refreshedAt && (
                <span className="inline-flex items-center gap-1.5 ml-2 text-[11px] text-emerald-500/90 dark:text-emerald-400/90">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  live · каждые 15 с
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" className="gap-1.5 rounded-xl" onClick={openHwid} title="Устройства (HWID) по платформам">
            <HardDrive className="h-4 w-4" /> Устройства
          </Button>
          <Button variant="outline" className="gap-1.5 rounded-xl" onClick={openTorrent} title="Торрент-блокер: статистика и отчёты">
            <ShieldAlert className="h-4 w-4" /> Торренты
          </Button>
          <Button variant="outline" className="gap-1.5 rounded-xl" onClick={openPlugins} title="Плагины нод">
            <Puzzle className="h-4 w-4" /> Плагины
          </Button>
          <Button variant="outline" className="gap-1.5 rounded-xl" onClick={openBilling} title="Оплаты серверов (инфра-биллинг)">
            <CalendarClock className="h-4 w-4" /> Оплаты
          </Button>
          {nodes.length > 1 && (
            <Button
              variant="outline"
              className="gap-1.5 rounded-xl"
              disabled={busy === "restart-all"}
              onClick={async () => {
                if (!confirm(`Перезапустить ВСЕ ноды (${nodes.length})? Активные соединения клиентов кратко оборвутся.`)) return;
                setBusy("restart-all");
                try { await api.remnaRestartAllNodes(token); await load(); }
                catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
                finally { setBusy(null); }
              }}
            >
              {busy === "restart-all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Перезапустить все
            </Button>
          )}
          <Button onClick={openCreate} disabled={profiles.length === 0} className="gap-1.5 rounded-xl">
            <Plus className="h-4 w-4" />
            Добавить ноду
          </Button>
        </div>
      </motion.div>

      {nodes.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard icon={<Server className="h-5 w-5" />} label="Всего нод" value={String(nodes.length)} sub={kpi.disabled > 0 ? `${kpi.disabled} отключено` : undefined} tone="primary" />
          <KpiCard icon={<Wifi className="h-5 w-5" />} label="Онлайн" value={String(kpi.online)} sub={kpi.offline > 0 ? `${kpi.offline} не в сети` : "все на связи"} tone={kpi.offline > 0 ? "red" : "emerald"} />
          <KpiCard icon={<UsersIcon className="h-5 w-5" />} label="Юзеров онлайн" value={String(kpi.users)} tone="cyan" />
          <KpiCard icon={<Gauge className="h-5 w-5" />} label="Трафик суммарно" value={formatBytes(kpi.traffic)} tone="primary" />
        </motion.div>
      )}

      {/* Обзор самой панели Remnawave — юзеры по статусам, RAM и uptime control-plane */}
      {panelStats && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-x-5 gap-y-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-primary" /> Панель Remnawave
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs">
            <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <b className="tabular-nums">{panelStats.users?.totalUsers ?? 0}</b>
            <span className="text-muted-foreground">юзеров</span>
          </span>
          {([
            ["ACTIVE", "активных", "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"],
            ["EXPIRED", "истекло", "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20"],
            ["LIMITED", "лимит", "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20"],
            ["DISABLED", "отключено", "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20"],
          ] as const).map(([key, label, cls]) => (
            <span key={key} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums", cls)}>
              {panelStats.users?.statusCounts?.[key] ?? 0} {label}
            </span>
          ))}
          {bandwidth && (
            <span className="inline-flex items-center gap-2.5 text-[11px] text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              {bandwidth.bandwidthLastTwoDays?.current != null && (
                <span>сегодня <b className="text-foreground tabular-nums">{bandwidth.bandwidthLastTwoDays.current}</b></span>
              )}
              {bandwidth.bandwidthLastSevenDays?.current != null && (
                <span>7 дн <b className="text-foreground tabular-nums">{bandwidth.bandwidthLastSevenDays.current}</b></span>
              )}
              {(bandwidth.bandwidthCalendarMonth ?? bandwidth.bandwidthLast30Days)?.current != null && (
                <span>30 дн <b className="text-foreground tabular-nums">{(bandwidth.bandwidthCalendarMonth ?? bandwidth.bandwidthLast30Days)!.current}</b></span>
              )}
            </span>
          )}
          <span className="flex-1" />
          {(panelStats.memory?.total ?? 0) > 0 && (
            <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
              <MemoryStick className="h-3.5 w-3.5" /> RAM
              <span className="inline-block w-20 h-1 rounded-full bg-foreground/[0.08] dark:bg-white/[0.08] overflow-hidden align-middle">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round(((panelStats.memory?.used ?? 0) / (panelStats.memory!.total!)) * 100))}%` }} />
              </span>
              <span className="tabular-nums">{formatBytes(panelStats.memory?.used)} / {formatBytes(panelStats.memory?.total)}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> uptime {formatUptime(panelStats.uptime)}
          </span>
        </motion.div>
      )}

      {/* Инфра-биллинг (API 2.8): ближайшие оплаты серверов — чтобы не проспать продление */}
      {billingNodes.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-x-5 gap-y-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 text-primary" /> Оплаты серверов
          </span>
          {[...billingNodes]
            .sort((a, b) => new Date(a.nextBillingAt ?? 0).getTime() - new Date(b.nextBillingAt ?? 0).getTime())
            .slice(0, 4)
            .map((b) => {
              const d = b.nextBillingAt ? new Date(b.nextBillingAt) : null;
              const days = d ? Math.ceil((d.getTime() - Date.now()) / 86_400_000) : null;
              const tone = days == null ? "" : days < 0 ? "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20" : days <= 3 ? "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20" : "bg-foreground/[0.04] dark:bg-white/[0.03] text-muted-foreground border-border";
              return (
                <span key={b.uuid} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", tone)}>
                  {flagEmoji(b.node?.countryCode)} {b.node?.name ?? "—"}
                  {b.provider?.name && <span className="opacity-70">· {b.provider.name}</span>}
                  {d && (
                    <b className="tabular-nums">
                      {d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
                      {days != null && ` (${days < 0 ? `просрочено ${-days} дн` : days === 0 ? "сегодня" : `через ${days} дн`})`}
                    </b>
                  )}
                </span>
              );
            })}
          {billingNodes.length > 4 && <span className="text-[11px] text-muted-foreground/60">+ ещё {billingNodes.length - 4}</span>}
        </motion.div>
      )}

      {/* Recap: суммарная сводка панели (API 2.8 /system/stats/recap) */}
      {recap?.total && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-x-5 gap-y-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Сводка
          </span>
          {recap.thisMonth && (
            <span className="inline-flex items-center gap-1.5 text-xs rounded-full bg-primary/10 text-primary border border-border px-2.5 py-0.5">
              за месяц: <b className="tabular-nums">{recap.thisMonth.users ?? 0}</b> юзеров · <b className="tabular-nums">{formatBytes(Number(recap.thisMonth.traffic) || 0)}</b>
            </span>
          )}
          <span className="text-xs text-muted-foreground">всего трафика <b className="text-foreground tabular-nums">{formatBytes(Number(recap.total.traffic) || 0)}</b></span>
          {recap.total.distinctCountries != null && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Globe className="h-3.5 w-3.5" /> {recap.total.distinctCountries} стран</span>}
          {recap.total.nodesCpuCores != null && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Cpu className="h-3.5 w-3.5" /> {recap.total.nodesCpuCores} ядер</span>}
          {recap.total.nodesRam && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><MemoryStick className="h-3.5 w-3.5" /> {formatBytes(Number(recap.total.nodesRam) || 0)} RAM</span>}
          <span className="flex-1" />
          {recap.version && <span className="text-[11px] text-muted-foreground/60 font-mono">Remnawave {recap.version}</span>}
        </motion.div>
      )}

      {profiles.length === 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          Нет config-профилей. Сначала создайте профиль на вкладке «Config-профили» — нода привязывается к профилю и его инбаундам.
        </div>
      )}

      {nodes.length === 0 ? (
        <Card className="bg-card border-border rounded-2xl p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <h3 className="text-[13.5px] font-bold tracking-tight">Нет нод</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              1. Создайте config-профиль  2. Добавьте ноду  3. Разверните её через docker-compose (панель подскажет).
            </p>
            <Button onClick={openCreate} disabled={profiles.length === 0} className="gap-1.5 rounded-xl mt-5">
              <Plus className="h-4 w-4" />
              Добавить первую ноду
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {nodes.map((n, idx) => {
            const cpu = cpuPct(n);
            const ram = ramPct(n);
            const iface = n.system?.stats?.interface;
            const live = !n.isDisabled && n.isConnected;
            return (
              <motion.div key={n.uuid} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }} whileHover={{ y: -2 }}>
                <Card
                  className="relative bg-card border-border rounded-2xl p-4 pl-6 cursor-pointer overflow-visible"
                  onClick={() => setDetailUuid(n.uuid)}
                  title="Открыть детали ноды"
                >
                  {/* Статус-полоска: мгновенное сканирование глазами при 10+ нодах */}
                  <div className={cn(
                    "absolute left-2.5 top-5 bottom-5 w-1 rounded-full",
                    n.isDisabled ? "bg-zinc-500/60" : n.isConnected ? "bg-emerald-500" : "bg-red-500"
                  )} />
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-[220px]">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {flagEmoji(n.countryCode) && <span className="text-base leading-none">{flagEmoji(n.countryCode)}</span>}
                        <h3 className="font-semibold text-base tracking-tight">{n.name}</h3>
                        <StatusBadge n={n} />
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                        <code className="font-mono text-xs bg-foreground/[0.04] dark:bg-white/[0.03] border border-border px-2 py-0.5 rounded-md text-foreground">
                          {n.address}{n.port ? `:${n.port}` : ""}
                        </code>
                        <span className="text-muted-foreground/40">•</span>
                        <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3" /> {formatBytes(n.trafficUsedBytes)}{n.trafficLimitBytes ? ` / ${formatBytes(n.trafficLimitBytes)}` : ""}</span>
                        {n.versions?.xray && (
                          <>
                            <span className="text-muted-foreground/40">•</span>
                            <span>Xray {n.versions.xray}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Живые метрики: данные уже в списке нод, обновляются раз в 15 с */}
                    {live ? (
                      <div className="hidden xl:flex items-center gap-5 shrink-0 mr-1">
                        {cpu != null && <MiniBar label="CPU" pct={cpu} />}
                        {ram != null && <MiniBar label="RAM" pct={ram} color="bg-primary" />}
                        <div className="text-[11px] tabular-nums space-y-1">
                          <div className="inline-flex items-center gap-1 text-muted-foreground w-full"><ArrowDown className="h-3 w-3 text-emerald-500 dark:text-emerald-400" /> {formatRate(iface?.rxBytesPerSec)}</div>
                          <div className="inline-flex items-center gap-1 text-muted-foreground w-full"><ArrowUp className="h-3 w-3 text-blue-500 dark:text-blue-400" /> {formatRate(iface?.txBytesPerSec)}</div>
                        </div>
                        <div className="text-center">
                          <div className="inline-flex items-center gap-1 text-[10px] text-muted-foreground leading-none"><UsersIcon className="h-3 w-3" /> онлайн</div>
                          <div className="text-base font-bold tabular-nums leading-tight">{n.usersOnline ?? 0}</div>
                        </div>
                      </div>
                    ) : !n.isDisabled ? (
                      <div className="hidden lg:block text-xs text-red-500/90 dark:text-red-400/90 shrink-0 mr-1 max-w-[260px] truncate">
                        Нет связи — проверьте <code className="font-mono">docker logs remnanode</code>
                      </div>
                    ) : null}

                    <div className="flex items-center gap-1 shrink-0 relative" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Статистика трафика" onClick={() => openStats(n)}>
                        <BarChart3 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Редактировать" onClick={() => openEdit(n)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Ещё действия" onClick={() => setMenuFor(menuFor === n.uuid ? null : n.uuid)}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                      {menuFor === n.uuid && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
                          <div className="absolute right-0 top-10 z-50 w-56 rounded-xl border border-border bg-card p-1.5">
                            <MenuItem icon={<Cpu />} label="Система (CPU/RAM/сеть)" onClick={() => { setMenuFor(null); setDetailUuid(n.uuid); }} />
                            <MenuItem icon={<Terminal />} label="Установка (docker-compose)" onClick={() => { setMenuFor(null); setInstallNode(n); }} />
                            <MenuItem icon={copiedUuid === n.uuid ? <Check className="text-emerald-500" /> : <Copy />} label="Скопировать UUID" onClick={() => copyNodeUuid(n.uuid)} />
                            <div className="h-px bg-card my-1" />
                            <MenuItem icon={busy === n.uuid + "restart" ? <Loader2 className="animate-spin" /> : <RefreshCw />} label="Перезапустить" disabled={busy === n.uuid + "restart"} onClick={() => { setMenuFor(null); runAction(n.uuid, "restart"); }} />
                            <MenuItem
                              icon={busy === n.uuid + (n.isDisabled ? "enable" : "disable") ? <Loader2 className="animate-spin" /> : <Power className={n.isDisabled ? "text-emerald-500" : "text-amber-500"} />}
                              label={n.isDisabled ? "Включить" : "Отключить"}
                              disabled={busy === n.uuid + (n.isDisabled ? "enable" : "disable")}
                              onClick={() => { setMenuFor(null); runAction(n.uuid, n.isDisabled ? "enable" : "disable"); }}
                            />
                            <MenuItem
                              icon={busy === n.uuid + "rst" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                              label="Сбросить трафик ноды"
                              disabled={busy === n.uuid + "rst"}
                              onClick={async () => {
                                setMenuFor(null);
                                if (!confirm(`Обнулить счётчик трафика ноды «${n.name}»?`)) return;
                                setBusy(n.uuid + "rst");
                                try { await api.remnaNodeResetTraffic(token, n.uuid); await load(); }
                                catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
                                finally { setBusy(null); }
                              }}
                            />
                            <div className="h-px bg-card my-1" />
                            <MenuItem icon={busy === n.uuid + "del" ? <Loader2 className="animate-spin" /> : <Trash2 />} label="Удалить ноду" danger disabled={busy === n.uuid + "del"} onClick={() => { setMenuFor(null); handleDelete(n); }} />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Детали системы ноды (живые — обновляются вместе со списком) */}
      <Dialog open={!!detailNode} onOpenChange={(open) => !open && setDetailUuid(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <DialogTitle className="text-base font-bold tracking-tight flex items-center gap-2">
                  {flagEmoji(detailNode?.countryCode) && <span>{flagEmoji(detailNode?.countryCode)}</span>}
                  Система — {detailNode?.name}
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-500 dark:text-emerald-400">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                    live
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">{detailNode?.address}{detailNode?.port ? `:${detailNode.port}` : ""}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {detailNode && (() => {
            const info = detailNode.system?.info;
            const stats = detailNode.system?.stats;
            const iface = stats?.interface;
            const memTotal = info?.memoryTotal ?? 0;
            const memUsed = stats?.memoryUsed ?? 0;
            const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
            const loadAvg = stats?.loadAvg ?? [];
            const cpu = cpuPct(detailNode);
            const dm = nodeMetrics.find((m) => m.nodeUuid === detailNode.uuid);
            if (!info && !stats) {
              return <div className="py-10 text-center text-sm text-muted-foreground">Нода не в сети — системные данные недоступны.</div>;
            }
            return (
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <StatCard icon={<Activity className="h-4 w-4" />} label="Платформа" value={info?.platform ? info.platform.toUpperCase() : "—"} />
                  <StatCard icon={<Clock className="h-4 w-4" />} label="Uptime" value={formatUptime(stats?.uptime)} />
                </div>
                <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><MemoryStick className="h-3.5 w-3.5" /> Память</span>
                    <span className="text-sm font-medium tabular-nums">{formatBytes(memUsed)} / {formatBytes(memTotal)} ({memPct}%)</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-foreground/[0.06] dark:bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${Math.min(memPct, 100)}%` }} />
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> Процессор</span>
                    {cpu != null && <span className="text-sm font-medium tabular-nums">{cpu}%</span>}
                  </div>
                  {cpu != null && (
                    <div className="h-1.5 rounded-full bg-foreground/[0.06] dark:bg-white/[0.06] overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all duration-700", barColor(cpu))} style={{ width: `${Math.max(cpu, 2)}%` }} />
                    </div>
                  )}
                  <div className="text-sm font-medium">{info?.cpuModel ?? "—"}{info?.cpus ? ` · ${info.cpus} ядер` : ""}</div>
                  {loadAvg.length > 0 && (
                    <div className="text-xs text-muted-foreground font-mono">Load avg: {loadAvg.map((x) => x.toFixed(2)).join("  ")}</div>
                  )}
                </div>
                <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-2">
                  <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> Сетевой интерфейс</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2">
                      <ArrowDown className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                      <div><div className="text-sm font-medium tabular-nums">{formatRate(iface?.rxBytesPerSec)}</div><div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">всего {formatBytes(iface?.rxTotal)}</div></div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowUp className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0" />
                      <div><div className="text-sm font-medium tabular-nums">{formatRate(iface?.txBytesPerSec)}</div><div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">всего {formatBytes(iface?.txTotal)}</div></div>
                    </div>
                  </div>
                </div>
                {(dm?.inboundsStats?.length ?? 0) > 0 && (
                  <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-2">
                    <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Трафик по инбаундам</div>
                    <div className="space-y-1.5">
                      {dm!.inboundsStats!.map((ib) => (
                        <div key={ib.tag} className="flex items-center justify-between gap-3 text-sm">
                          <code className="font-mono text-xs bg-foreground/[0.04] dark:bg-white/[0.03] border border-border px-1.5 py-0.5 rounded truncate">{ib.tag}</code>
                          <span className="text-xs tabular-nums text-muted-foreground shrink-0 inline-flex items-center gap-2.5">
                            <span className="inline-flex items-center gap-1"><ArrowDown className="h-3 w-3 text-emerald-500 dark:text-emerald-400" /> {ib.download}</span>
                            <span className="inline-flex items-center gap-1"><ArrowUp className="h-3 w-3 text-blue-500 dark:text-blue-400" /> {ib.upload}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard icon={<UsersIcon className="h-4 w-4" />} label="Онлайн" value={String(detailNode.usersOnline ?? 0)} />
                  <StatCard icon={<Gauge className="h-4 w-4" />} label="Трафик" value={formatBytes(detailNode.trafficUsedBytes)} />
                </div>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  {detailNode.versions?.xray && <span className="rounded-lg bg-foreground/[0.04] dark:bg-white/[0.03] border border-border px-2 py-1">Xray {detailNode.versions.xray}</span>}
                  {detailNode.versions?.node && <span className="rounded-lg bg-foreground/[0.04] dark:bg-white/[0.03] border border-border px-2 py-1">Node {detailNode.versions.node}</span>}
                  {info?.hostname && <span className="rounded-lg bg-foreground/[0.04] dark:bg-white/[0.03] border border-border px-2 py-1 font-mono">{info.hostname}</span>}
                  {dm?.providerName && dm.providerName.toLowerCase() !== "unknown" && <span className="rounded-lg bg-violet-500/10 text-violet-500 dark:text-violet-400 border border-violet-500/20 px-2 py-1">{dm.providerName}</span>}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* HWID — устройства по платформам + топ юзеров */}
      <Dialog open={hwidOpen} onOpenChange={(open) => !open && setHwidOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">Устройства (HWID)</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Привязанные устройства клиентов — по платформам и приложениям</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {hwidLoading ? (
            <div className="py-14 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-4 py-2">
              {(() => {
                const plats = hwidStats?.byPlatform ?? [];
                const totalDev = hwidStats?.totalDevices ?? plats.reduce((s, p) => s + (p.count ?? 0), 0);
                const maxP = Math.max(...plats.map((p) => p.count ?? 0), 1);
                if (plats.length === 0 && (hwidTop?.users?.length ?? 0) === 0) {
                  return <div className="py-10 text-center text-sm text-muted-foreground">Пока нет привязанных устройств.</div>;
                }
                return (
                  <>
                    {plats.length > 0 && (
                      <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">По платформам</span>
                          <span className="text-xs font-semibold tabular-nums">Всего {totalDev}</span>
                        </div>
                        {plats.map((p) => (
                          <div key={p.platform}>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="font-medium">{p.platform || "—"}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">{p.count}{p.byApp?.length ? ` · ${p.byApp.map((a) => a.app).slice(0, 3).join(", ")}` : ""}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-foreground/[0.06] dark:bg-white/[0.06] overflow-hidden">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max((p.count / maxP) * 100, 3)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {(hwidTop?.users?.length ?? 0) > 0 && (
                      <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-2">
                        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" /> Топ по числу устройств</div>
                        {(hwidTop!.users ?? []).slice(0, 15).map((u, i) => (
                          <div key={u.userUuid} className="flex items-center justify-between gap-3 text-sm">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="text-xs text-muted-foreground/60 tabular-nums w-6 text-right shrink-0">{i < 3 ? ["", "", ""][i] : i + 1}</span>
                              <span className="font-mono truncate">{u.username}</span>
                            </span>
                            <span className="text-xs font-semibold tabular-nums shrink-0">{u.devicesCount} устр.</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Торрент-блокер: статистика + отчёты (схема ремны свободная — рендер защитный) */}
      <Dialog open={torrentOpen} onOpenChange={(open) => !open && setTorrentOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">Торрент-блокер</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Статистика поимок и последние отчёты по нодам</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {torrentLoading ? (
            <div className="py-14 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-4 py-2">
              {torrentStats && Object.keys(torrentStats).length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(torrentStats).filter(([, v]) => typeof v === "number" || typeof v === "string").slice(0, 6).map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4">
                      <div className="text-[11px] text-muted-foreground truncate">{k}</div>
                      <div className="text-[13.5px] font-bold tabular-nums mt-1 truncate">{String(v)}</div>
                    </div>
                  ))}
                </div>
              )}
              {torrentReports.length > 0 && (
                <div className="flex justify-end">
                  <Button
                    variant="outline" size="sm" className="rounded-lg gap-1.5 text-xs text-red-500 dark:text-red-400 hover:bg-red-500/10"
                    onClick={async () => {
                      if (!confirm("Очистить все отчёты торрент-блокера?")) return;
                      try { await api.remnaTruncateTorrent(token); setTorrentReports([]); }
                      catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
                    }}
                  ><Trash2 className="h-3.5 w-3.5" /> Очистить отчёты</Button>
                </div>
              )}
              {torrentReports.length > 0 ? (
                <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] divide-y divide-border">
                  {torrentReports.slice(0, 30).map((r, i) => {
                    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
                    const user = String(o.username ?? o.userUuid ?? o.tag ?? "—");
                    const node = String(o.nodeName ?? o.nodeUuid ?? "");
                    const when = o.createdAt ? new Date(String(o.createdAt)).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
                    return (
                      <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="font-mono truncate">{user}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{node} {when}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">Отчётов нет — либо торрент-блокер выключен, либо ловить нечего </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Инфра-биллинг: провайдеры + привязка нод к оплате */}
      <Dialog open={billingOpen} onOpenChange={(open) => !open && setBillingOpen(false)}>
        <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">Оплаты серверов</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Провайдеры и даты продления нод — чтобы не проспать оплату сервера</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {billingLoading ? (
            <div className="py-14 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-5 py-2">
              {/* Провайдеры */}
              <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Провайдеры</div>
                {providers.length > 0 && (
                  <div className="space-y-1.5">
                    {providers.map((pr) => (
                      <div key={pr.uuid} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                        <span className="font-medium truncate">{pr.name}{pr.loginUrl && <a href={pr.loginUrl} target="_blank" rel="noreferrer" className="text-primary ml-2 text-xs hover:underline">панель </a>}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10 shrink-0" onClick={() => deleteProvider(pr.uuid, pr.name)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Input value={newProviderName} onChange={(e) => setNewProviderName(e.target.value)} placeholder="Название (Hetzner…)" className="rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border-border h-9 text-sm" />
                  <Input value={newProviderUrl} onChange={(e) => setNewProviderUrl(e.target.value)} placeholder="URL панели (опц.)" className="rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border-border h-9 text-sm" />
                  <Button size="sm" className="rounded-lg gap-1.5 shrink-0" disabled={billBusy || !newProviderName.trim()} onClick={createProvider}><Plus className="h-3.5 w-3.5" /> Добавить</Button>
                </div>
              </div>

              {/* Привязать ноду к биллингу */}
              <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Привязать ноду к оплате</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select className="h-9 rounded-lg border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-2 text-sm" value={billForm.providerUuid} onChange={(e) => setBillForm((f) => ({ ...f, providerUuid: e.target.value }))}>
                    <option value="">Провайдер…</option>
                    {providers.map((pr) => <option key={pr.uuid} value={pr.uuid}>{pr.name}</option>)}
                  </select>
                  <select className="h-9 rounded-lg border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-2 text-sm" value={billForm.nodeUuid} onChange={(e) => setBillForm((f) => ({ ...f, nodeUuid: e.target.value }))}>
                    <option value="">Нода…</option>
                    {nodes.filter((n) => !billingNodes.some((b) => b.node?.uuid === n.uuid)).map((n) => <option key={n.uuid} value={n.uuid}>{n.name}</option>)}
                  </select>
                  <Input type="date" value={billForm.date} onChange={(e) => setBillForm((f) => ({ ...f, date: e.target.value }))} className="rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border-border h-9 text-sm" />
                </div>
                <Button size="sm" className="rounded-lg gap-1.5 w-full" disabled={billBusy || !billForm.providerUuid || !billForm.nodeUuid || !billForm.date} onClick={createBillingNode}>
                  {billBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Добавить в биллинг
                </Button>
              </div>

              {/* Уже в биллинге */}
              {billingNodes.length > 0 && (
                <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">В биллинге</div>
                  {[...billingNodes].sort((a, b) => new Date(a.nextBillingAt ?? 0).getTime() - new Date(b.nextBillingAt ?? 0).getTime()).map((b) => {
                    const d = b.nextBillingAt ? new Date(b.nextBillingAt) : null;
                    const days = d ? Math.ceil((d.getTime() - Date.now()) / 86_400_000) : null;
                    return (
                      <div key={b.uuid} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                        <span className="truncate">{flagEmoji(b.node?.countryCode)} {b.node?.name ?? "—"} <span className="text-muted-foreground text-xs">· {b.provider?.name}</span></span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className={cn("text-xs tabular-nums", days != null && days < 0 ? "text-red-500 dark:text-red-400" : days != null && days <= 3 ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground")}>
                            {d?.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })}{days != null && ` · ${days < 0 ? `−${-days}д` : `${days}д`}`}
                          </span>
                          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" onClick={() => deleteBillingNode(b.uuid)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Плагины нод */}
      <Dialog open={pluginsOpen} onOpenChange={(open) => !open && setPluginsOpen(false)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">Плагины нод</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Установленные плагины (напр. торрент-блокер). Конфигурация правится в Remnawave.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {pluginsLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : plugins.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Плагины не установлены.</div>
          ) : (
            <div className="space-y-2 py-2">
              {plugins.map((pl) => (
                <div key={pl.uuid} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2.5">
                  <span className="text-sm font-medium truncate">{pl.name}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10 shrink-0" title="Удалить плагин" onClick={() => deletePlugin(pl.uuid, pl.name)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Статистика трафика по пользователям */}
      <Dialog open={!!statsNode} onOpenChange={(open) => !open && setStatsNode(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">Трафик по пользователям — {statsNode?.name}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Топ-50 пользователей ноды за период</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => statsNode && openStats(statsNode, d)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border",
                    statsDays === d
                      ? "border-border bg-primary/10 text-primary"
                      : "border-border bg-foreground/[0.03] dark:bg-white/[0.02] text-muted-foreground hover:text-foreground"
                  )}
                >
                  {d} дней
                </button>
              ))}
            </div>
            {statsLoading ? (
              <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : (() => {
              // total может прийти строкой/null — нормализуем; если у ВСЕХ 0  честный empty-state
              // (раньше width: NaN% ронял вёрстку и рисовал «полный» бар при нуле).
              const users = (statsData?.topUsers ?? []).map((u) => ({ ...u, totalNum: Number(u.total) || 0 }));
              const max = Math.max(...users.map((u) => u.totalNum), 0);
              // sparklineData/categories приходят тем же ответом — трафик ноды по дням.
              const spark = (statsData?.sparklineData ?? []).map((v) => Number(v) || 0);
              const cats = statsData?.categories ?? [];
              const sparkMax = Math.max(...spark, 0);
              const periodTotal = spark.reduce((s, v) => s + v, 0) || users.reduce((s, u) => s + u.totalNum, 0);
              if ((users.length === 0 || max <= 0) && sparkMax <= 0) {
                return <div className="py-10 text-center text-sm text-muted-foreground">Нет трафика за выбранный период.</div>;
              }
              return (
                <div className="space-y-4">
                  {sparkMax > 0 && (
                    <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-muted-foreground">Трафик по дням</span>
                        <span className="text-xs font-semibold tabular-nums">Σ {formatBytes(periodTotal)}</span>
                      </div>
                      <div className="flex items-end gap-[3px] h-20">
                        {spark.map((v, i) => (
                          <div
                            key={i}
                            title={`${cats[i] ?? ""}: ${formatBytes(v)}`}
                            className="flex-1 rounded-t-[3px] bg-primary/60 hover:bg-primary transition-colors"
                            style={{ height: `${Math.max((v / sparkMax) * 100, 2)}%` }}
                          />
                        ))}
                      </div>
                      {cats.length > 1 && (
                        <div className="flex justify-between mt-1.5 text-[9px] text-muted-foreground/60 font-mono">
                          <span>{cats[0]}</span>
                          <span>{cats[cats.length - 1]}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {users.length > 0 && max > 0 && (
                  <div className="space-y-2.5">
                  {users.map((u, i) => (
                    <div key={u.username + i} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground/60 tabular-nums w-6 text-right shrink-0">{i < 3 ? ["", "", ""][i] : i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-mono truncate">{u.username}</span>
                          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatBytes(u.totalNum)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-foreground/[0.06] dark:bg-white/[0.06] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max((u.totalNum / max) * 100, 2)}%`, backgroundColor: u.color || "rgb(var(--primary))" }} />
                        </div>
                      </div>
                    </div>
                  ))}
                  </div>
                  )}
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Install-команда */}
      <Dialog open={!!installNode} onOpenChange={(open) => !open && setInstallNode(null)}>
        <DialogContent className="max-w-3xl bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">Установка ноды {installNode?.name}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Сохраните как <code className="font-mono">docker-compose.yml</code> на сервере ноды и запустите <code className="font-mono">docker compose up -d</code>.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {installNode && (
            <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
              <InstallStep n={1} title="Установите Docker" cmd="sudo curl -fsSL https://get.docker.com | sh" />
              <InstallStep n={2} title="Создайте директорию проекта" cmd="mkdir -p /opt/remnanode && cd /opt/remnanode" />
              <InstallStep n={3} title="Создайте файл docker-compose.yml" cmd="nano docker-compose.yml" />
              <div className="flex gap-3">
                <div className="h-6 w-6 rounded-full bg-primary/15 border border-border text-primary text-xs font-bold flex items-center justify-center shrink-0">4</div>
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-sm font-medium">Вставьте содержимое <code className="font-mono text-xs">docker-compose.yml</code></p>
                  <pre className="text-[10.5px] leading-relaxed font-mono bg-foreground/[0.04] dark:bg-white/[0.03] border border-border rounded-xl p-3 overflow-x-auto max-h-52 whitespace-pre-wrap break-all">{installCommand(installNode)}</pre>
                  <Button onClick={() => copyStep(installCommand(installNode), "yaml")} size="sm" className="gap-2 rounded-lg">
                    {copiedStep === "yaml" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedStep === "yaml" ? "Скопировано" : "Копировать docker-compose.yml"}
                  </Button>
                </div>
              </div>
              <InstallStep n={5} title="Запустите контейнеры" cmd="docker compose up -d && docker compose logs -f -t" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create / Edit */}
      <Dialog open={showForm} onOpenChange={(open) => !open && setShowForm(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
                {editingUuid ? <Pencil className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
              </div>
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">{editingUuid ? "Редактировать" : "Добавить"} ноду</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Адрес, профиль конфигурации и множитель трафика</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Название</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="DE-Frankfurt-1" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-1.5 col-span-2">
                <Label className="text-xs text-muted-foreground">Адрес (IP / домен)</Label>
                <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="10.0.0.1" className="font-mono rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Порт</Label>
                <Input type="number" value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) || 0 }))} className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Код страны (напр. DE)</Label>
                <div className="relative">
                  <Input value={form.countryCode} onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value.toUpperCase().slice(0, 2) }))} placeholder="DE" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50 pr-9" />
                  {flagEmoji(form.countryCode) && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-base">{flagEmoji(form.countryCode)}</span>}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Множитель трафика ×</Label>
                <Input type="number" step="0.1" min={0} value={form.consumptionMultiplier} onChange={(e) => setForm((f) => ({ ...f, consumptionMultiplier: Number(e.target.value) || 0 }))} className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Лимит трафика (ГБ, 0 = без лимита)</Label>
              <Input type="number" min={0} value={form.trafficLimitGb} onChange={(e) => setForm((f) => ({ ...f, trafficLimitGb: Number(e.target.value) || 0 }))} className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Config-профиль</Label>
              <select
                className="flex h-10 w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                value={form.activeConfigProfileUuid}
                onChange={(e) => onProfileChange(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.uuid} value={p.uuid}>{p.name}</option>
                ))}
              </select>
            </div>

            {selectedProfile && (
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Инбаунды профиля</Label>
                <div className="grid gap-1.5 rounded-xl border border-border bg-foreground/[0.02] p-2 max-h-40 overflow-y-auto">
                  {(selectedProfile.inbounds ?? []).length === 0 && (
                    <span className="text-xs text-muted-foreground px-1 py-1">У профиля нет инбаундов</span>
                  )}
                  {(selectedProfile.inbounds ?? []).map((ib) => (
                    <label key={ib.uuid} className="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-foreground/5">
                      <input type="checkbox" className="rounded accent-primary" checked={form.activeInbounds.includes(ib.uuid)} onChange={() => toggleInbound(ib.uuid)} />
                      <span className="text-sm font-mono">{ib.tag ?? ib.uuid.slice(0, 8)}</span>
                      {ib.type && <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">{ib.type}{ib.port ? ` :${ib.port}` : ""}</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Заметка</Label>
              <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="необязательно" className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50" />
            </div>

            <label className={cn(
              "flex items-center gap-2 cursor-pointer rounded-xl border px-3 py-2.5 transition-colors",
              form.isTrafficTrackingActive ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-foreground/[0.03] dark:bg-white/[0.02]"
            )}>
              <input type="checkbox" checked={form.isTrafficTrackingActive} onChange={(e) => setForm((f) => ({ ...f, isTrafficTrackingActive: e.target.checked }))} className="rounded accent-emerald-500" />
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Отслеживание трафика</span>
            </label>

            {!editingUuid && (
              <details className="group rounded-xl border border-border bg-primary/[0.04] overflow-hidden">
                <summary className="flex items-center justify-between gap-2 cursor-pointer list-none px-3 py-2.5 select-none">
                  <span className="text-xs font-semibold text-primary inline-flex items-center gap-2"><Terminal className="h-3.5 w-3.5" /> docker-compose.yml для ноды</span>
                  <ChevronDown className="h-4 w-4 text-primary transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-3 pb-3 grid gap-1.5">
                  <div className="flex justify-end">
                    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 rounded-lg text-xs" onClick={() => copyYaml(composeYaml(form.port))}>
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? "Скопировано" : "Копировать"}
                    </Button>
                  </div>
                  <pre className="text-[10px] leading-relaxed font-mono bg-card border border-border rounded-xl p-3 overflow-x-auto max-h-36 whitespace-pre-wrap break-all">{composeYaml(form.port)}</pre>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Разверните на сервере ноды (сохраните файл  <code className="font-mono">docker compose up -d</code>). <code className="font-mono">NODE_PORT</code> должен совпадать с полем «Порт» выше. Полная инструкция появится после создания (кнопка «Установка» в меню ноды).</p>
                </div>
              </details>
            )}

            <DialogFooter className="mt-4 gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-xl">Отмена</Button>
              <Button
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.address.trim() || !form.activeConfigProfileUuid}
                className="gap-2 rounded-xl"
              >
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
