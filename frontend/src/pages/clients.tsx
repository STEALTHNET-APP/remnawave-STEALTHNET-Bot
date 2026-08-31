import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth";
import {
  api,
  type ClientRecord,
  type UpdateClientPayload,
  type UpdateClientRemnaPayload,
  type RemnaUserFull,
  type RemnaUserUsageResponse,
  type AdminClientSubscriptionItem,
  type TariffCategoryWithTariffs,
  type TariffRecord,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Pencil, Trash2, Ban, ShieldCheck, Wifi, Ticket, KeyRound, Search,
  Copy, Check, Smartphone, Activity, User, Users, HardDrive, Link,
  RefreshCw, Loader2, Package, Gift, Coins, MailX, MailCheck, RotateCw, Plus, Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { clientsBulkApi, type BulkClientAction } from "@/lib/admin-extras-api";
import { ClientSubscriptionsTab } from "@/components/admin/client-subscriptions-tab";
import { fmtMsk, fmtMskDate } from "@/lib/datetime";

function formatTrafficBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Активен", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  DISABLED: { label: "Отключён", color: "bg-red-500/15 text-red-400 border-red-500/20" },
  LIMITED: { label: "Лимит", color: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
  EXPIRED: { label: "Истёк", color: "bg-gray-500/15 text-gray-400 border-gray-500/20" },
};

function getOnlineStatus(onlineAt: string | null): { isOnline: boolean; label: string } {
  if (!onlineAt) return { isOnline: false, label: "Не подключался" };
  const diff = Date.now() - new Date(onlineAt).getTime();
  if (diff < 2 * 60 * 1000) return { isOnline: true, label: "Онлайн" };
  if (diff < 60 * 60 * 1000) return { isOnline: false, label: `${Math.floor(diff / 60000)} мин назад` };
  if (diff < 24 * 60 * 60 * 1000) return { isOnline: false, label: `${Math.floor(diff / 3600000)} ч назад` };
  return { isOnline: false, label: `${Math.floor(diff / 86400000)} дн назад` };
}
export function ClientsPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const [data, setData] = useState<{ items: ClientRecord[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ClientRecord | null>(null);
  const [editForm, setEditForm] = useState<UpdateClientPayload & Partial<UpdateClientRemnaPayload>>({});
  const [settings, setSettings] = useState<{ activeLanguages: string[]; activeCurrencies: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState<{ newPassword: string; confirm: string }>({ newPassword: "", confirm: "" });
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [filterBlocked, setFilterBlocked] = useState<"all" | "blocked" | "active">("all");

  //  Bulk-actions state 
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<BulkClientAction | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ ok: number; failed: number } | null>(null);
  const [remnaBulkBusy, setRemnaBulkBusy] = useState<string | null>(null);
  // optional inputs
  const [bulkAmount, setBulkAmount] = useState("");
  const [bulkReason, setBulkReason] = useState("");

  const [onlineStatuses, setOnlineStatuses] = useState<Record<string, { onlineAt: string | null }>>({});

  const token = state.accessToken!;

  useEffect(() => {
    api.getSettings(token).then((s) => setSettings({ activeLanguages: s.activeLanguages, activeCurrencies: s.activeCurrencies })).catch(() => {});
  }, [token]);

  const loadClients = () => {
    setLoading(true);
    const isBlocked =
      filterBlocked === "blocked" ? true : filterBlocked === "active" ? false : undefined;
    api.getClients(token, page, 20, { search: searchApplied || undefined, isBlocked }).then((r) => {
      setData({ items: r.items, total: r.total });
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  //  Bulk-actions helpers 
  const allRowIds = (data?.items ?? []).map((c) => c.id);
  const allSelected = allRowIds.length > 0 && allRowIds.every((id) => selectedIds.has(id));

  // Массовые операции напрямую в Remnawave (API 2.8 /users/bulk/*): маппим выбранных клиентов  remnawaveUuid.
  const runRemnaBulk = async (action: "reset-traffic" | "revoke") => {
    const uuids = (data?.items ?? []).filter((c) => selectedIds.has(c.id) && c.remnawaveUuid).map((c) => c.remnawaveUuid as string);
    if (uuids.length === 0) { setBulkError("У выбранных клиентов нет VPN-подписки (remnawaveUuid)."); setBulkResult(null); return; }
    const label = action === "reset-traffic" ? "Сбросить трафик" : "Перевыпустить подписку (revoke)";
    if (!confirm(`${label} у ${uuids.length} клиент(ов) в Remnawave?`)) return;
    setRemnaBulkBusy(action); setBulkError(null); setBulkResult(null);
    try {
      await api.remnaUsersBulk(token, action, uuids);
      setBulkResult({ ok: uuids.length, failed: 0 });
      await loadClients();
    } catch (e) { setBulkError(e instanceof Error ? e.message : "Ошибка массовой операции Remnawave"); }
    finally { setRemnaBulkBusy(null); }
  };
  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allRowIds));
  }
  function clearSelection() {
    setSelectedIds(new Set());
    setBulkError(null);
    setBulkResult(null);
    setBulkAmount("");
    setBulkReason("");
  }
  async function runBulk(action: BulkClientAction) {
    if (selectedIds.size === 0) return;
    setBulkBusy(action);
    setBulkError(null);
    setBulkResult(null);
    try {
      const params: { reason?: string; amount?: number } = {};
      if (action === "credit_balance" || action === "debit_balance") {
        const n = parseFloat(bulkAmount);
        if (!Number.isFinite(n) || n <= 0) {
          setBulkError("Введите положительное число для amount");
          setBulkBusy(null);
          return;
        }
        params.amount = n;
      }
      if (action === "block" && bulkReason) params.reason = bulkReason;

      const r = await clientsBulkApi.bulk(token, {
        action,
        ids: Array.from(selectedIds),
        params: Object.keys(params).length ? params : undefined,
      });
      setBulkResult({ ok: r.ok, failed: r.failed });
      if (r.failed === 0) {
        // полный успех — снимаем выделение и перезагружаем
        setTimeout(() => {
          setSelectedIds(new Set());
          loadClients();
        }, 1500);
      } else {
        loadClients();
      }
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "bulk error");
    } finally {
      setBulkBusy(null);
    }
  }

  useEffect(() => {
    loadClients();
  }, [token, page, searchApplied, filterBlocked]);

  useEffect(() => {
    const uuids = data?.items
      .map(c => c.remnawaveUuid)
      .filter((u): u is string => Boolean(u)) ?? [];
    if (uuids.length === 0) return;
    
    const poll = () => {
      api.getClientsOnlineStatuses(token, uuids)
        .then(setOnlineStatuses)
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [token, data?.items]);

  const applySearch = () => {
    setSearchApplied(search);
    setPage(1);
  };

  function openEdit(c: ClientRecord) {
    setEditing(c);
    setEditForm({
      email: c.email ?? undefined,
      preferredLang: c.preferredLang,
      preferredCurrency: c.preferredCurrency,
      balance: c.balance,
      isBlocked: c.isBlocked,
      blockReason: c.blockReason ?? undefined,
      referralPercent: c.referralPercent ?? undefined,
      personalDiscountPercent: c.personalDiscountPercent ?? undefined,
      personalDiscountIsOneTime: c.personalDiscountIsOneTime ?? false,
    });
    setActionMessage(null);
  }

  async function saveClient() {
    if (!editing) return;
    setSaving(true);
    setActionMessage(null);
    try {
      const updated = await api.updateClient(token, editing.id, {
        email: editForm.email ?? null,
        preferredLang: editForm.preferredLang,
        preferredCurrency: editForm.preferredCurrency,
        balance: editForm.balance,
        isBlocked: editForm.isBlocked,
        blockReason: editForm.blockReason ?? null,
        referralPercent: editForm.referralPercent ?? null,
        personalDiscountPercent: editForm.personalDiscountPercent ?? null,
        personalDiscountIsOneTime: editForm.personalDiscountIsOneTime ?? false,
      });
      setEditing(updated);
      // Пересоздаём форму из обновлённых данных, иначе input'ы (привязанные к editForm)
      // показали бы пустые значения после save, и нужно было бы переоткрыть карточку.
      setEditForm({
        email: updated.email ?? undefined,
        preferredLang: updated.preferredLang,
        preferredCurrency: updated.preferredCurrency,
        balance: updated.balance,
        isBlocked: updated.isBlocked,
        blockReason: updated.blockReason ?? undefined,
        referralPercent: updated.referralPercent ?? undefined,
        personalDiscountPercent: updated.personalDiscountPercent ?? undefined,
        personalDiscountIsOneTime: updated.personalDiscountIsOneTime ?? false,
      });
      setActionMessage(t("admin.clients.saved"));
      loadClients();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : t("admin.clients.error"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteClient(c: ClientRecord) {
    if (!confirm(`Удалить клиента ${c.email || c.telegramId || c.id}?`)) return;
    try {
      await api.deleteClient(token, c.id);
      if (editing?.id === c.id) setEditing(null);
      loadClients();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  }

  async function saveClientPassword() {
    if (!editing) return;
    if (passwordForm.newPassword.length < 8) {
      setPasswordMessage(t("admin.clients.password_min_8"));
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirm) {
      setPasswordMessage(t("admin.clients.passwords_mismatch"));
      return;
    }
    setPasswordMessage(null);
    setSavingPassword(true);
    try {
      await api.setClientPassword(token, editing.id, passwordForm.newPassword);
      setPasswordMessage(t("admin.clients.password_set"));
      setPasswordForm({ newPassword: "", confirm: "" });
    } catch (e) {
      setPasswordMessage(e instanceof Error ? e.message : t("admin.clients.error"));
    } finally {
      setSavingPassword(false);
    }
  }

  const totalPages = data ? Math.ceil(data.total / 20) : 0;
  return (
    <div className="space-y-6 relative min-h-screen">
      {/* Ambient Glows */}

      {/* HEADER */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >

        <div className="relative flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
              {t("admin.clients.title")}
            </h1>
            <div className="flex items-center gap-2 mt-[3px] flex-wrap text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary border border-border">
                <Users className="h-3 w-3" />
                Всего: <span className="tabular-nums">{data?.total ?? 0}</span>
              </span>
              {data && data.items.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-500 dark:text-emerald-400 border border-emerald-500/20">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  Live
                </span>
              )}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={loadClients} disabled={loading} className="relative h-9 w-9 rounded-full hover:bg-foreground/[0.06] dark:hover:bg-card">
          <RefreshCw className={cn("h-4 w-4 text-muted-foreground transition-all", loading && "animate-[spin_1.5s_linear_infinite] text-primary")} />
        </Button>
      </motion.div>

      {/* FILTERS */}
      <Card className="bg-card border-border p-4 rounded-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={t("admin.clients.search_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySearch()}
              className="pl-9 pr-20 bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50 rounded-xl"
            />
            <Button
              variant="secondary" size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-3 text-xs bg-primary/15 hover:bg-primary/25 text-primary border border-border rounded-lg"
              onClick={applySearch}
            >
              {t("admin.clients.find")}
            </Button>
          </div>
          <div className="flex items-center gap-1 bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-border">
            {(["all", "active", "blocked"] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setFilterBlocked(f); setPage(1); }}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  filterBlocked === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] dark:hover:bg-card"
                )}
              >
                {f === "all" ? t("admin.clients.all") : f === "active" ? t("admin.clients.active") : t("admin.clients.blocked")}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* BULK ACTIONS BAR */}
      {selectedIds.size > 0 && (
        <Card className="bg-primary/10 border-border p-4 rounded-xl">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                {selectedIds.size}
              </span>
              <span className="text-sm font-medium text-foreground">выбрано</span>
              <button
                onClick={clearSelection}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                сбросить
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="amount"
                type="number"
                value={bulkAmount}
                onChange={(e) => setBulkAmount(e.target.value)}
                className="h-8 w-[100px] text-xs rounded-lg bg-card border-border"
              />
              <Input
                placeholder="причина (для блокировки)"
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                className="h-8 w-[180px] text-xs rounded-lg bg-card border-border"
              />

              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("block")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
              >
                {bulkBusy === "block" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                Block
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("unblock")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
              >
                {bulkBusy === "unblock" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                Unblock
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("credit_balance")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
              >
                {bulkBusy === "credit_balance" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Coins className="h-3 w-3" />}
                +Balance
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("debit_balance")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
              >
                {bulkBusy === "debit_balance" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Coins className="h-3 w-3" />}
                −Balance
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("reset_trial")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
              >
                {bulkBusy === "reset_trial" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                Reset Trial
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("mark_unreachable")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
              >
                {bulkBusy === "mark_unreachable" ? <Loader2 className="h-3 w-3 animate-spin" /> : <MailX className="h-3 w-3" />}
                TG 
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("mark_reachable")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
              >
                {bulkBusy === "mark_reachable" ? <Loader2 className="h-3 w-3 animate-spin" /> : <MailCheck className="h-3 w-3" />}
                TG 
              </Button>
              <div className="w-px h-5 bg-card mx-0.5 self-center" />
              <Button
                size="sm" variant="outline"
                onClick={() => runRemnaBulk("reset-traffic")}
                disabled={remnaBulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
                title="Сбросить трафик в Remnawave"
              >
                {remnaBulkBusy === "reset-traffic" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                Трафик 0
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runRemnaBulk("revoke")}
                disabled={remnaBulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
                title="Перевыпустить подписку (revoke) — старая ссылка перестанет работать"
              >
                {remnaBulkBusy === "revoke" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Revoke
              </Button>
            </div>
          </div>

          {(bulkError || bulkResult) && (
            <div className="mt-3 pt-3 border-t border-border flex items-center gap-3 text-xs">
              {bulkError && <span className="text-rose-500">{bulkError}</span>}
              {bulkResult && (
                <span className={cn("font-medium", bulkResult.failed === 0 ? "text-emerald-500" : "text-amber-500")}>
                  Готово: {bulkResult.ok} ОК
                  {bulkResult.failed > 0 && ` · ${bulkResult.failed} с ошибкой`}
                </span>
              )}
            </div>
          )}
        </Card>
      )}

      {/* TABLE */}
      <Card className="bg-card border-border rounded-2xl overflow-hidden relative min-h-[400px]">
        {loading && !data ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-card">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <span className="text-sm font-medium text-muted-foreground">{t("admin.clients.loading")}</span>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-muted-foreground font-medium">{t("admin.clients.loading_error")}</p>
            {searchApplied && (
              <Button variant="link" size="sm" className="mt-2 text-primary" onClick={() => { setSearch(""); setSearchApplied(""); }}>
                {t("admin.common.refresh")}
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-[10.5px] uppercase tracking-[0.7px] text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-3 pb-2 pt-1">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border bg-background cursor-pointer accent-primary"
                      checked={allSelected}
                      onChange={toggleAll}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Выбрать всех"
                    />
                  </th>
                  <th className="px-3 pb-2 pt-1 font-bold">Клиент</th>
                  <th className="px-3 pb-2 pt-1 font-bold">Контакты</th>
                  <th className="px-3 pb-2 pt-1 font-bold">Язык</th>
                  <th className="px-3 pb-2 pt-1 font-bold text-right">Баланс</th>
                  <th className="px-3 pb-2 pt-1 font-bold">Регистрация</th>
                  <th className="px-3 pb-2 pt-1 font-bold">Статус</th>
                  <th className="px-3 pb-2 pt-1 text-right font-bold">Действия</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c, idx) => {
                  const onlineAt = onlineStatuses[c.remnawaveUuid ?? ""]?.onlineAt ?? c.onlineAt ?? null;
                  const status = getOnlineStatus(onlineAt);
                  
                  return (
                    <motion.tr
                      key={c.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.02 }}
                      onClick={() => openEdit(c)}
                      className={cn(
                        "group cursor-pointer transition-colors border-t border-border hover:bg-muted/60",
                        c.isBlocked && "bg-destructive/5"
                      )}
                    >
                      <td className="px-3 py-2 w-9" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border bg-background cursor-pointer accent-primary"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleId(c.id)}
                          aria-label={`Выбрать клиента ${c.id}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground text-[12.7px]">
                                {c.telegramUsername ? `@${c.telegramUsername}` : c.email || `ID: ${c.telegramId ?? c.id.slice(0, 8)}`}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={cn("inline-flex h-[6px] w-[6px] rounded-full", status.isOnline ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                              <span className="text-[10.5px] text-muted-foreground">{status.label}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5 text-[12px] text-muted-foreground">
                          {c.email && c.telegramUsername && <div className="flex items-center gap-1"><span className="text-foreground/80">{c.email}</span></div>}
                          {c.telegramId && <div className="flex items-center gap-1">TG: <span className="text-foreground/80">{c.telegramId}</span></div>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[12px] uppercase text-muted-foreground">{c.preferredLang}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={cn("tabular-nums text-[12.7px]", c.balance > 0 ? "text-foreground font-semibold" : "text-muted-foreground")}>
                          {c.balance.toFixed(2)} {c.preferredCurrency.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[12px] text-muted-foreground tabular-nums">{fmtMskDate(c.createdAt)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          {c.isBlocked && (
                            <span className="inline-flex items-center rounded-full bg-red-500/15 text-red-400 px-2.5 py-0.5 text-[11px] font-medium border border-red-500/20 max-w-fit shadow-sm">
                              <Ban className="h-3 w-3 mr-1" /> {t("admin.clients.block")}
                            </span>
                          )}
                          {c.activeNode && (
                            <span className="inline-flex items-center rounded-full bg-emerald-500/15 text-emerald-400 px-2.5 py-0.5 text-[11px] font-medium border border-emerald-500/20 max-w-fit shadow-sm">
                              <Activity className="h-3 w-3 mr-1" /> {c.activeNode}
                            </span>
                          )}
                          {!c.isBlocked && !c.activeNode && (
                            <span className="text-[10.5px] font-bold px-2 py-[2px] rounded-full bg-muted text-muted-foreground max-w-fit">НЕТ ПОДПИСКИ</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted hover:text-foreground" onClick={(e) => { e.stopPropagation(); openEdit(c); }} title="Редактировать">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/15 text-destructive" onClick={(e) => { e.stopPropagation(); deleteClient(c); }} title="Удалить">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-card border border-border px-3 py-2 rounded-xl">
          <span className="text-sm font-medium text-muted-foreground px-3">
            {page} / {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)} className="h-8 w-8 p-0 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border-border rounded-lg">
              «</Button>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-8 px-3 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border-border rounded-lg">
              {t("admin.common.back")}
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-8 px-3 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border-border rounded-lg">
              {t("admin.sales.next")}
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="h-8 w-8 p-0 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border-border rounded-lg">»
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <ClientEditModal
          client={editing}
          editForm={editForm}
          setEditForm={setEditForm}
          saving={saving}
          actionMessage={actionMessage}
          activeLanguages={settings?.activeLanguages ?? []}
          activeCurrencies={settings?.activeCurrencies ?? []}
          onClose={() => {
            setEditing(null);
            setPasswordForm({ newPassword: "", confirm: "" });
            setPasswordMessage(null);
          }}
          onSave={saveClient}
          onSetPassword={saveClientPassword}
          passwordForm={passwordForm}
          setPasswordForm={setPasswordForm}
          passwordMessage={passwordMessage}
          savingPassword={savingPassword}
          token={token}
        />
      )}
    </div>
  );
}

function ClientEditModal({
  client: editing,
  editForm,
  setEditForm,
  saving,
  actionMessage,
  onClose,
  onSave,
  onSetPassword,
  passwordForm,
  setPasswordForm,
  passwordMessage,
  savingPassword,
  token,
  activeLanguages,
  activeCurrencies,
}: {
  client: ClientRecord;
  editForm: UpdateClientPayload & Partial<UpdateClientRemnaPayload>;
  setEditForm: React.Dispatch<React.SetStateAction<UpdateClientPayload & Partial<UpdateClientRemnaPayload>>>;
  saving: boolean;
  actionMessage: string | null;
  activeLanguages: string[];
  activeCurrencies: string[];
  onClose: () => void;
  onSave: () => Promise<void>;
  onSetPassword: () => Promise<void>;
  passwordForm: { newPassword: string; confirm: string };
  setPasswordForm: React.Dispatch<React.SetStateAction<{ newPassword: string; confirm: string }>>;
  passwordMessage: string | null;
  savingPassword: boolean;
  token: string;
}) {
  const { t } = useTranslation();
  const { state } = useAuth();
  // T-admin-services (портировано из WolfVPN): доступ к вкладке «Услуги» — ADMIN или action manage_services.
  const canManageServices = state.admin?.role === "ADMIN" || (Array.isArray(state.admin?.allowedSections) && state.admin.allowedSections.includes("action:manage_services"));
  const [tab, setTab] = useState("profile");
  const [remnaUser, setRemnaUser] = useState<RemnaUserFull | null>(null);
  const [, setRemnaLoading] = useState(false);
  // devices-список теперь во вложенном <ClientAllDevicesTab>.
  // Здесь оставляем только total — для бейджа на вкладке.
  const [devicesTotal, setDevicesTotal] = useState(0);
  // inline-редактор реферера (кто привёл клиента).
  const [referrerInfo, setReferrerInfo] = useState<ClientRecord["referrer"]>(undefined);
  const [referrerInput, setReferrerInput] = useState("");
  const [referrerLookupBy, setReferrerLookupBy] = useState<"referralCode" | "username" | "tgid" | "id">("referralCode");
  const [referrerSaving, setReferrerSaving] = useState(false);
  const [referrerMessage, setReferrerMessage] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<RemnaUserUsageResponse["response"] | null>(null);
  // раньше тут грузили через getSecondarySubscriptions(search=clientId).
  // Этот endpoint был для глобальной страницы /admin/secondary-subscriptions и работал
  // через text-search по нескольким полям — для мигрированных клиентов случались
  // false-negatives (показывало «У клиента ещё нет подписок» когда subs в DB были).
  // Теперь используем дедикатед /admin/clients/:id/subscriptions — точный фильтр по
  // ownerId + giftedToClientId, возвращает ВСЕ subs клиента (включая root index=0).
  const [secondarySubs, setSecondarySubs] = useState<AdminClientSubscriptionItem[]>([]);
  const [secondarySubsLoading, setSecondarySubsLoading] = useState(false);

  const [tariffCategories, setTariffCategories] = useState<TariffCategoryWithTariffs[]>([]);
  const [selectedGrantTariffId, setSelectedGrantTariffId] = useState<string>("");
  // Выбранная опция длительности из priceOptions выбранного тарифа
  const [selectedGrantOptionId, setSelectedGrantOptionId] = useState<string>("");
  // кастомный лимит трафика в GB (override тарифа).
  // Пустая строка  используется лимит тарифа. Поле показывается только для НЕ-безлимитных тарифов.
  const [grantTrafficGb, setGrantTrafficGb] = useState<string>("");
  // override длительности в днях. Пустая строка  используется
  // длительность выбранной опции / тарифа по умолчанию.
  const [grantCustomDays, setGrantCustomDays] = useState<string>("");
  const [grantNote, setGrantNote] = useState<string>("");
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantMessage, setGrantMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const loadRemnaUser = useCallback(() => {
    if (!editing.remnawaveUuid) return;
    setRemnaLoading(true);
    api.getClientRemna(token, editing.id).then((raw: unknown) => {
      const resp = (raw as Record<string, unknown>)?.response ?? raw;
      setRemnaUser(resp as RemnaUserFull);
    }).catch(() => {}).finally(() => setRemnaLoading(false));
  }, [token, editing.id, editing.remnawaveUuid]);

  // Тут только обновляем total для бейджа — сам список рендерится в ClientAllDevicesTab.
  const loadDevices = useCallback(() => {
    api.getClientAllDevices(token, editing.id).then((r) => {
      setDevicesTotal(r.total);
    }).catch(() => {});
  }, [token, editing.id]);

  const loadUsage = useCallback(() => {
    if (!editing.remnawaveUuid) return;
    api.getClientRemnaUsage(token, editing.id, 30).then((d) => {
      setUsageData(d.response ?? null);
    }).catch(() => {});
  }, [token, editing.id, editing.remnawaveUuid]);

  const loadSecondarySubs = useCallback(() => {
    setSecondarySubsLoading(true);
    api.getClientSubscriptionsList(token, editing.id)
      .then((r) => setSecondarySubs(r.items ?? []))
      .catch(() => setSecondarySubs([]))
      .finally(() => setSecondarySubsLoading(false));
  }, [token, editing.id]);

  // догружаем реферера (список клиентов его не отдаёт).
  const loadReferrer = useCallback(() => {
    api.getClientDetail(token, editing.id)
      .then((full) => setReferrerInfo(full.referrer ?? null))
      .catch(() => setReferrerInfo(null));
  }, [token, editing.id]);

  async function attachReferrer() {
    if (!referrerInput.trim()) return;
    setReferrerSaving(true);
    setReferrerMessage(null);
    try {
      const res = await api.setReferralReferrer(token, editing.id, referrerInput.trim(), referrerLookupBy);
      loadReferrer();
      setReferrerInput("");
      setReferrerMessage(res.referrerId ? " Реферер привязан" : "Реферер убран");
    } catch (e) {
      setReferrerMessage(e instanceof Error ? e.message : "Ошибка привязки");
    } finally {
      setReferrerSaving(false);
    }
  }

  async function detachReferrer() {
    setReferrerSaving(true);
    setReferrerMessage(null);
    try {
      await api.setReferralReferrer(token, editing.id, null);
      setReferrerInfo(null);
      setReferrerMessage("Реферер убран");
    } catch (e) {
      setReferrerMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setReferrerSaving(false);
    }
  }

  useEffect(() => {
    loadRemnaUser();
    loadDevices();
    loadUsage();
    loadSecondarySubs();
    loadReferrer();
  }, [loadRemnaUser, loadDevices, loadUsage, loadSecondarySubs, loadReferrer]);

  useEffect(() => {
    let cancelled = false;
    api.getTariffCategories(token)
      .then((r) => { if (!cancelled) setTariffCategories(r.items ?? []); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [token]);

  const flatTariffs: TariffRecord[] = tariffCategories.flatMap((c) => c.tariffs ?? []);

  const handleGrantTariff = async () => {
    if (!selectedGrantTariffId) return;
    setGrantLoading(true);
    setGrantMessage(null);
    try {
      // парсим override трафика — GB  bytes.
      // Пустая строка / некорректное число  null (используется лимит тарифа).
      let trafficLimitBytesOverride: number | null | undefined;
      const trimmed = grantTrafficGb.trim();
      if (trimmed !== "") {
        const gb = parseFloat(trimmed.replace(",", "."));
        if (Number.isFinite(gb) && gb >= 0) {
          trafficLimitBytesOverride = Math.round(gb * 1024 ** 3);
        }
      }
      // парсим override длительности. Пустая строка / не-число  не шлём.
      let customDurationDaysOverride: number | undefined;
      const daysTrimmed = grantCustomDays.trim();
      if (daysTrimmed !== "") {
        const days = parseInt(daysTrimmed, 10);
        if (Number.isFinite(days) && days >= 1 && days <= 3650) {
          customDurationDaysOverride = days;
        }
      }
      const res = await api.grantClientTariff(token, editing.id, {
        tariffId: selectedGrantTariffId,
        tariffPriceOptionId: selectedGrantOptionId || undefined,
        note: grantNote.trim() || undefined,
        ...(trafficLimitBytesOverride !== undefined ? { trafficLimitBytes: trafficLimitBytesOverride } : {}),
        ...(customDurationDaysOverride !== undefined ? { customDurationDays: customDurationDaysOverride } : {}),
      });
      if (res.ok) {
        setGrantMessage({
          type: "ok",
          text: t("admin.clients.grant_tariff_success", {
            defaultValue: "Тариф «{{name}}» выдан ({{days}} дн.)",
            name: res.tariff?.name ?? "",
            days: res.tariff?.durationDays ?? 0,
          }),
        });
        setGrantNote("");
        setGrantTrafficGb("");
        setGrantCustomDays("");
        loadRemnaUser();
        loadDevices();
        loadUsage();
        loadSecondarySubs();
      } else {
        setGrantMessage({ type: "err", text: res.message ?? t("admin.clients.grant_tariff_error", "Не удалось выдать тариф") });
      }
    } catch (e) {
      setGrantMessage({
        type: "err",
        text: e instanceof Error ? e.message : t("admin.clients.grant_tariff_error", "Не удалось выдать тариф"),
      });
    } finally {
      setGrantLoading(false);
    }
  };

  const trafficUsed = remnaUser?.userTraffic?.usedTrafficBytes ?? 0;
  const trafficLimit = remnaUser?.trafficLimitBytes ?? 0;
  const trafficLifetime = remnaUser?.userTraffic?.lifetimeUsedTrafficBytes ?? 0;
  const trafficPercent = trafficLimit > 0 ? Math.min((trafficUsed / trafficLimit) * 100, 100) : 0;

  const statusInfo = STATUS_MAP[remnaUser?.status ?? ""] ?? { label: remnaUser?.status ?? "—", color: "bg-muted" };

  const isOnline = remnaUser?.userTraffic?.onlineAt != null;
  const onlineAt = remnaUser?.userTraffic?.onlineAt;

  const totalUsageLast30 = usageData?.sparklineData?.reduce((a, b) => a + b, 0) ?? 0;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[1180px] w-[96vw] max-h-[92vh] overflow-y-auto p-0 gap-0 bg-card border border-border sm:rounded-2xl [&>button]:z-50">
        
        
        <div className="px-5 py-[17px] border-b border-border relative z-10 bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-[15px] font-bold">
              <div className="h-9 w-11 shrink-0 rounded-xl bg-primary/12 text-primary grid place-items-center text-[15px] font-extrabold uppercase">
                {(editing.telegramUsername || editing.email || String(editing.telegramId ?? "К")).replace(/^@/, "").slice(0, 2)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="truncate text-[17px] font-extrabold">{editing.email || editing.telegramUsername ? `@${editing.telegramUsername}` : editing.telegramId || "Клиент"}</span>
                  {editing.remnawaveUuid && (
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", statusInfo.color)}>
                      {statusInfo.label}
                    </span>
                  )}
                  {editing.isBlocked && (
                    <span className="inline-flex items-center rounded-full bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20 px-2 py-0.5 text-[11px] font-medium">
                      {t("admin.clients.is_blocked")}
                    </span>
                  )}
                </div>
                <div className="text-[12.3px] text-muted-foreground font-normal mt-[3px]">
                  {t("admin.clients.created")} {fmtMsk(editing.createdAt)}
                  {remnaUser?.shortUuid && <> &middot; <code className="text-[10px]">{remnaUser.shortUuid}</code></>}
                </div>
              </div>
            </DialogTitle>
            <DialogDescription className="sr-only">{t("admin.clients.modal_title")}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-5 pt-4 relative z-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-[10px] bg-background border border-border px-3 py-2.5">
              <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.5px]">Баланс</div>
              <div className="text-[17px] font-extrabold tabular-nums mt-0.5">{editing.balance.toFixed(2)} {editing.preferredCurrency.toUpperCase()}</div>
            </div>
            <div className="rounded-[10px] bg-background border border-border px-3 py-2.5">
              <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.5px]">Подписок</div>
              <div className="text-[17px] font-extrabold tabular-nums mt-0.5">{secondarySubs.length}</div>
            </div>
            <div className="rounded-[10px] bg-background border border-border px-3 py-2.5">
              <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.5px]">Рефералов</div>
              <div className="text-[17px] font-extrabold tabular-nums mt-0.5">{editing._count?.referrals ?? 0}</div>
            </div>
            <div className="rounded-[10px] bg-background border border-border px-3 py-2.5">
              <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.5px]">Регистрация</div>
              <div className="text-[15px] font-bold tabular-nums mt-0.5">{fmtMskDate(editing.createdAt)}</div>
            </div>
          </div>
        </div>

        {editing.remnawaveUuid && remnaUser && (
          <div className="px-5 pt-3 relative z-10">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-[10px] bg-background border border-border px-3 py-2.5 space-y-1 transition-colors">
                <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.5px]">{t("admin.clients.traffic")}</div>
                <div className="text-[17px] font-extrabold tabular-nums">{formatTrafficBytes(trafficUsed)}</div>
                {trafficLimit > 0 && (
                  <>
                    <div className="text-[11px] text-muted-foreground">из {formatTrafficBytes(trafficLimit)}</div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all",
                          trafficPercent > 90 ? "bg-red-500" : trafficPercent > 70 ? "bg-amber-500" : "bg-green-500"
                        )}
                        style={{ width: `${trafficPercent}%` }}
                      />
                    </div>
                  </>
                )}
                {trafficLimit === 0 && <div className="text-[11px] text-muted-foreground">{t("admin.clients.unlimited")}</div>}
              </div>
              <div className="rounded-[10px] bg-background border border-border px-3 py-2.5 space-y-1 transition-colors">
                <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.5px]">{t("admin.clients.traffic_30d")}</div>
                <div className="text-[17px] font-extrabold tabular-nums">{formatTrafficBytes(totalUsageLast30)}</div>
                <div className="text-[11px] text-muted-foreground">{t("admin.clients.total_traffic")} {formatTrafficBytes(trafficLifetime)}</div>
              </div>
              <div className="rounded-[10px] bg-background border border-border px-3 py-2.5 space-y-1 transition-colors">
                <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.5px]">{t("admin.clients.devices")}</div>
                <div className="text-[17px] font-extrabold tabular-nums">{devicesTotal}</div>
                <div className="text-[11px] text-muted-foreground">
                  {t("admin.clients.device_limit")} {remnaUser.hwidDeviceLimit != null ? remnaUser.hwidDeviceLimit : "—"}
                </div>
              </div>
              <div className="rounded-[10px] bg-background border border-border px-3 py-2.5 space-y-1 transition-colors">
                <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.5px]">{t("admin.clients.status")}</div>
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", isOnline ? "bg-green-500 animate-pulse" : "bg-gray-400")} />
                  <span className="text-sm font-medium">{isOnline ? t("admin.clients.status_online") : t("admin.clients.status_offline")}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {onlineAt ? `${t("admin.clients.last_seen")} ${fmtMsk(onlineAt)}` :
                    remnaUser.userTraffic?.firstConnectedAt ? `${t("admin.clients.first_login")} ${fmtMskDate(remnaUser.userTraffic.firstConnectedAt)}` : t("admin.clients.no_data")}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="px-5 pt-3.5 pb-5 relative z-10">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex flex-wrap gap-1.5 bg-muted border border-border rounded-xl p-1.5 justify-start">
              <TabsTrigger value="profile" className="gap-1.5 text-xs rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                <User className="h-3.5 w-3.5" /> {t("admin.clients.info")}
              </TabsTrigger>
              {/* после унификации Client.remnawaveUuid может быть null,
                  но у клиента есть Subscription[0].remnawaveUuid. Показываем вкладки если ЕСТЬ
                  хоть одна подписка с remnawaveUuid (включая primary). */}
              {/* вкладка «Подписки» заменила «Remna».
                  Данные Remna / Лимиты / Сквады / Быстрые действия теперь per-subscription.
                  Вкладка «Действия» оставлена для МАССОВЫХ операций (применяются ко ВСЕМ подпискам). */}
              {/* показываем вкладки и если у клиента есть подписки БЕЗ
                  remna (например, migrate_inactive не создаёт Remna user — он добавляется при
                  первой покупке). Иначе кнопка «Открыть детально» в инлайн-блоке switch'ала
                  на несуществующий tab. */}
              {(editing.remnawaveUuid || secondarySubs.length > 0) && (
                <>
                  <TabsTrigger value="subscriptions" className="gap-1.5 text-xs rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                    <Package className="h-3.5 w-3.5" /> Подписки
                  </TabsTrigger>
                  <TabsTrigger value="devices" className="gap-1.5 text-xs rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                    <Smartphone className="h-3.5 w-3.5" /> {t("admin.clients.devices")}
                    {devicesTotal > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-bold text-primary">{devicesTotal}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="actions" className="gap-1.5 text-xs rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                    <Activity className="h-3.5 w-3.5" /> {t("admin.clients.actions")}
                  </TabsTrigger>
                  {canManageServices && (
                    <TabsTrigger value="services" className="gap-1.5 text-xs rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                      <Gift className="h-3.5 w-3.5" /> Услуги
                    </TabsTrigger>
                  )}
                </>
              )}
            </TabsList>

            {/*  Профиль  */}
            <TabsContent value="profile">
              <div className="space-y-5">
                <details className="rounded-xl bg-muted border border-border px-4 py-3 text-sm [&_summary]:list-none group">
                  <summary className="flex items-center gap-2 font-semibold text-[13px] cursor-pointer select-none">
                    <Gift className="h-4 w-4 text-primary" />
                    {t("admin.clients.grant_tariff_title", "Выдать тариф")}
                    <span className="ml-auto text-[11.5px] font-normal text-muted-foreground group-open:hidden">развернуть</span>
                    <span className="ml-auto text-[11.5px] font-normal text-muted-foreground hidden group-open:inline">свернуть</span>
                  </summary>
                  <div className="space-y-3 mt-3">
                  <p className="text-xs text-muted-foreground">
                    {t("admin.clients.grant_tariff_hint", "Активирует выбранный тариф для клиента без оплаты. Будет создана запись платежа со статусом PAID и суммой 0. Реферальные бонусы не начисляются.")}
                  </p>

                  {/* Шаг 1: выбор тарифа */}
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">
                      1. {t("admin.clients.grant_tariff_select", "Тариф")}
                    </Label>
                    <select
                      className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      value={selectedGrantTariffId}
                      onChange={(e) => {
                        const newId = e.target.value;
                        setSelectedGrantTariffId(newId);
                        // Сбрасываем выбранную опцию — будет авто-выбрана дешёвая ниже
                        setSelectedGrantOptionId("");
                      }}
                      disabled={grantLoading}
                    >
                      <option value="">{t("admin.clients.grant_tariff_choose", "— выберите тариф —")}</option>
                      {tariffCategories.map((cat) => (
                        <optgroup key={cat.id} label={cat.name}>
                          {(cat.tariffs ?? []).map((tr) => {
                            const opts = tr.priceOptions ?? [];
                            const minPrice = opts.length > 0 ? Math.min(...opts.map((o) => o.price)) : tr.price;
                            return (
                              <option key={tr.id} value={tr.id}>
                                {tr.name}
                                {tr.trafficLimitBytes != null && tr.trafficLimitBytes > 0
                                  ? ` · ${formatTrafficBytes(Number(tr.trafficLimitBytes))}`
                                  : ""}
                                {tr.deviceLimit ? ` · ${tr.deviceLimit} устр.` : ""}
                                {opts.length > 1 ? ` · от ${minPrice} ${tr.currency.toUpperCase()}` : ` · ${minPrice} ${tr.currency.toUpperCase()}`}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                      {flatTariffs.length === 0 && (
                        <option value="" disabled>
                          {t("admin.clients.grant_tariff_empty", "Нет доступных тарифов")}
                        </option>
                      )}
                    </select>
                  </div>

                  {/* Шаг 2: chips с опциями длительности (если несколько) */}
                  {(() => {
                    const selectedTariff = flatTariffs.find((tr) => tr.id === selectedGrantTariffId);
                    const opts = selectedTariff?.priceOptions ?? [];
                    if (!selectedTariff || opts.length === 0) return null;
                    const sorted = [...opts].sort((a, b) => a.sortOrder - b.sortOrder || a.durationDays - b.durationDays);
                    const minPpd = Math.min(...opts.map((o) => o.price / Math.max(1, o.durationDays)));
                    const effectiveOptId = selectedGrantOptionId || sorted[0].id;
                    return (
                      <div className="space-y-1.5">
                        <Label className="text-[11px] text-muted-foreground">
                          2. Длительность <span className="text-muted-foreground/60">— клиент получит выбранную опцию</span>
                        </Label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {sorted.map((opt) => {
                            const ppd = opt.price / Math.max(1, opt.durationDays);
                            const isBest = opts.length > 1 && Math.abs(ppd - minPpd) < 0.0001;
                            const isSelected = effectiveOptId === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={grantLoading}
                                onClick={() => setSelectedGrantOptionId(opt.id)}
                                className={cn(
                                  "relative rounded-xl border p-3 text-left transition-all hover:scale-[1.02]",
                                  isSelected
                                    ? "bg-primary/15 border-primary ring-1 ring-primary/30"
                                    : "bg-card border-border hover:border-border",
                                  grantLoading && "opacity-50 cursor-not-allowed"
                                )}
                              >
                                {isBest && (
                                  <span className="absolute -top-1.5 -right-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-bold">
                                    <Check className="h-2.5 w-2.5" />
                                    Best
                                  </span>
                                )}
                                <div className="font-bold text-sm tabular-nums">{opt.durationDays} дн.</div>
                                <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                  {opt.price} {selectedTariff.currency.toUpperCase()}
                                </div>
                                <div className="text-[10px] text-muted-foreground/80 tabular-nums mt-0.5">
                                  ≈ {ppd.toFixed(2)} {selectedTariff.currency.toUpperCase()}/день
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 3. Лимит трафика — ТОЛЬКО для НЕ-безлимитных тарифов.
                      Если у тарифа trafficLimitBytes == 0 / null  блок скрыт (нечего переопределять).
                      Пустое поле  используется лимит тарифа. */}
                  {(() => {
                    const selectedTariff = flatTariffs.find((tr) => tr.id === selectedGrantTariffId);
                    const tariffLimitBytes = selectedTariff?.trafficLimitBytes != null ? Number(selectedTariff.trafficLimitBytes) : 0;
                    const tariffIsUnlimited = !selectedTariff || tariffLimitBytes <= 0;
                    if (tariffIsUnlimited) return null;
                    const defaultGb = (tariffLimitBytes / 1024 ** 3).toFixed(0);
                    return (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">
                          3. {t("admin.clients.grant_tariff_traffic", "Лимит трафика (GB)")} —{" "}
                          <span className="text-foreground/70">
                            {t("admin.clients.grant_tariff_traffic_hint", { defaultValue: "по умолчанию {{gb}} GB; 0 = безлимит", gb: defaultGb })}
                          </span>
                        </Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.1}
                          value={grantTrafficGb}
                          onChange={(e) => setGrantTrafficGb(e.target.value)}
                          placeholder={defaultGb}
                          disabled={grantLoading}
                          className="rounded-xl"
                        />
                      </div>
                    );
                  })()}

                  {/* override длительности подписки в днях.
                      Подсказка показывает дефолт из выбранной опции / тарифа. Пусто  дефолт. */}
                  {(() => {
                    const selectedTariff = flatTariffs.find((tr) => tr.id === selectedGrantTariffId);
                    if (!selectedTariff) return null;
                    const selectedOpt = selectedTariff.priceOptions?.find((o) => o.id === selectedGrantOptionId);
                    const defaultDays = selectedOpt?.durationDays ?? selectedTariff.durationDays ?? 30;
                    return (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">
                          {t("admin.clients.grant_tariff_days", "Длительность (дней)")} —{" "}
                          <span className="text-foreground/70">
                            {t("admin.clients.grant_tariff_days_hint", {
                              defaultValue: "по умолчанию {{days}} дн.; перебивает опцию",
                              days: defaultDays,
                            })}
                          </span>
                        </Label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={3650}
                          step={1}
                          value={grantCustomDays}
                          onChange={(e) => setGrantCustomDays(e.target.value)}
                          placeholder={String(defaultDays)}
                          disabled={grantLoading}
                          className="rounded-xl"
                        />
                      </div>
                    );
                  })()}

                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">{t("admin.clients.grant_tariff_note", "Комментарий (необязательно)")}</Label>
                    <Input
                      value={grantNote}
                      onChange={(e) => setGrantNote(e.target.value)}
                      placeholder={t("admin.clients.grant_tariff_note_ph", "Например: компенсация за простой")}
                      disabled={grantLoading}
                      className="rounded-xl"
                      maxLength={500}
                    />
                  </div>

                  <Button
                    type="button"
                    onClick={handleGrantTariff}
                    disabled={!selectedGrantTariffId || grantLoading}
                    className="gap-1.5 rounded-xl w-full sm:w-auto"
                  >
                    {grantLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                    {t("admin.clients.grant_tariff_button", "Выдать")}
                  </Button>

                  {grantMessage && (
                    <div
                      className={cn(
                        "text-xs rounded-lg px-3 py-2 border",
                        grantMessage.type === "ok"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                      )}
                    >
                      {grantMessage.text}
                    </div>
                  )}
                  </div>
                </details>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <div className="rounded-xl bg-card border border-border px-[17px] py-[15px] space-y-3 text-sm">
                  <div className="text-[11px] font-bold uppercase tracking-[0.9px] text-muted-foreground mb-2">{t("admin.clients.info")}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span>{editing.email || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Telegram</span>
                      <span>{editing.telegramUsername ? `@${editing.telegramUsername}` : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("admin.clients.telegram_id")}</span>
                      <span className="flex items-center gap-1">
                        {editing.telegramId ?? "—"}
                        {editing.telegramId && <CopyButton text={String(editing.telegramId)} />}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("admin.clients.panel_id")}</span>
                      <span className="flex items-center gap-1">
                        <code className="text-xs">{editing.id.slice(0, 12)}…</code>
                        <CopyButton text={editing.id} />
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("admin.clients.ref_code")}</span>
                      <span className="flex items-center gap-1">
                        {editing.referralCode ? <code className="text-xs">{editing.referralCode}</code> : "—"}
                        {editing.referralCode && <CopyButton text={editing.referralCode} />}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("admin.clients.referrals")}</span>
                      <span>{editing._count?.referrals ?? 0}</span>
                    </div>
                    {/* привязка реферера прямо в карточке клиента. */}
                    <div className="sm:col-span-2 mt-1 p-3 rounded-xl border border-border bg-card/40 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Реферер (кто привёл)</span>
                        {referrerInfo ? (
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className="text-foreground font-medium">
                              {referrerInfo.telegramUsername ? `@${referrerInfo.telegramUsername}` : referrerInfo.email || referrerInfo.id.slice(0, 8)}
                            </span>
                            <button
                              type="button"
                              onClick={detachReferrer}
                              disabled={referrerSaving}
                              className="text-red-500 hover:text-red-400 text-[11px] underline disabled:opacity-50"
                            >
                              отвязать
                            </button>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">не привязан</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <select
                          value={referrerLookupBy}
                          onChange={(e) => setReferrerLookupBy(e.target.value as typeof referrerLookupBy)}
                          className="h-9 rounded-lg border border-input bg-background px-2 text-xs shrink-0"
                          disabled={referrerSaving}
                        >
                          <option value="referralCode">Реф. код</option>
                          <option value="username">@username</option>
                          <option value="tgid">TG ID</option>
                          <option value="id">ID клиента</option>
                        </select>
                        <Input
                          value={referrerInput}
                          onChange={(e) => setReferrerInput(e.target.value)}
                          placeholder={referrerLookupBy === "referralCode" ? "Реф. код реферера" : referrerLookupBy === "username" ? "@username" : referrerLookupBy === "tgid" ? "Telegram ID" : "ID клиента"}
                          className="h-9 text-xs"
                          onKeyDown={(e) => { if (e.key === "Enter") attachReferrer(); }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="h-9 shrink-0 rounded-lg"
                          onClick={attachReferrer}
                          disabled={referrerSaving || !referrerInput.trim()}
                        >
                          {referrerSaving ? "…" : "Привязать"}
                        </Button>
                      </div>
                      {referrerMessage && <p className="text-[11px] text-muted-foreground">{referrerMessage}</p>}
                    </div>
                    {remnaUser?.subscriptionUrl && (
                      <div className="flex justify-between sm:col-span-2">
                        <span className="text-muted-foreground flex items-center gap-1"><Link className="h-3 w-3" /> {t("admin.clients.subscription")}</span>
                        <span className="flex items-center gap-1 max-w-[60%]">
                          <code className="text-xs truncate">{remnaUser.subscriptionUrl}</code>
                          <CopyButton text={remnaUser.subscriptionUrl} />
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl bg-card border border-border px-[17px] py-[15px] space-y-3 text-sm">
                  <div className="text-[11px] font-bold uppercase tracking-[0.9px] text-muted-foreground mb-2">
                    Подписки клиента
                  </div>
                  {secondarySubsLoading ? (
                    <div className="text-sm text-muted-foreground">{t("admin.clients.loading_short")}</div>
                  ) : secondarySubs.length === 0 ? (
                    <div className="text-sm text-muted-foreground">У клиента ещё нет подписок</div>
                  ) : (
                    <div className="space-y-2">
                      {secondarySubs.map((s) => {
                        const status =
                          s.giftStatus === "GIFT_RESERVED"
                            ? "Код создан"
                            : s.giftStatus === "GIFTED"
                              ? "Подарена"
                              : "Активна";
                        // relation теперь из ownerId/giftedToClientId
                        // (endpoint /admin/clients/:id/subscriptions включает обе ветки).
                        const relation = s.ownerId === editing.id ? "Владелец" : "Получатель";
                        // помечаем подарочные подписки (purchasedAsGift=true)
                        // в админке отдельным бейджем — чтобы админ сразу видел что это подарок, а не обычная подписка.
                        const isGiftPurchase = s.purchasedAsGift === true;
                        return (
                          <div key={s.id} className={cn(
                            "flex items-center justify-between rounded-xl border px-4 py-3 gap-3 transition-colors",
                            isGiftPurchase
                              ? "border-pink-500/30 bg-pink-500/[0.04] hover:bg-pink-500/[0.08]"
                              : "border-border bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08]"
                          )}>
                            <div className="min-w-0">
                              <div className="text-xs font-medium flex items-center gap-1.5 flex-wrap">
                                <span>
                                  {s.isPrimary ? "Главная" : `#${s.subscriptionIndex}`} · {s.tariffName ?? "Тариф не указан"}
                                </span>
                                {isGiftPurchase && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-pink-500/15 text-pink-400 border border-pink-500/30 px-1.5 py-0.5 text-[10px] font-semibold">
                                    <Gift className="h-2.5 w-2.5" /> Подарочная
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {relation} · {status}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {s.remnawaveUuid && (
                                <span className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={s.remnawaveUuid}>
                                  {s.remnawaveUuid}
                                </span>
                              )}
                              {/* раньше эта кнопка вела на
                                  /admin/secondary-subscriptions?search=<sub.id>, но та страница
                                  (legacy «secondary subs» admin) для unify-схемы возвращала 0
                                  результатов и не имела управления root-подпиской. Теперь
                                  переключаем на вкладку «Подписки» в этом же диалоге — там
                                  per-subscription панель: лимиты, сквады, продление, удаление. */}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setTab("subscriptions")}
                              >
                                Открыть детально
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      value={editForm.email ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value || undefined }))}
                      placeholder="email@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.clients.language")}</Label>
                    <Select
                      value={editForm.preferredLang ?? ""}
                      onChange={(v) => setEditForm((f) => ({ ...f, preferredLang: v }))}
                      options={(() => {
                        const langs = activeLanguages.length ? activeLanguages.map((l) => l.trim()) : ["ru", "en"];
                        const current = (editForm.preferredLang ?? editing.preferredLang ?? "").trim();
                        const set = new Set(langs);
                        if (current && !set.has(current)) set.add(current);
                        return [...set].map((l) => ({ value: l, label: l }));
                      })()}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.clients.currency")}</Label>
                    <Select
                      value={editForm.preferredCurrency ?? ""}
                      onChange={(v) => setEditForm((f) => ({ ...f, preferredCurrency: v }))}
                      options={(() => {
                        const currs = activeCurrencies.length ? activeCurrencies.map((c) => c.trim()) : ["usd", "rub"];
                        const current = (editForm.preferredCurrency ?? editing.preferredCurrency ?? "").trim();
                        const set = new Set(currs);
                        if (current && !set.has(current)) set.add(current);
                        return [...set].map((c) => ({ value: c, label: c.toUpperCase() }));
                      })()}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.clients.balance")}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editForm.balance ?? 0}
                      onChange={(e) => setEditForm((f) => ({ ...f, balance: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.clients.referral_percent")}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={editForm.referralPercent ?? ""}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          referralPercent: e.target.value === "" ? undefined : Number(e.target.value),
                        }))
                      }
                      placeholder={t("admin.clients.referral_default")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      {t("admin.clients.personal_discount")}
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {t("admin.clients.personal_discount_hint")}
                      </span>
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={editForm.personalDiscountPercent ?? ""}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          personalDiscountPercent: e.target.value === "" ? undefined : Number(e.target.value),
                        }))
                      }
                      placeholder={t("admin.clients.personal_discount_placeholder")}
                    />
                    {/* чекбокс одноразовости. */}
                    <label className="flex items-start gap-2 cursor-pointer text-xs text-muted-foreground pt-1">
                      <input
                        type="checkbox"
                        checked={editForm.personalDiscountIsOneTime ?? false}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, personalDiscountIsOneTime: e.target.checked }))
                        }
                        className="mt-0.5 h-3.5 w-3.5 rounded border-border bg-card accent-primary"
                      />
                      <span>
                         Одноразовая — сгорит после первой продуктовой покупки
                        {editing.personalDiscountIsOneTime ? <span className="ml-1 text-amber-400">(сейчас активна)</span> : null}
                      </span>
                    </label>
                  </div>
                </div>

                {actionMessage && <p className="text-sm text-muted-foreground">{actionMessage}</p>}
                <Button 
                  onClick={onSave} 
                  disabled={saving} 
                  className="h-9 px-4 rounded-lg bg-primary hover:bg-primary/90 text-[12.5px] font-semibold w-full sm:w-auto"
                >
                  {saving ? t("admin.clients.saving") : t("admin.clients.save_profile")}
                </Button>

                <div className="rounded-xl border border-destructive/35 bg-destructive/[0.04] px-[17px] py-[15px] mt-1">
                  <div className="text-[11px] font-bold uppercase tracking-[0.9px] text-destructive mb-2.5">Опасная зона</div>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-red-500"
                      checked={editForm.isBlocked ?? false}
                      onChange={(e) => setEditForm((f) => ({ ...f, isBlocked: e.target.checked }))}
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold">{t("admin.clients.is_blocked")}</span>
                      <span className="block text-[11.5px] text-muted-foreground mt-0.5">
                        Клиент не сможет войти в кабинет и пользоваться ботом. Подписка в Remnawave не отключается автоматически.
                      </span>
                    </span>
                  </label>
                  {(editForm.isBlocked ?? editing.isBlocked) && (
                    <div className="space-y-1.5 mt-3">
                      <Label className="text-[12px] font-semibold text-muted-foreground">{t("admin.clients.block_reason")}</Label>
                      <Input
                        value={editForm.blockReason ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, blockReason: e.target.value || undefined }))}
                        placeholder="Причина — видна только админам"
                      />
                    </div>
                  )}
                  <p className="text-[11.5px] text-muted-foreground mt-3">Изменение применится после нажатия «Сохранить профиль».</p>
                </div>

                <hr />
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-2 text-sm">
                    <KeyRound className="h-4 w-4" /> {t("admin.clients.cabinet_password")}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      type="password"
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                      placeholder={t("admin.clients.new_password")}
                      autoComplete="new-password"
                    />
                    <Input
                      type="password"
                      value={passwordForm.confirm}
                      onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))}
                      placeholder={t("admin.clients.repeat_password")}
                      autoComplete="new-password"
                    />
                  </div>
                  {passwordMessage && (
                    <p className={cn("text-sm mt-2", passwordMessage === t("admin.clients.password_set") ? "text-green-600" : "text-destructive")}>
                      {passwordMessage}
                    </p>
                  )}
                  <Button
                    variant="outline" size="sm" className="mt-2 rounded-xl border-border bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] shadow-sm transition-all"
                    onClick={onSetPassword}
                    disabled={savingPassword || !passwordForm.newPassword || passwordForm.newPassword.length < 8}
                  >
                    {savingPassword ? t("admin.clients.saving") : t("admin.clients.set_password")}
                  </Button>
                </div>

                <hr />
                <TariffRestrictionsSection clientId={editing.id} editing={editing} token={token} />
              </div>
            </TabsContent>

            {/*  Подписки (T-subscription-remna, 14.05.2026) 
                Заменили старую вкладку «Remna» (client-scoped). Теперь для каждой
                подписки клиента (primary + secondary) свой блок с собственными
                Данными Remna, Лимитами, Сквадами и Быстрыми действиями. */}
            {(editing.remnawaveUuid || secondarySubs.some((s) => s.remnawaveUuid)) && (
              <TabsContent value="subscriptions">
                <div className="space-y-4">
                  <ClientSubsOverviewBlock clientId={editing.id} token={token} />
                  <ClientSubscriptionsTab
                    clientId={editing.id}
                    token={token}
                    onChanged={() => {
                      loadDevices();
                      loadUsage();
                      loadSecondarySubs();
                    }}
                  />
                </div>
              </TabsContent>
            )}

            {/*  Устройства (T-tabs-rework, 13.05.2026): со ВСЕХ подписок  */}
            {(editing.remnawaveUuid || secondarySubs.some((s) => s.remnawaveUuid)) && (
              <TabsContent value="devices">
                <ClientAllDevicesTab clientId={editing.id} token={token} />
              </TabsContent>
            )}

            {/*  Услуги (T-admin-services, портировано из WolfVPN)  */}
            {canManageServices && (
              <TabsContent value="services">
                <ClientServicesTab clientId={editing.id} token={token} />
              </TabsContent>
            )}

            {/*  Действия  */}
            {(editing.remnawaveUuid || secondarySubs.some((s) => s.remnawaveUuid)) && (
              <TabsContent value="actions">
                <div className="space-y-5">
                  {/* массовые операции — здесь, не сверху диалога. */}
                  <ClientBulkActionsPanel
                    client={editing}
                    token={token}
                    onChanged={() => {
                      loadRemnaUser();
                      loadDevices();
                      loadUsage();
                      loadSecondarySubs();
                    }}
                  />

                  {/* Per-subscription quick actions (Отозвать/Disable/Enable/Reset/Unlink)
                      переехали во вкладку «Подписки» — там для каждой подписки свой набор.
                      Здесь оставлены ТОЛЬКО массовые операции — они в ClientBulkActionsPanel выше. */}
                  {actionMessage && <p className="text-sm text-muted-foreground mt-2">{actionMessage}</p>}

                  {usageData && usageData.sparklineData && usageData.sparklineData.some((v) => v > 0) && (
                    <div className="mt-4">
                      <h3 className="font-semibold text-sm mb-3">{t("admin.clients.traffic_30d_chart")}</h3>
                      <div className="flex items-end gap-px h-24 rounded-[1.5rem] bg-transparent border border-border p-3 overflow-hidden">
                        {(() => {
                          const data = usageData.sparklineData;
                          const max = Math.max(...data, 1);
                          return data.map((v, i) => (
                            <div
                              key={i}
                              className="flex-1 bg-primary/60 hover:bg-primary rounded-t transition-colors min-w-[2px]"
                              style={{ height: `${Math.max((v / max) * 100, v > 0 ? 4 : 1)}%` }}
                              title={`${usageData.categories?.[i] ?? ""}: ${formatTrafficBytes(v)}`}
                            />
                          ));
                        })()}
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-1">
                        <span>{usageData.categories?.[0] ?? ""}</span>
                        <span>{usageData.categories?.[usageData.categories.length - 1] ?? ""}</span>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      className="flex h-9 w-full rounded-xl border border-border bg-foreground/[0.04] dark:bg-white/[0.04] hover:bg-black/30 transition-colors px-3 py-1 text-sm shadow-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// 
// Плашка массовых операций над клиентом.
// Живёт в шапке диалога клиента. Делает: disable/enable, sync push/pull,
// reset-traffic-all, revoke-all, wipe-subscriptions, audit.
// 
function ClientBulkActionsPanel({
  client,
  token,
  onChanged,
}: {
  client: ClientRecord;
  token: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<{ title: string; report: import("@/lib/api").BulkOpReport | null; audit?: import("@/lib/api").ClientAuditResult } | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  // Универсальный wrapper для запуска bulk-операции с UI loading + отчёт.
  const run = useCallback(async (
    key: string,
    title: string,
    fn: () => Promise<import("@/lib/api").BulkOpReport | import("@/lib/api").BulkOpReportFull>,
    options?: { confirm?: string },
  ) => {
    if (options?.confirm && !window.confirm(options.confirm)) return;
    setBusy(key);
    try {
      const r = await fn();
      setLastReport({ title, report: r });
      onChanged();
    } catch (e) {
      setLastReport({ title, report: { ok: 0, skipped: 0, failed: 1, items: [{ subscriptionId: "", subscriptionIndex: -1, remnawaveUuid: null, status: "error", message: e instanceof Error ? e.message : String(e) }] } });
    } finally {
      setBusy(null);
    }
  }, [onChanged]);

  const runAudit = useCallback(async () => {
    setBusy("audit");
    try {
      const r = await api.clientAudit(token, client.id);
      setLastReport({ title: t("admin.clients.bulk_audit", "Аудит БД vs Remnawave"), report: null, audit: r });
      setAuditOpen(true);
    } finally {
      setBusy(null);
    }
  }, [token, client.id, t]);

  const isBlocked = client.isBlocked;

  return (
    <div className="rounded-[1.5rem] border border-border bg-foreground/[0.03] dark:bg-white/[0.03] p-4 mb-4 space-y-3">
      {/* Шапка: статус + основные кнопки */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {isBlocked ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/30 px-2.5 py-1 text-xs text-red-400 font-medium">
              <Ban className="h-3 w-3" /> {t("admin.clients.client_disabled", "Клиент отключён")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-green-500/10 border border-green-500/30 px-2.5 py-1 text-xs text-green-500 dark:text-green-400 font-medium">
              <ShieldCheck className="h-3 w-3" /> {t("admin.clients.client_active", "Клиент активен")}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {t("admin.clients.bulk_panel_hint", "Массовые операции применяются ко всем подпискам клиента")}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {isBlocked ? (
            <Button
              variant="outline" size="sm"
              className="gap-1.5 rounded-xl text-green-700 dark:text-green-400 border-green-500/30 hover:bg-green-500/10"
              disabled={busy != null}
              onClick={() => run("enable", t("admin.clients.bulk_enable_client", "Включение клиента"),
                () => api.clientBulkEnable(token, client.id))}
            >
              {busy === "enable" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {t("admin.clients.bulk_enable_client_btn", "Включить клиента")}
            </Button>
          ) : (
            <Button
              variant="outline" size="sm"
              className="gap-1.5 rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10"
              disabled={busy != null}
              onClick={() => run("disable", t("admin.clients.bulk_disable_client", "Отключение клиента"),
                () => api.clientBulkDisable(token, client.id),
                { confirm: t("admin.clients.bulk_disable_confirm", "Отключить клиента?\nЭто заблокирует его в боте, отключит VPN на ВСЕХ его подписках, и снимет авто-продление.") })}
            >
              {busy === "disable" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              {t("admin.clients.bulk_disable_client_btn", "Отключить клиента")}
            </Button>
          )}
        </div>
      </div>

      {/* Группы массовых операций */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 text-[11px]">
        <Button variant="outline" size="sm" className="gap-1 rounded-lg justify-start" disabled={busy != null}
          onClick={() => run("syncPush", t("admin.clients.bulk_sync_push", "Push БД  Remna"),
            () => api.clientBulkSyncPush(token, client.id))}>
          <RotateCw className="h-3 w-3" /> {t("admin.clients.bulk_sync_push_btn", "Push в Remna")}
        </Button>
        <Button variant="outline" size="sm" className="gap-1 rounded-lg justify-start" disabled={busy != null}
          onClick={() => run("syncPull", t("admin.clients.bulk_sync_pull", "Pull Remna  БД"),
            () => api.clientBulkSyncPull(token, client.id))}>
          <RefreshCw className="h-3 w-3" /> {t("admin.clients.bulk_sync_pull_btn", "Pull из Remna")}
        </Button>
        <Button variant="outline" size="sm" className="gap-1 rounded-lg justify-start" disabled={busy != null}
          onClick={() => run("resetAll", t("admin.clients.bulk_reset_traffic", "Сброс трафика"),
            () => api.clientBulkResetAllTraffic(token, client.id),
            { confirm: t("admin.clients.bulk_reset_traffic_confirm", "Сбросить трафик у всех подписок клиента?") })}>
          <Wifi className="h-3 w-3" /> {t("admin.clients.bulk_reset_all_btn", "Сбросить трафик")}
        </Button>
        <Button variant="outline" size="sm" className="gap-1 rounded-lg justify-start" disabled={busy != null}
          onClick={() => run("revokeAll", t("admin.clients.bulk_revoke", "Revoke URL"),
            () => api.clientBulkRevokeAll(token, client.id),
            { confirm: t("admin.clients.bulk_revoke_confirm", "Перевыпустить subscription URL у всех подписок? Старые ссылки перестанут работать.") })}>
          <Ticket className="h-3 w-3" /> {t("admin.clients.bulk_revoke_btn", "Перевыпустить URL")}
        </Button>
        <Button variant="outline" size="sm" className="gap-1 rounded-lg justify-start" disabled={busy != null}
          onClick={() => run("disableAll", t("admin.clients.bulk_disable_all", "Disable Remna"),
            () => api.clientBulkDisableAll(token, client.id))}>
          <Ban className="h-3 w-3" /> {t("admin.clients.bulk_disable_all_btn", "Disable все в Remna")}
        </Button>
        <Button variant="outline" size="sm" className="gap-1 rounded-lg justify-start" disabled={busy != null}
          onClick={() => run("enableAll", t("admin.clients.bulk_enable_all", "Enable Remna"),
            () => api.clientBulkEnableAll(token, client.id))}>
          <ShieldCheck className="h-3 w-3" /> {t("admin.clients.bulk_enable_all_btn", "Enable все в Remna")}
        </Button>
        <Button variant="outline" size="sm" className="gap-1 rounded-lg justify-start" disabled={busy != null}
          onClick={runAudit}>
          <Search className="h-3 w-3" /> {t("admin.clients.bulk_audit_btn", "Аудит БДRemna")}
        </Button>
        <Button variant="outline" size="sm" className="gap-1 rounded-lg justify-start text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10" disabled={busy != null}
          onClick={() => run("wipe", t("admin.clients.bulk_wipe", "Удаление подписок"),
            () => api.clientBulkWipe(token, client.id),
            { confirm: t("admin.clients.bulk_wipe_confirm", " Удалить ВСЕ подписки клиента из БД и Remnawave?\nКлиент останется (баланс, история).") })}>
          <Trash2 className="h-3 w-3" /> {t("admin.clients.bulk_wipe_btn", "Удалить все подписки")}
        </Button>
      </div>

      {/* Последний отчёт */}
      {lastReport && lastReport.report && (
        <div className="rounded-xl border border-border bg-foreground/[0.04] dark:bg-white/[0.04] p-3 text-[11px] space-y-1.5">
          <div className="flex items-center justify-between font-medium">
            <span>{lastReport.title}</span>
            <button onClick={() => setLastReport(null)} className="text-muted-foreground hover:text-foreground">×</button>
          </div>
          <div className="flex gap-3">
            <span className="text-green-500"> ok: {lastReport.report.ok}</span>
            <span className="text-muted-foreground"> skipped: {lastReport.report.skipped}</span>
            <span className="text-red-400"> failed: {lastReport.report.failed}</span>
          </div>
          {lastReport.report.items.length > 0 && lastReport.report.failed > 0 && (
            <ul className="text-[10px] text-muted-foreground space-y-0.5 max-h-20 overflow-y-auto">
              {lastReport.report.items.filter((i) => i.status === "error").map((i, idx) => (
                <li key={idx} className="text-red-400">
                  #{i.subscriptionIndex}: {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Audit-модалка */}
      {auditOpen && lastReport?.audit && (
        <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t("admin.clients.audit_title", "Аудит БД  Remnawave")}</DialogTitle>
              <DialogDescription>
                {t("admin.clients.audit_description", { defaultValue: "Проверено: {{checked}} из {{total}} подписок. Расхождений: {{issues}}", checked: lastReport.audit.checked, total: lastReport.audit.total, issues: lastReport.audit.issues.length })}
              </DialogDescription>
            </DialogHeader>
            {lastReport.audit.issues.length === 0 ? (
              <div className="text-center py-6 text-green-500">
                <ShieldCheck className="h-10 w-10 mx-auto mb-2" />
                <p className="text-sm">{t("admin.clients.audit_all_clean", "Расхождений не обнаружено")}</p>
              </div>
            ) : (
              <ul className="space-y-2 max-h-96 overflow-y-auto">
                {lastReport.audit.issues.map((issue, idx) => (
                  <li key={idx} className="rounded-xl border border-border p-3 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-amber-400">{issue.type}</span>
                      {issue.subscriptionIndex >= 0 && (
                        <span className="text-muted-foreground">#{issue.subscriptionIndex}</span>
                      )}
                    </div>
                    <div className="text-muted-foreground">{issue.detail}</div>
                  </li>
                ))}
              </ul>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// 
// вкладка «Устройства» — со ВСЕХ подписок.
// Каждое устройство показывается с бейджем подписки (#index + tariff name).
// 
// T-tariff-restriction (портировано из WolfVPN): секция запрета тарифов клиенту в карточке.
function TariffRestrictionsSection({ clientId, editing, token }: { clientId: string; editing: ClientRecord; token: string }) {
  const [tariffs, setTariffs] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.getTariffs(token).then((r) => setTariffs(r.items.map((t) => ({ id: t.id, name: t.name })))).catch(() => setTariffs([])).finally(() => setLoading(false));
    let ids: string[] = [];
    try { if (editing.restrictedTariffIds) { const p = JSON.parse(editing.restrictedTariffIds); if (Array.isArray(p)) ids = p.map(String); } } catch { /* битый JSON */ }
    setSelected(new Set(ids));
    setReason(editing.tariffRestrictionReason ?? "");
  }, [token, editing.restrictedTariffIds, editing.tariffRestrictionReason]);

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function save() {
    setSaving(true); setMsg(null);
    try {
      await api.setClientTariffRestrictions(token, clientId, [...selected], reason.trim() || null);
      setMsg("Сохранено ");
      setTimeout(() => setMsg(null), 2500);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Ошибка"); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Ban className="h-4 w-4 text-amber-500" />
        <h4 className="font-semibold text-sm">Ограничение тарифов</h4>
      </div>
      <p className="text-[11px] text-muted-foreground">Отметь тарифы, которые клиенту ЗАПРЕЩЕНО покупать и продлевать. При попытке оплаты он увидит окно с причиной (на сайте и в боте).</p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Загрузка тарифов…</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tariffs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              className={cn(
                "px-2.5 py-1.5 rounded-xl text-xs border transition-all",
                selected.has(t.id) ? "bg-red-500 text-white border-red-500 shadow" : "bg-card border-border hover:border-border"
              )}
            >
              {selected.has(t.id) ? " " : ""}{t.name}
            </button>
          ))}
          {tariffs.length === 0 && <span className="text-xs text-muted-foreground">Тарифы не найдены</span>}
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Причина (текст в окне у клиента; пусто  общий шаблон)</Label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Напр.: Покупка ограничена в связи с нарушением п. 5.3 оферты."
          className="flex w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 resize-y"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Сохранить
        </Button>
        {selected.size > 0 && <span className="text-[11px] text-red-500 font-medium">запрещено тарифов: {selected.size}</span>}
        {msg && <span className="text-[11px] text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}

// T-admin-services (портировано из WolfVPN): вкладка «Услуги» — выдать/забрать доп. устройства подписке.
function ClientServicesTab({ clientId, token }: { clientId: string; token: string }) {
  const [items, setItems] = useState<import("@/lib/api").ClientServiceItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantSubId, setGrantSubId] = useState("");
  const [grantCount, setGrantCount] = useState(1);
  const [grantPrice, setGrantPrice] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    api.getClientServices(token, clientId)
      .then((r) => setItems(r.items))
      .catch(() => setItems(null))
      .finally(() => setLoading(false));
  }, [token, clientId]);
  useEffect(() => { load(); }, [load]);

  const linkedSubs = (items ?? []).filter((s) => s.linked);

  async function grant() {
    if (!grantSubId || grantCount < 1) { setError("Выберите подписку и количество"); return; }
    setBusy("grant"); setError("");
    try {
      await api.grantClientDevices(token, clientId, { subscriptionId: grantSubId, deviceCount: grantCount, monthlyPrice: Math.max(0, grantPrice) });
      setGrantOpen(false); setGrantCount(1); setGrantPrice(0); setGrantSubId("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выдать услугу");
    } finally { setBusy(null); }
  }

  async function remove(subId: string) {
    if (!confirm("Забрать все доп. устройства этой подписки? Лимит вернётся к базовому тарифу, лишние устройства будут отключены, а цена продления уменьшится.")) return;
    setBusy(subId); setError("");
    try {
      await api.removeClientServiceDevices(token, clientId, subId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось забрать услугу");
    } finally { setBusy(null); }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Загрузка…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Gift className="h-4 w-4" /> Услуги клиента
        </h3>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={load} title="Обновить"><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" className="gap-1.5" onClick={() => { setGrantOpen((v) => !v); setError(""); setGrantSubId(linkedSubs[0]?.subscriptionId ?? ""); }}>
            <Plus className="h-4 w-4" /> Выдать
          </Button>
        </div>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 text-destructive text-sm p-3">{error}</div>}

      {/* Форма выдачи */}
      {grantOpen && (
        <div className="rounded-xl border border-border bg-primary/5 p-4 space-y-3">
          <p className="text-sm font-semibold flex items-center gap-2"><Smartphone className="h-4 w-4" /> Выдать доп. устройства</p>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">На какую подписку</Label>
            <select
              value={grantSubId}
              onChange={(e) => setGrantSubId(e.target.value)}
              className="w-full h-10 rounded-xl border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {linkedSubs.length === 0 && <option value="">Нет подписок с VPN</option>}
              {linkedSubs.map((s) => (
                <option key={s.subscriptionId} value={s.subscriptionId}>
                  {s.subscriptionIndex === 0 ? "Главная" : `#${s.subscriptionIndex}`}{s.tariffName ? ` — ${s.tariffName}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Кол-во устройств</Label>
              <Input type="number" min={1} max={50} value={grantCount} onChange={(e) => setGrantCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="h-10 rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Цена ₽/мес</Label>
              <Input type="number" min={0} value={grantPrice} onChange={(e) => setGrantPrice(Math.max(0, Number(e.target.value) || 0))} className="h-10 rounded-xl" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
             Цена/мес войдёт в стоимость продления подписки (как при покупке клиентом). Поставьте 0 — устройства выдадутся бесплатно и не добавят к цене продления.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={grant} disabled={busy === "grant" || !grantSubId} className="gap-1.5">
              {busy === "grant" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Выдать
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setGrantOpen(false)}>Отмена</Button>
          </div>
        </div>
      )}

      {/* Список подписок и услуг */}
      <div className="space-y-3">
        {(items ?? []).map((s) => {
          const totalMax = s.includedDevices + s.extraDevices;
          const hasExtras = s.extraDevices > 0;
          return (
            <div key={s.subscriptionId} className="rounded-[1.5rem] border border-border bg-foreground/[0.02] p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className={cn("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold border", s.subscriptionIndex === 0 ? "bg-primary/10 text-primary border-border" : "bg-muted text-muted-foreground border-border")}>
                  {s.tariffEmoji && <span>{s.tariffEmoji}</span>}
                  {s.subscriptionIndex === 0 ? "Главная" : `#${s.subscriptionIndex}`}
                </span>
                {s.tariffName && <span className="text-muted-foreground">{s.tariffName}</span>}
                {!s.linked && <span className="ml-auto text-[10px] text-amber-500">не привязана к VPN</span>}
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm">
                  <span className="text-muted-foreground">Лимит устройств: </span>
                  <span className="font-semibold">{totalMax}</span>
                  <span className="text-[11px] text-muted-foreground"> ({s.includedDevices} базовых{hasExtras ? ` + ${s.extraDevices} доп.` : ""})</span>
                </div>
                {hasExtras ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                      доп. услуга: +{s.extraDevices} устр · {s.extraDevicesMonthlyPrice.toLocaleString("ru-RU")} ₽/мес
                    </span>
                    <Button size="sm" variant="ghost" className="text-destructive gap-1.5" disabled={busy === s.subscriptionId} onClick={() => remove(s.subscriptionId)}>
                      {busy === s.subscriptionId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Забрать
                    </Button>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Доп. услуг нет</span>
                )}
              </div>
            </div>
          );
        })}
        {(items ?? []).length === 0 && (
          <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
            <Gift className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">У клиента нет подписок</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ClientAllDevicesTab({ clientId, token }: { clientId: string; token: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<import("@/lib/api").ClientAllDevicesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getClientAllDevices(token, clientId)
      .then((r) => setData(r))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [token, clientId]);

  useEffect(() => { load(); }, [load]);

  const deleteDevice = async (subId: string, uuid: string | null, hwid: string) => {
    if (!uuid) return;
    if (!confirm(t("admin.clients.delete_device_confirm"))) return;
    try {
      // Используем эндпоинт по subId если будет в будущем; пока — через clientId (proxy на primary)
      // если устройство с primary; иначе — через прямой Remna-uuid (надо отдельный endpoint).
      // Для минимального решения — оставляем через clientId — работает для primary subscription.
      await api.deleteClientRemnaDevice(token, clientId, hwid);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : t("admin.clients.delete_error"));
    }
    // marker: subId/uuid сейчас не используются — оставлены для будущего per-sub эндпоинта.
    void subId; void uuid;
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("admin.clients.loading_short")}</p>;
  }
  if (!data || data.total === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            {t("admin.clients.hwid_devices", "HWID устройства")} (0)
          </h3>
          <Button variant="ghost" size="sm" onClick={load} title={t("admin.clients.refresh_data", "Обновить")}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          <Smartphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">{t("admin.clients.no_registered_devices")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Smartphone className="h-4 w-4" />
          {t("admin.clients.hwid_devices", "HWID устройства")} ({data.total})
          <span className="text-muted-foreground font-normal text-[11px]">{t("admin.clients.from_all_subs", "со всех подписок клиента")}</span>
        </h3>
        <Button variant="ghost" size="sm" onClick={load} title={t("admin.clients.refresh_data", "Обновить")}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        {data.groups.filter((g) => g.devices.length > 0 || g.remnawaveUuid).map((g) => {
          const isPrimary = g.subscriptionIndex === 0;
          const subBadgeLabel = isPrimary ? t("admin.clients.sub_primary", "Главная") : `#${g.subscriptionIndex}`;
          return (
            <div key={g.subscriptionId} className="rounded-[1.5rem] border border-border bg-foreground/[0.02] p-4 space-y-2.5">
              {/* Заголовок группы подписки */}
              <div className="flex items-center gap-2 text-xs">
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold border",
                  isPrimary
                    ? "bg-primary/10 text-primary border-border"
                    : "bg-muted text-muted-foreground border-border"
                )}>
                  {g.tariffEmoji && <span>{g.tariffEmoji}</span>}
                  {subBadgeLabel}
                </span>
                {g.tariffName && <span className="text-muted-foreground">{g.tariffName}</span>}
                <span className="ml-auto text-muted-foreground">
                  {g.devices.length}{g.deviceLimit != null ? ` / ${g.deviceLimit}` : ""}
                </span>
              </div>

              {g.devices.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-3">
                  {t("admin.clients.no_devices_for_sub", "Нет устройств на этой подписке")}
                </p>
              ) : (
                <div className="space-y-2">
                  {g.devices.map((d) => (
                    <div key={d.id || d.hwid} className="flex items-center justify-between rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.03] p-3 gap-3 hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06] transition-colors">
                      <div className="min-w-0 space-y-0.5 flex-1">
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
                          <code className="text-xs truncate">{d.hwid}</code>
                          <CopyButton text={d.hwid} />
                        </div>
                        <div className="text-[11px] text-muted-foreground pl-6">
                          {d.platform && <span>{t("admin.clients.platform", "Платформа:")} {d.platform}</span>}
                          {d.createdAt && <span> &middot; {fmtMsk(d.createdAt)}</span>}
                        </div>
                        {d.userAgent && (
                          <div className="text-[10px] text-muted-foreground pl-6 truncate max-w-md" title={d.userAgent}>
                            {d.userAgent}
                          </div>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" className="text-destructive shrink-0"
                        onClick={() => deleteDevice(g.subscriptionId, g.remnawaveUuid, d.hwid)}
                        title={t("admin.clients.delete_device", "Удалить устройство")}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 
// сводка по всем подпискам клиента.
// Показывает компактную таблицу — для каждой подписки строка с remna-метриками.
// 
function ClientSubsOverviewBlock({ clientId, token }: { clientId: string; token: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<import("@/lib/api").ClientSubsOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // ручное продление конкретной подписки (компенсация/бонус).
  const [extendFor, setExtendFor] = useState<{ subId: string; label: string } | null>(null);
  const [extendDays, setExtendDays] = useState<number>(30);
  const [extendNote, setExtendNote] = useState("");
  const [extendBusy, setExtendBusy] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [extendDone, setExtendDone] = useState<string | null>(null);
  // привязка существующего Remna-юзера как подписки клиента.
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachQuery, setAttachQuery] = useState("");
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getClientSubsOverview(token, clientId)
      .then((r) => setData(r))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [token, clientId]);

  useEffect(() => { load(); }, [load]);

  async function grantExtend() {
    if (!extendFor || extendDays < 1) return;
    setExtendBusy(true);
    setExtendError(null);
    try {
      const r = await api.adminGrantExtendSubscription(token, extendFor.subId, {
        customDurationDays: extendDays,
        note: extendNote.trim() || undefined,
      });
      setExtendDone(`Подписка продлена на ${r.tariff.durationDays} дн. (${r.tariff.name})`);
      setExtendFor(null);
      setExtendNote("");
      load();
      setTimeout(() => setExtendDone(null), 4000);
    } catch (e) {
      setExtendError(e instanceof Error ? e.message : "Ошибка продления");
    } finally {
      setExtendBusy(false);
    }
  }

  async function attachRemna() {
    if (!attachQuery.trim()) return;
    setAttachBusy(true);
    setAttachError(null);
    try {
      const r = await api.adminAttachRemnaSubscription(token, clientId, { query: attachQuery.trim() });
      setExtendDone(`Remna-юзер привязан как подписка #${r.subscriptionIndex}`);
      setAttachOpen(false);
      setAttachQuery("");
      load();
      setTimeout(() => setExtendDone(null), 4000);
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : "Ошибка привязки");
    } finally {
      setAttachBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t("admin.clients.loading_short", "Загрузка…")}</p>;
  if (!data || data.items.length === 0) return null;

  const totalTrafficUsed = data.items.reduce((acc, it) => acc + (it.remna?.trafficUsedBytes ?? 0), 0);
  const totalDevices = data.items.reduce((acc, it) => acc + (it.remna?.deviceCount ?? 0), 0);
  const activeCount = data.items.filter((it) => it.remna?.status === "ACTIVE").length;

  return (
    <div className="rounded-[1.5rem] border border-border bg-card p-5 space-y-4">
      {/* Шапка со сводными цифрами */}
      <div className="flex flex-wrap items-center gap-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Package className="h-4 w-4" />
          {t("admin.clients.subs_overview", "Подписки клиента")} ({data.items.length})
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px]">
          <span className="text-green-500"> ACTIVE: {activeCount}</span>
          <span className="text-muted-foreground"> Devices: {totalDevices}</span>
          <span className="text-muted-foreground"> Traffic: {formatTrafficBytes(totalTrafficUsed)}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 gap-1 text-[10px]"
            title="Привязать существующего Remna-юзера как подписку клиента"
            onClick={() => { setAttachOpen(true); setAttachError(null); }}
          >
            <Link className="h-3 w-3" />
            Привязать Remna
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={load}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Таблица подписок */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-2 pr-2 font-medium">#</th>
              <th className="text-left py-2 pr-2 font-medium">{t("admin.clients.tariff", "Тариф")}</th>
              <th className="text-left py-2 pr-2 font-medium">{t("admin.clients.status", "Статус")}</th>
              <th className="text-left py-2 pr-2 font-medium">{t("admin.clients.expires", "Истекает")}</th>
              <th className="text-right py-2 pr-2 font-medium">{t("admin.clients.traffic", "Трафик")}</th>
              <th className="text-right py-2 pr-2 font-medium">{t("admin.clients.devices", "HWID")}</th>
              <th className="text-right py-2 pr-2 font-medium">Squads</th>
              <th className="text-right py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => {
              const isPrimary = it.subscriptionIndex === 0;
              const expiresSoon = it.remna?.expireAt
                ? new Date(it.remna.expireAt).getTime() - Date.now() < 3 * 86_400_000
                : false;
              const isExpired = it.remna?.expireAt
                ? new Date(it.remna.expireAt).getTime() <= Date.now()
                : false;
              return (
                <tr key={it.subscriptionId} className="border-b border-border hover:bg-white/[0.03] transition-colors">
                  <td className="py-2 pr-2">
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border",
                      isPrimary ? "bg-primary/10 text-primary border-border" : "bg-muted text-muted-foreground border-border"
                    )}>
                      {isPrimary ? t("admin.clients.sub_primary", "Главная") : `#${it.subscriptionIndex}`}
                    </span>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-1">
                      {it.tariffEmoji && <span>{it.tariffEmoji}</span>}
                      <span>{it.tariffName ?? (it.isTrial ? (it.trialName ?? "Trial") : "—")}</span>
                      {it.isTrial && <span className="text-[9px] text-amber-400">trial</span>}
                      {it.purchasedAsGift && <Gift className="h-3 w-3 text-pink-400" />}
                      {it.autoRenewEnabled && <RotateCw className="h-3 w-3 text-blue-400" />}
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    {it.remna ? (
                      <span className={cn(
                        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] border",
                        it.remna.status === "ACTIVE" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                        it.remna.status === "DISABLED" && "bg-red-500/10 text-red-400 border-red-500/30",
                        it.remna.status === "LIMITED" && "bg-amber-500/10 text-amber-400 border-amber-500/30",
                        it.remna.status === "EXPIRED" && "bg-gray-500/10 text-gray-400 border-gray-500/30",
                      )}>
                        {it.remna.status ?? "—"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t("admin.clients.no_remna", "нет Remna")}</span>
                    )}
                  </td>
                  <td className={cn(
                    "py-2 pr-2",
                    isExpired ? "text-red-400" : expiresSoon ? "text-amber-400" : "text-muted-foreground"
                  )}>
                    {it.remna?.expireAt
                      ? fmtMskDate(it.remna.expireAt)
                      : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {it.remna ? (
                      <span>
                        {formatTrafficBytes(it.remna.trafficUsedBytes ?? 0)}
                        {it.remna.trafficLimitBytes && it.remna.trafficLimitBytes > 0 ? (
                          <span className="text-muted-foreground"> / {formatTrafficBytes(it.remna.trafficLimitBytes)}</span>
                        ) : (
                          <span className="text-muted-foreground"> / ∞</span>
                        )}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {it.remna ? `${it.remna.deviceCount} / ${it.remna.hwidDeviceLimit ?? "∞"}` : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {it.remna?.activeSquadsCount ?? 0}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 gap-1 text-[10px] text-primary hover:bg-primary/10"
                      title="Продлить подписку вручную (компенсация/бонус)"
                      onClick={() => {
                        setExtendFor({
                          subId: it.subscriptionId,
                          label: `${isPrimary ? "Главная" : `#${it.subscriptionIndex}`}${it.tariffName ? ` — ${it.tariffName}` : ""}`,
                        });
                        setExtendDays(30);
                        setExtendError(null);
                      }}
                    >
                      <Zap className="h-3 w-3" />
                      Продлить
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {extendDone && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500 font-medium">
           {extendDone}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground italic">
        {t("admin.clients.overview_hint", "Ниже — детали и настройки главной подписки. Управление конкретной подпиской — в карточке подписки.")}
      </div>

      {/* привязка существующего Remna-юзера */}
      <Dialog open={attachOpen} onOpenChange={(o) => { if (!o && !attachBusy) setAttachOpen(false); }}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px] font-bold">
              Привязать Remna-юзера
            </DialogTitle>
            <DialogDescription className="text-xs">
              Подписка клиента на уже существующего юзера панели Remnawave — новый юзер не создаётся.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Username или UUID Remna-юзера</Label>
              <Input
                value={attachQuery}
                onChange={(e) => setAttachQuery(e.target.value)}
                placeholder="например: alice_1 или 6f3c…-uuid"
                className="rounded-xl font-mono"
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Срок подписки подтянется из Remna, TG/email клиента привяжутся к Remna-юзеру.
              Один Remna-юзер можно привязать только к одной подписке.
            </p>
            {attachError && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive font-medium">
                {attachError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setAttachOpen(false)} disabled={attachBusy}>Отмена</Button>
              <Button size="sm" onClick={attachRemna} disabled={attachBusy || !attachQuery.trim()} className="gap-1.5 rounded-xl">
                {attachBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link className="h-4 w-4" />}
                Привязать
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* мини-диалог ручного продления подписки */}
      <Dialog open={!!extendFor} onOpenChange={(o) => { if (!o && !extendBusy) setExtendFor(null); }}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px] font-bold">
              Продлить подписку
            </DialogTitle>
            <DialogDescription className="text-xs">{extendFor?.label}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Срок продления (дней)</Label>
              <div className="flex gap-2">
                {[7, 30, 90, 365].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setExtendDays(d)}
                    className={cn(
                      "flex-1 rounded-xl border px-2 py-2 text-xs font-bold transition-all",
                      extendDays === d
                        ? "border-border bg-primary/10 text-primary"
                        : "border-border bg-white/[0.03] text-muted-foreground hover:border-border",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <Input
                type="number"
                min={1}
                max={3650}
                value={extendDays}
                onChange={(e) => setExtendDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Заметка (видна только админам)</Label>
              <Input
                value={extendNote}
                onChange={(e) => setExtendNote(e.target.value)}
                placeholder="Например: компенсация за простой"
                className="rounded-xl"
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Продление по тарифу подписки, бесплатно (admin grant): дни добавятся к текущему сроку,
              доп. устройства сохранятся, клиент получит уведомление в Telegram.
            </p>
            {extendError && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive font-medium">
                {extendError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setExtendFor(null)} disabled={extendBusy}>Отмена</Button>
              <Button size="sm" onClick={grantExtend} disabled={extendBusy || extendDays < 1} className="gap-1.5 rounded-xl">
                {extendBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Продлить на {extendDays} дн.
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
