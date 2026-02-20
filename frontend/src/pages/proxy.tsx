import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type ProxyNodeListItem, type CreateProxyNodeResponse, type ProxySlotAdminItem } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Globe, Plus, Copy, Check, Loader2, Server, Pencil, Trash2, Layers, Download, BarChart3, Users, Ban, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

function formatBytes(s: string): string {
  const n = Number(s);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ONLINE: "bg-green-500/15 text-green-700 dark:text-green-400",
    OFFLINE: "bg-muted text-muted-foreground",
    DISABLED: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  };
  const label = status === "ONLINE" ? "Онлайн" : status === "DISABLED" ? "Отключена" : "Офлайн";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-muted"}`}>
      {label}
    </span>
  );
}

const HEREDOC_MARKER = "ENDOFSTEALTHNET_COMPOSE";

type ProxyTariffItem = {
  id: string;
  categoryId: string;
  name: string;
  proxyCount: number;
  durationDays: number;
  trafficLimitBytes: string | null;
  connectionLimit: number | null;
  price: number;
  currency: string;
  sortOrder: number;
  enabled: boolean;
  nodeIds: string[];
};

type ProxyCategoryItem = {
  id: string;
  name: string;
  sortOrder: number;
  tariffs: ProxyTariffItem[];
};

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ProxyPage() {
  const { state } = useAuth();
  const [nodes, setNodes] = useState<ProxyNodeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newNodeName, setNewNodeName] = useState("");
  const [creating, setCreating] = useState(false);
  const [addResult, setAddResult] = useState<CreateProxyNodeResponse | null>(null);
  const [copied, setCopied] = useState<"compose" | "token" | "script" | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<ProxyNodeListItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState<string>("");
  const [editCapacity, setEditCapacity] = useState<string>("");
  const [editSocksPort, setEditSocksPort] = useState<string>("1080");
  const [editHttpPort, setEditHttpPort] = useState<string>("8080");
  const [saving, setSaving] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<ProxyNodeListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("nodes");
  const [categories, setCategories] = useState<ProxyCategoryItem[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoryModal, setCategoryModal] = useState<"add" | { edit: ProxyCategoryItem } | null>(null);
  const [tariffModal, setTariffModal] = useState<{ kind: "add"; categoryId: string } | { kind: "edit"; category: ProxyCategoryItem; tariff: ProxyTariffItem } | null>(null);
  const [slots, setSlots] = useState<ProxySlotAdminItem[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [editSlot, setEditSlot] = useState<ProxySlotAdminItem | null>(null);
  const [slotForm, setSlotForm] = useState({ login: "", password: "", connectionLimit: "", status: "" });

  const token = state.accessToken;
  if (!token) return null;

  async function loadNodes() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.getProxyNodes(token);
      setNodes(res.items);
    } catch {
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadNodes(); }, [token]);

  async function loadCategories() {
    if (!token) return;
    setCategoriesLoading(true);
    try {
      const res = await api.getProxyCategories(token);
      const items = res.items.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        tariffs: c.tariffs.map((t) => ({
          id: t.id,
          categoryId: t.categoryId ?? c.id,
          name: t.name,
          proxyCount: t.proxyCount,
          durationDays: t.durationDays,
          trafficLimitBytes: t.trafficLimitBytes ?? null,
          connectionLimit: t.connectionLimit ?? null,
          price: t.price,
          currency: t.currency,
          sortOrder: t.sortOrder ?? 0,
          enabled: t.enabled ?? true,
          nodeIds: t.nodeIds ?? [],
        })),
      }));
      setCategories(items);
    } catch { setCategories([]); } finally { setCategoriesLoading(false); }
  }

  async function handleDeleteCategory(id: string) {
    if (!token || !confirm("Удалить категорию и все тарифы в ней?")) return;
    try {
      await api.deleteProxyCategory(token, id);
      await loadCategories();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  }

  async function handleDeleteTariff(id: string) {
    if (!token || !confirm("Удалить тариф?")) return;
    try {
      await api.deleteProxyTariff(token, id);
      await loadCategories();
      setTariffModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  }

  async function handleToggleTariffEnabled(t: ProxyTariffItem) {
    if (!token) return;
    try {
      await api.updateProxyTariff(token, t.id, { enabled: !t.enabled });
      await loadCategories();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function loadSlots() {
    if (!token) return;
    setSlotsLoading(true);
    try {
      const res = await api.getProxySlotsAdmin(token);
      setSlots(res.items);
    } catch { setSlots([]); } finally { setSlotsLoading(false); }
  }

  function openSlotEdit(s: ProxySlotAdminItem) {
    setEditSlot(s);
    setSlotForm({ login: s.login, password: s.password, connectionLimit: s.connectionLimit != null ? String(s.connectionLimit) : "", status: s.status });
  }

  async function handleSaveSlot() {
    if (!token || !editSlot) return;
    setSaving(true);
    try {
      await api.updateProxySlotAdmin(token, editSlot.id, {
        login: slotForm.login.trim() || editSlot.login,
        password: slotForm.password || editSlot.password,
        connectionLimit: slotForm.connectionLimit.trim() === "" ? null : parseInt(slotForm.connectionLimit, 10),
        status: slotForm.status as "ACTIVE" | "EXPIRED" | "REVOKED",
      });
      await loadSlots();
      setEditSlot(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally { setSaving(false); }
  }

  async function handleRevokeSlot(id: string) {
    if (!token || !confirm("Отозвать доступ? Слот станет REVOKED.")) return;
    try {
      await api.updateProxySlotAdmin(token, id, { status: "REVOKED" });
      await loadSlots();
    } catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function handleDeleteSlot(id: string) {
    if (!token || !confirm("Удалить слот? Это нельзя отменить.")) return;
    try {
      await api.deleteProxySlotAdmin(token, id);
      await loadSlots();
    } catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
  }

  useEffect(() => {
    if (activeTab === "categories" || activeTab === "tariffs") loadCategories();
    if (activeTab === "slots") loadSlots();
  }, [activeTab, token]);

  async function handleAddNode() {
    if (!token || !newNodeName.trim()) return;
    setCreating(true);
    setAddResult(null);
    try {
      const res = await api.createProxyNode(token, { name: newNodeName.trim() });
      setAddResult(res);
      await loadNodes();
    } catch {
      setAddResult(null);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(node: ProxyNodeListItem) {
    setEditingNode(node);
    setEditName(node.name || "");
    setEditStatus(node.status);
    setEditCapacity(node.capacity != null ? String(node.capacity) : "");
    setEditSocksPort(String(node.socksPort));
    setEditHttpPort(String(node.httpPort));
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    if (!token || !editingNode) return;
    setSaving(true);
    try {
      await api.updateProxyNode(token, editingNode.id, {
        name: editName.trim() || editingNode.name,
        status: editStatus,
        capacity: editCapacity.trim() === "" ? null : parseInt(editCapacity, 10) || null,
        socksPort: parseInt(editSocksPort, 10) || 1080,
        httpPort: parseInt(editHttpPort, 10) || 8080,
      });
      await loadNodes();
      setEditOpen(false);
      setEditingNode(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token || !nodeToDelete) return;
    setDeleting(true);
    try {
      await api.deleteProxyNode(token, nodeToDelete.id);
      await loadNodes();
      setNodeToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  function closeAddDialog() {
    setAddOpen(false);
    setAddResult(null);
    setNewNodeName("");
    setCopied(null);
  }

  function copyToClipboard(text: string, which: "compose" | "token" | "script") {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const publicUrl = typeof window !== "undefined" ? window.location.origin : "";
  const composeWithUrl = addResult?.dockerCompose.replace("{{STEALTHNET_API_URL}}", publicUrl) ?? addResult?.dockerCompose ?? "";

  const installScript = addResult
    ? `mkdir -p /opt/proxy-node && cat > /opt/proxy-node/docker-compose.yml << '${HEREDOC_MARKER}'
${composeWithUrl}
${HEREDOC_MARKER}

cd /opt/proxy-node && docker compose up -d --build`
    : "";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Globe className="h-7 w-7 text-primary" />
          Прокси
        </h1>
        <p className="text-muted-foreground mt-1">
          Ноды, категории и тарифы для продажи прокси.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="nodes" className="gap-2">
            <Server className="h-4 w-4" /> Ноды
          </TabsTrigger>
          <TabsTrigger value="slots" className="gap-2">
            <Users className="h-4 w-4" /> Слоты
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-2">
            <Layers className="h-4 w-4" /> Категории и тарифы
          </TabsTrigger>
        </TabsList>

      <TabsContent value="nodes">
      {nodes.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Нагрузка и трафик по нодам
            </CardTitle>
            <CardDescription>Текущее состояние: трафик (↓+↑), подключения, слотов.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-64">
                <p className="text-sm font-medium mb-2">Трафик (МБ)</p>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={nodes.map((n) => ({ name: n.name || n.id.slice(0, 8), trafficMb: (Number(n.trafficInBytes) + Number(n.trafficOutBytes)) / (1024 * 1024), fill: n.status === "ONLINE" ? "#22c55e" : n.status === "DISABLED" ? "#f59e0b" : "#94a3b8" }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}`} />
                    <Tooltip formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(1)} МБ`, "Трафик"]} />
                    <Bar dataKey="trafficMb" name="Трафик (МБ)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="h-64">
                <p className="text-sm font-medium mb-2">Подключения и слотов</p>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={nodes.map((n) => ({ name: n.name || n.id.slice(0, 8), connections: n.currentConnections, slots: n.slotsCount }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="connections" name="Подключения" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="slots" name="Слотов" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-lg">Ноды</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => token && api.downloadProxySlotsCsv(token).catch((e) => alert(e instanceof Error ? e.message : "Ошибка"))}>
                <Download className="h-4 w-4 mr-2" /> Экспорт слотов CSV
              </Button>
              <Button
                onClick={() => {
                  setAddOpen(true);
                  setAddResult(null);
                }}
                disabled={creating}
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Добавить прокси
              </Button>
            </div>
          </div>
          <CardDescription>Список прокси-нод. Статус «Онлайн» — нода присылает heartbeat за последние 5 минут.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground py-8 text-center">Загрузка…</p>
          ) : nodes.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              Нет нод. Нажмите «Добавить прокси», скопируйте docker-compose на сервер и запустите контейнер.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Название</th>
                    <th className="text-left py-3 px-2 font-medium">Статус</th>
                    <th className="text-left py-3 px-2 font-medium">Хост / порты</th>
                    <th className="text-right py-3 px-2 font-medium">Слотов</th>
                    <th className="text-right py-3 px-2 font-medium">Подключения</th>
                    <th className="text-right py-3 px-2 font-medium">Трафик</th>
                    <th className="text-left py-3 px-2 font-medium">Последний heartbeat</th>
                    <th className="text-right py-3 px-2 font-medium w-24">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((n) => (
                    <tr key={n.id} className="border-b last:border-0">
                      <td className="py-3 px-2">
                        <span className="font-medium">{n.name || "—"}</span>
                      </td>
                      <td className="py-3 px-2">{statusBadge(n.status)}</td>
                      <td className="py-3 px-2 font-mono text-xs">
                        {n.publicHost ?? "—"} :{n.socksPort}/{n.httpPort}
                      </td>
                      <td className="py-3 px-2 text-right">{n.slotsCount}</td>
                      <td className="py-3 px-2 text-right">{n.currentConnections}</td>
                      <td className="py-3 px-2 text-right text-muted-foreground">
                        ↓{formatBytes(n.trafficInBytes)} ↑{formatBytes(n.trafficOutBytes)}
                      </td>
                      <td className="py-3 px-2 text-muted-foreground">{formatDate(n.lastSeenAt)}</td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(n)} title="Редактировать">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setNodeToDelete(n)} title="Удалить" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="slots">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Прокси-доступы пользователей
          </CardTitle>
          <CardDescription>Все выданные слоты. Можно менять логин/пароль, лимит подключений, отзывать или удалять.</CardDescription>
        </CardHeader>
        <CardContent>
          {slotsLoading ? (
            <p className="text-muted-foreground py-8 text-center">Загрузка...</p>
          ) : slots.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Нет выданных слотов.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Клиент</th>
                    <th className="text-left py-3 px-2 font-medium">Нода</th>
                    <th className="text-left py-3 px-2 font-medium">Логин</th>
                    <th className="text-left py-3 px-2 font-medium">Пароль</th>
                    <th className="text-right py-3 px-2 font-medium">Лимит подкл.</th>
                    <th className="text-right py-3 px-2 font-medium">Трафик</th>
                    <th className="text-left py-3 px-2 font-medium">Статус</th>
                    <th className="text-left py-3 px-2 font-medium">Истекает</th>
                    <th className="text-right py-3 px-2 font-medium w-28">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-3 px-2">
                        <span className="font-medium">{s.clientEmail || s.clientTelegram || s.clientTelegramId || s.clientId.slice(0, 8)}</span>
                      </td>
                      <td className="py-3 px-2 text-xs">{s.nodeName || "—"}<br /><span className="text-muted-foreground font-mono">{s.publicHost ?? "—"}</span></td>
                      <td className="py-3 px-2 font-mono text-xs">{s.login}</td>
                      <td className="py-3 px-2 font-mono text-xs">{s.password}</td>
                      <td className="py-3 px-2 text-right">{s.connectionLimit ?? "—"}</td>
                      <td className="py-3 px-2 text-right text-muted-foreground text-xs">{formatBytes(s.trafficUsedBytes)}{s.trafficLimitBytes ? ` / ${formatBytes(s.trafficLimitBytes)}` : ""}</td>
                      <td className="py-3 px-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.status === "ACTIVE" ? "bg-green-500/15 text-green-700 dark:text-green-400" : s.status === "REVOKED" ? "bg-red-500/15 text-red-700 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>
                          {s.status === "ACTIVE" ? "Активен" : s.status === "REVOKED" ? "Отозван" : "Истёк"}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-xs text-muted-foreground">{formatDate(s.expiresAt)}</td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openSlotEdit(s)} title="Редактировать">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {s.status === "ACTIVE" && (
                            <Button variant="ghost" size="sm" onClick={() => handleRevokeSlot(s.id)} title="Отозвать" className="text-amber-600 hover:text-amber-600">
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteSlot(s.id)} title="Удалить" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="categories">
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-muted-foreground text-sm">
            Категории группируют тарифы (например «Прокси РФ», «Прокси EU»). В каждой категории — свои тарифы.
          </p>
          <Button onClick={() => setCategoryModal("add")} size="sm">
            <Plus className="h-4 w-4 mr-2" /> Добавить категорию
          </Button>
        </div>
        {categoriesLoading ? (
          <p className="text-muted-foreground py-8 text-center">Загрузка…</p>
        ) : categories.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground mb-4">Нет категорий. Создайте категорию, затем добавьте в неё тарифы (кол-во прокси, срок, цена).</p>
              <Button onClick={() => setCategoryModal("add")}>
                <Plus className="h-4 w-4 mr-2" /> Создать категорию
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {categories.map((cat) => (
              <Card key={cat.id} className="overflow-hidden">
                <CardHeader className="pb-2 bg-muted/30">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                      <Layers className="h-5 w-5 text-primary" />
                      {cat.name}
                    </CardTitle>
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" size="sm" onClick={() => setCategoryModal({ edit: cat })}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Изменить
                      </Button>
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDeleteCategory(cat.id)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Удалить
                      </Button>
                      <Button size="sm" onClick={() => setTariffModal({ kind: "add", categoryId: cat.id })}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Тариф
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-3">
                  {cat.tariffs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      Нет тарифов в этой категории. Нажмите «Тариф», чтобы добавить.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {cat.tariffs.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 hover:bg-muted/30">
                          <div className="flex items-center gap-3 flex-wrap min-w-0">
                            <span className="font-medium truncate">{t.name}</span>
                            <span className="text-sm text-muted-foreground">{t.proxyCount} прокси</span>
                            <span className="text-sm text-muted-foreground">{t.durationDays} дн.</span>
                            <span className="text-sm font-semibold text-primary">{formatPrice(t.price, t.currency)}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${t.enabled ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                              {t.enabled ? "Вкл" : "Выкл"}
                            </span>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="sm" className="h-7" onClick={() => handleToggleTariffEnabled(t)} title={t.enabled ? "Выключить" : "Включить"}>
                              {t.enabled ? "Выкл" : "Вкл"}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7" onClick={() => setTariffModal({ kind: "edit", category: cat, tariff: t })}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 text-destructive hover:text-destructive" onClick={() => handleDeleteTariff(t.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      </TabsContent>

      </Tabs>

      <Dialog open={addOpen} onOpenChange={(open) => !open && closeAddDialog()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Добавить прокси-ноду
            </DialogTitle>
            <DialogDescription>
              {addResult
                ? "Скопируйте docker-compose ниже на сервер. Замените URL панели, если нужно. Затем выполните: docker compose up -d"
                : "Нажмите кнопку — будет создана запись и сгенерирован токен. Вы получите готовый docker-compose для запуска на своём сервере."}
            </DialogDescription>
          </DialogHeader>
          {!addResult ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="proxy-node-name">Название ноды</Label>
                <Input
                  id="proxy-node-name"
                  placeholder="Например: Нода 1 или proxy-eu"
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeAddDialog}>
                  Отмена
                </Button>
                <Button onClick={handleAddNode} disabled={creating || !newNodeName.trim()}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Сгенерировать токен и docker-compose
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Команда для установки на сервере</p>
                <p className="text-sm text-muted-foreground mb-2">
                  Выполните на сервере (создаёт папку /opt/proxy-node, записывает в неё docker-compose и запускает контейнер):
                </p>
                <pre className="rounded-lg bg-muted p-4 text-xs overflow-x-auto whitespace-pre-wrap font-mono max-h-48">
                  {installScript}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => copyToClipboard(installScript, "script")}
                >
                  {copied === "script" ? <Check className="h-4 w-4 mr-2 text-green-600" /> : <Copy className="h-4 w-4 mr-2" />}
                  Копировать команду
                </Button>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Токен ноды (уже подставлен в compose)</p>
                <div className="flex gap-2">
                  <code className="flex-1 rounded-lg bg-muted px-3 py-2 text-xs break-all">{addResult.node.token}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(addResult.node.token, "token")}
                  >
                    {copied === "token" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Docker Compose (для ручного копирования)</p>
                <pre className="rounded-lg bg-muted p-4 text-xs overflow-x-auto whitespace-pre-wrap font-mono max-h-40">
                  {composeWithUrl}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => copyToClipboard(composeWithUrl, "compose")}
                >
                  {copied === "compose" ? <Check className="h-4 w-4 mr-2 text-green-600" /> : <Copy className="h-4 w-4 mr-2" />}
                  Копировать docker-compose
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={closeAddDialog}>Готово</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать ноду</DialogTitle>
            <DialogDescription>Измените название, статус или лимит слотов.</DialogDescription>
          </DialogHeader>
          {editingNode && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-name">Название</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="edit-status">Статус</Label>
                <select
                  id="edit-status"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="ONLINE">Онлайн</option>
                  <option value="OFFLINE">Офлайн</option>
                  <option value="DISABLED">Отключена</option>
                </select>
              </div>
              <div>
                <Label htmlFor="edit-capacity">Макс. слотов (пусто — без лимита)</Label>
                <Input
                  id="edit-capacity"
                  type="number"
                  min={0}
                  value={editCapacity}
                  onChange={(e) => setEditCapacity(e.target.value)}
                  placeholder="Не ограничено"
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-socks-port">Порт SOCKS5</Label>
                  <Input id="edit-socks-port" type="number" min={1} max={65535} value={editSocksPort} onChange={(e) => setEditSocksPort(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="edit-http-port">Порт HTTP</Label>
                  <Input id="edit-http-port" type="number" min={1} max={65535} value={editHttpPort} onChange={(e) => setEditHttpPort(e.target.value)} className="mt-1" />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Отмена</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!nodeToDelete} onOpenChange={(open) => !open && setNodeToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить ноду?</DialogTitle>
            <DialogDescription>
              Нода «{nodeToDelete?.name || "—"}» и все её слоты будут удалены. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNodeToDelete(null)}>Отмена</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {categoryModal && (
        <ProxyCategoryModal
          token={token}
          modal={categoryModal}
          onClose={() => setCategoryModal(null)}
          onSaved={() => { setCategoryModal(null); loadCategories(); }}
          saving={saving}
          setSaving={setSaving}
        />
      )}

      <Dialog open={!!editSlot} onOpenChange={(open) => !open && setEditSlot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Редактировать слот</DialogTitle>
            <DialogDescription>
              Клиент: {editSlot?.clientEmail || editSlot?.clientTelegram || "—"} / Нода: {editSlot?.nodeName || "—"}
            </DialogDescription>
          </DialogHeader>
          {editSlot && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="slot-login">Логин</Label>
                <Input id="slot-login" value={slotForm.login} onChange={(e) => setSlotForm((f) => ({ ...f, login: e.target.value }))} className="mt-1 font-mono" />
              </div>
              <div>
                <Label htmlFor="slot-password">Пароль</Label>
                <Input id="slot-password" value={slotForm.password} onChange={(e) => setSlotForm((f) => ({ ...f, password: e.target.value }))} className="mt-1 font-mono" />
              </div>
              <div>
                <Label htmlFor="slot-connlimit">Лимит подключений (пусто — без лимита)</Label>
                <Input id="slot-connlimit" type="number" min={0} value={slotForm.connectionLimit} onChange={(e) => setSlotForm((f) => ({ ...f, connectionLimit: e.target.value }))} placeholder="Без лимита" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="slot-status">Статус</Label>
                <select id="slot-status" value={slotForm.status} onChange={(e) => setSlotForm((f) => ({ ...f, status: e.target.value }))} className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                  <option value="ACTIVE">Активен</option>
                  <option value="REVOKED">Отозван</option>
                  <option value="EXPIRED">Истёк</option>
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSlot(null)}>Отмена</Button>
            <Button onClick={handleSaveSlot} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tariffModal && (
        <ProxyTariffModal
          token={token}
          nodes={nodes}
          categories={categories}
          modal={tariffModal}
          onClose={() => setTariffModal(null)}
          onSaved={() => { setTariffModal(null); loadCategories(); }}
          saving={saving}
          setSaving={setSaving}
        />
      )}
    </div>
  );
}

function ProxyCategoryModal({
  token,
  modal,
  onClose,
  onSaved,
  saving,
  setSaving,
}: {
  token: string | null;
  modal: "add" | { edit: ProxyCategoryItem };
  onClose: () => void;
  onSaved: () => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
}) {
  const isEdit = modal !== "add";
  const editCat = isEdit ? modal.edit : null;
  const [name, setName] = useState(editCat?.name ?? "");

  useEffect(() => {
    setName(isEdit && editCat ? editCat.name : "");
  }, [modal, isEdit, editCat?.name]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setSaving(true);
    try {
      if (isEdit && editCat) {
        await api.updateProxyCategory(token, editCat.id, { name: name.trim() });
      } else {
        await api.createProxyCategory(token, { name: name.trim() });
      }
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать категорию" : "Новая категория"}</DialogTitle>
          <DialogDescription>Например: Прокси РФ, Прокси EU.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="proxy-cat-name">Название</Label>
              <Input
                id="proxy-cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Прокси РФ"
                className="mt-1"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isEdit ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const CURRENCIES = [{ value: "RUB", label: "RUB" }, { value: "USD", label: "USD" }];

function ProxyTariffModal({
  token,
  nodes,
  categories,
  modal,
  onClose,
  onSaved,
  saving,
  setSaving,
}: {
  token: string | null;
  nodes: ProxyNodeListItem[];
  categories: ProxyCategoryItem[];
  modal: { kind: "add"; categoryId: string } | { kind: "edit"; category: ProxyCategoryItem; tariff: ProxyTariffItem };
  onClose: () => void;
  onSaved: () => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
}) {
  const isEdit = modal.kind === "edit";
  const tariff = isEdit ? modal.tariff : null;
  const categoryId = isEdit ? modal.category.id : modal.categoryId;

  const [name, setName] = useState(tariff?.name ?? "");
  const [proxyCount, setProxyCount] = useState(tariff?.proxyCount ?? 1);
  const [durationDays, setDurationDays] = useState(tariff?.durationDays ?? 30);
  const [price, setPrice] = useState(tariff != null ? String(tariff.price) : "100");
  const [currency, setCurrency] = useState((tariff?.currency ?? "RUB").toUpperCase());
  const [enabled, setEnabled] = useState(tariff?.enabled ?? true);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(tariff?.nodeIds ?? []);

  useEffect(() => {
    if (isEdit && tariff) {
      setName(tariff.name);
      setProxyCount(tariff.proxyCount);
      setDurationDays(tariff.durationDays);
      setPrice(String(tariff.price));
      setCurrency((tariff.currency ?? "RUB").toUpperCase());
      setEnabled(tariff.enabled);
      setSelectedNodeIds(tariff.nodeIds ?? []);
    } else {
      setName("");
      setProxyCount(1);
      setDurationDays(30);
      setPrice("100");
      setCurrency("RUB");
      setEnabled(true);
      setSelectedNodeIds([]);
    }
  }, [modal, isEdit, tariff]);

  const toggleNode = (nodeId: string) => {
    setSelectedNodeIds((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim()) return;
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      alert("Введите корректную цену");
      return;
    }
    setSaving(true);
    try {
      if (isEdit && tariff) {
        await api.updateProxyTariff(token, tariff.id, {
          name: name.trim(),
          proxyCount,
          durationDays,
          price: priceNum,
          currency,
          enabled,
          nodeIds: selectedNodeIds,
        });
      } else {
        await api.createProxyTariff(token, {
          categoryId,
          name: name.trim(),
          proxyCount,
          durationDays,
          price: priceNum,
          currency,
          enabled: enabled ?? true,
          nodeIds: selectedNodeIds.length > 0 ? selectedNodeIds : undefined,
        });
      }
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  const cat = categories.find((c) => c.id === categoryId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать тариф" : "Новый тариф"}</DialogTitle>
          <DialogDescription>
            {cat ? `Категория: ${cat.name}` : "Тариф добавляется в выбранную категорию."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="proxy-t-name">Название</Label>
              <Input
                id="proxy-t-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="1 прокси 30 дней"
                className="mt-1"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="proxy-t-count">Кол-во прокси</Label>
                <Input
                  id="proxy-t-count"
                  type="number"
                  min={1}
                  value={proxyCount}
                  onChange={(e) => setProxyCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="proxy-t-days">Срок (дней)</Label>
                <Input
                  id="proxy-t-days"
                  type="number"
                  min={1}
                  value={durationDays}
                  onChange={(e) => setDurationDays(Math.max(1, parseInt(e.target.value, 10) || 30))}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="proxy-t-price">Цена</Label>
                <Input
                  id="proxy-t-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="proxy-t-currency">Валюта</Label>
                <select
                  id="proxy-t-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="proxy-t-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
              <Label htmlFor="proxy-t-enabled" className="cursor-pointer">Включён (отображается в боте и кабинете)</Label>
            </div>
            <div>
              <Label className="mb-2 block">Ноды (только выбранные будут использоваться для этого тарифа; если пусто — все ноды)</Label>
              {nodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет нод. Добавьте ноды во вкладке «Ноды».</p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1">
                  {nodes.map((n) => (
                    <label key={n.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1">
                      <Checkbox
                        checked={selectedNodeIds.includes(n.id)}
                        onCheckedChange={() => toggleNode(n.id)}
                      />
                      <span className="text-sm truncate">{n.name || n.id}</span>
                      <span className="text-xs text-muted-foreground truncate">{n.publicHost ?? "—"}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isEdit ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
