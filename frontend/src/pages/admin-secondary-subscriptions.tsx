import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { motion } from "framer-motion";
import {
  api,
  type AdminSecondarySubscriptionFilters,
  type AdminSecondarySubscriptionsResponse,
  type AdminSecondarySubscriptionDetail,
  type TariffRecord,
  type ClientRecord,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fmtMsk, fmtMskShort, fmtMskDate } from "@/lib/datetime";
import {
  Search,
  RefreshCw,
  Eye,
  Trash2,
  Gift,
  ShoppingCart,
  CheckCircle2,
  Mail,
  Send,
  XCircle,
  Clock,
  Trash,
  Copy,
  Check,
  User,
  Activity,
  Plus,
  Loader2,
  Pencil,
} from "lucide-react";

/**
 * бейдж статуса подписки в админке.
 * Учитывает purchasedAsGift и subscriptionIndex для корректной семантики:
 *  - index=0 + giftStatus=null  «Главная» (primary, купил себе или выдан админом)
 *  - index>0 + giftStatus=null + purchasedAsGift=false  «Своя» (доп. куплена клиентом)
 *  - index>0 + giftStatus=null + purchasedAsGift=true  «Готова к подарку» (код ещё не создан)
 *  - GIFT_RESERVED / GIFT_CODE_ACTIVE  «Код активен» (ожидает redeem)
 *  - GIFTED  «Подарена» (получатель активировал)
 *  - ACTIVATED_SELF  «Забрана себе» (отмена подарка)
 */
function giftStatusBadge(
  status: string | null,
  purchasedAsGift?: boolean,
  subscriptionIndex?: number,
): { label: string; className: string } {
  // Активный подарочный цикл — приоритет над «своими».
  switch (status) {
    case "GIFT_RESERVED":
    case "GIFT_CODE_ACTIVE":
      return { label: "Код активен", className: "bg-amber-500/15 text-amber-400 border border-amber-500/20 shadow-sm" };
    case "GIFTED":
      return { label: "Подарена", className: "bg-purple-500/15 text-purple-400 border border-purple-500/20 shadow-sm" };
    case "ACTIVATED_SELF":
      return { label: "Забрана себе", className: "bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/20 shadow-sm" };
  }
  // null / "" — обычная подписка, дальше различаем по purchasedAsGift и index.
  if (purchasedAsGift === true) {
    return { label: "Готова к подарку", className: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 shadow-sm" };
  }
  if (subscriptionIndex === 0) {
    return { label: "Главная", className: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm" };
  }
  // index > 0 + purchasedAsGift=false  купленная себе доп. подписка.
  return { label: "Своя", className: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm" };
}

const EVENT_LABELS: Record<string, { icon: React.ReactNode; label: string }> = {
  PURCHASED: { icon: <ShoppingCart className="h-4 w-4" />, label: "Подписка куплена" },
  ACTIVATED_SELF: { icon: <CheckCircle2 className="h-4 w-4" />, label: "Добавлена в профиль" },
  CODE_CREATED: { icon: <Gift className="h-4 w-4" />, label: "Код создан" },
  GIFT_SENT: { icon: <Send className="h-4 w-4" />, label: "Подарок отправлен" },
  GIFT_RECEIVED: { icon: <Mail className="h-4 w-4" />, label: "Подарок получен" },
  CODE_CANCELLED: { icon: <XCircle className="h-4 w-4" />, label: "Код отменен" },
  CODE_EXPIRED: { icon: <Clock className="h-4 w-4" />, label: "Код истек" },
  DELETED: { icon: <Trash className="h-4 w-4" />, label: "Удалена" },
};

export function AdminSecondarySubscriptionsPage() {
  const { state } = useAuth();
  const token = state.accessToken!;
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get("search")?.trim() ?? "";
  
  const [data, setData] = useState<AdminSecondarySubscriptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [filters, setFilters] = useState<AdminSecondarySubscriptionFilters>({
    page: 1,
    limit: 20,
    search: initialSearch || undefined,
  });
  
  const [searchInput, setSearchInput] = useState(initialSearch);

  // live-search с debounce 300мс. Раньше фильтрация шла только
  // по Enter / клику «Найти», и пользователи думали что поиск не работает (вводили
  // username, видели полный список 51k subs, считали что поиск сломан).
  useEffect(() => {
    const handle = setTimeout(() => {
      const next = searchInput.trim();
      setFilters((prev) => {
        if ((prev.search ?? "") === next) return prev;
        return { ...prev, search: next || undefined, page: 1 };
      });
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (next) p.set("search", next);
        else p.delete("search");
        return p;
      });
    }, 300);
    return () => clearTimeout(handle);
    // setSearchParams identity is stable; не включаем в deps чтобы не дёргать лишний раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<AdminSecondarySubscriptionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  //  Edit Subscription Dialog State 
  // Меняем количество дней (+/−) и/или лимит трафика (ГБ, пусто = безлимит).
  const [editOpen, setEditOpen] = useState(false);
  const [editAddDays, setEditAddDays] = useState<string>("");
  const [editTrafficGb, setEditTrafficGb] = useState<string>("");
  const [editTrafficUnlimited, setEditTrafficUnlimited] = useState<boolean>(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  //  Create Gift Code Dialog State 
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createClientSearch, setCreateClientSearch] = useState("");
  const [createClients, setCreateClients] = useState<ClientRecord[]>([]);
  const [createClientsLoading, setCreateClientsLoading] = useState(false);
  const [createSelectedClient, setCreateSelectedClient] = useState<ClientRecord | null>(null);
  const [createTariffs, setCreateTariffs] = useState<TariffRecord[]>([]);
  const [createSelectedTariff, setCreateSelectedTariff] = useState<string>("");
  const [createMessage, setCreateMessage] = useState("");
  const [createResult, setCreateResult] = useState<{ code: string; expiresAt: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // срок/трафик override + режим уведомления + ссылка для пересылки.
  const [createDurationDays, setCreateDurationDays] = useState<string>("");
  const [createTrafficGb, setCreateTrafficGb] = useState<string>("");
  const [createNotify, setCreateNotify] = useState<boolean>(true);
  const [createGiftUrl, setCreateGiftUrl] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await api.getSecondarySubscriptions(token, filters);
      setData(res);
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Failed to fetch secondary subscriptions", err);
    } finally {
      setLoading(false);
    }
  }, [token, filters]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleSearch = () => {
    const nextSearch = searchInput.trim();
    setFilters((prev) => ({ ...prev, search: nextSearch || undefined, page: 1 }));
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (nextSearch) p.set("search", nextSearch);
      else p.delete("search");
      return p;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleFilterChange = <K extends keyof AdminSecondarySubscriptionFilters>(key: K, value: AdminSecondarySubscriptionFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const handleResetFilters = () => {
    setSearchInput("");
    setFilters({ page: 1, limit: 20 });
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete("search");
      return p;
    });
  };

  const toggleSelectAll = () => {
    if (!data) return;
    if (selectedIds.size === data.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.items.map((item) => item.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleDeleteSelected = async () => {
    if (!token) return;
    if (!confirm(`Удалить ${selectedIds.size} подписок? Это действие нельзя отменить.`)) return;
    
    try {
      await api.deleteSecondarySubscriptionsBulk(token, Array.from(selectedIds));
      await fetchItems();
    } catch (err) {
      console.error("Failed to bulk delete", err);
      alert("Ошибка при удалении");
    }
  };

  const handleDeleteSingle = async (id: string) => {
    if (!token) return;
    if (!confirm("Удалить эту подписку?")) return;
    try {
      await api.deleteSecondarySubscription(token, id);
      await fetchItems();
    } catch (err) {
      console.error("Failed to delete", err);
      alert("Ошибка при удалении");
    }
  };

  const openDetail = async (id: string) => {
    setDetailId(id);
    if (!token) return;
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res = await api.getSecondarySubscription(token, id);
      setDetailData(res);
    } catch (err) {
      console.error("Failed to fetch detail", err);
    } finally {
      setDetailLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  //  Create Gift Code Handlers 

  const openCreateDialog = async (notify: boolean = true) => {
    setCreateOpen(true);
    setCreateSelectedClient(null);
    setCreateSelectedTariff("");
    setCreateMessage("");
    setCreateResult(null);
    setCreateError(null);
    setCreateClientSearch("");
    setCreateClients([]);
    setCreateDurationDays("");
    setCreateTrafficGb("");
    setCreateNotify(notify);
    setCreateGiftUrl(null);

    // Load tariffs
    try {
      const res = await api.getTariffs(token);
      setCreateTariffs(res.items);
    } catch {
      setCreateTariffs([]);
    }
  };

  const searchClients = async () => {
    if (!createClientSearch.trim()) return;
    setCreateClientsLoading(true);
    try {
      const res = await api.getClients(token, 1, 10, { search: createClientSearch.trim() });
      setCreateClients(res.items);
    } catch {
      setCreateClients([]);
    } finally {
      setCreateClientsLoading(false);
    }
  };

  const handleCreateSubmit = async () => {
    if (!createSelectedClient || !createSelectedTariff) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const durationDaysNum = createDurationDays.trim() ? Math.floor(Number(createDurationDays.trim())) : undefined;
      const trafficGbRaw = createTrafficGb.trim();
      const trafficGbNum = trafficGbRaw !== "" ? Number(trafficGbRaw) : undefined;
      const result = await api.adminCreateGiftCode(token, {
        clientId: createSelectedClient.id,
        tariffId: createSelectedTariff,
        giftMessage: createMessage.trim() || undefined,
        durationDays: durationDaysNum != null && durationDaysNum > 0 ? durationDaysNum : undefined,
        trafficGb: trafficGbNum != null && !Number.isNaN(trafficGbNum) && trafficGbNum >= 0 ? trafficGbNum : undefined,
        notify: createNotify,
      });
      setCreateResult({ code: result.code, expiresAt: result.expiresAt });
      setCreateGiftUrl(result.giftUrl ?? null);
      fetchItems(); // refresh list
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Ошибка создания подарочного кода");
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 relative z-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
              Подписки
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-sm font-medium">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-border px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                <Gift className="h-3 w-3" />
                Всего: <span className="tabular-nums">{data?.total || 0}</span>
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

        <div className="relative z-10 flex flex-col sm:flex-row gap-2">
          <Button
            onClick={() => openCreateDialog(true)}
            className="h-9 px-[13px] rounded-lg gap-2 bg-primary text-primary-foreground text-[12.5px] font-semibold"
          >
            <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
            Создать подарок
          </Button>
          <Button
            onClick={() => openCreateDialog(false)}
            variant="secondary"
            className="h-9 px-[13px] rounded-lg gap-2 text-[12.5px] font-semibold border border-border bg-card hover:bg-muted"
          >
            <Gift className="h-4 w-4" />
            Выдать код
          </Button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="bg-card border border-border rounded-xl px-[17px] py-[15px]">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.9px] text-muted-foreground mb-3">Фильтры</h2>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label className="text-xs">Поиск (Email / Telegram / подарочный код / отправитель)</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Email, @username, TG ID, код подарка (XXXX-XXXX-XXXX)..."
                  className="pl-9 bg-card border-border hover:border-border focus:border-border rounded-xl h-9 transition-colors"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
            </div>
            
            <div className="w-full sm:w-64 space-y-2">
              <Label className="text-xs">Статус</Label>
              <div className="relative">
                <select
                  className="flex h-9 w-full rounded-xl border border-border bg-card hover:border-border focus:border-border px-3 py-1 text-sm shadow-sm text-foreground focus:outline-none transition-colors appearance-none"
                  value={filters.giftStatus || ""}
                  onChange={(e) => handleFilterChange("giftStatus", e.target.value || undefined)}
                >
                  <option value="" className="bg-background text-foreground">Все</option>
                  <option value="null" className="bg-background text-foreground">Доступна</option>
                  <option value="ACTIVATED_SELF" className="bg-background text-foreground">Своя</option>
                  <option value="GIFT_RESERVED" className="bg-background text-foreground">Резерв</option>
                  <option value="GIFT_CODE_ACTIVE" className="bg-background text-foreground">Код активен</option>
                  <option value="GIFTED" className="bg-background text-foreground">Подарена</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={handleSearch} className="h-9 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border border-border transition-colors px-5">
                <Search className="mr-2 h-4 w-4" />
                Найти
              </Button>
              <Button variant="ghost" onClick={handleResetFilters} className="h-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] dark:hover:bg-card">
                Сброс
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-card border border-border rounded-2xl overflow-hidden relative"
      >
        <div className="flex items-center justify-between p-4 border-b border-border bg-card relative z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 flex items-center gap-2">
              <Gift className="w-4 h-4 text-primary" />
              Список подписок
            </h2>
            {selectedIds.size > 0 && (
              <Button variant="destructive" size="sm" onClick={handleDeleteSelected} className="rounded-xl h-8 px-3 shadow-destructive/20 border border-destructive/30">
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Удалить ({selectedIds.size})
              </Button>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={fetchItems} disabled={loading} className="h-8 w-8 rounded-full hover:bg-foreground/[0.06] dark:hover:bg-card">
            <RefreshCw className={cn("h-4 w-4 text-muted-foreground transition-transform", loading && "animate-[spin_1.5s_linear_infinite] text-primary")} />
          </Button>
        </div>

        <div className="overflow-x-auto relative z-10 min-h-[200px]">
          <table className="w-full text-sm text-left">
            <thead className="bg-foreground/[0.04] dark:bg-white/[0.04] border-b border-border">
              <tr>
                <th className="px-5 py-4 w-12 text-center">
                  <Checkbox
                    className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    checked={data?.items.length ? selectedIds.size === data.items.length : false}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">ID</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Владелец</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Тариф</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Статус</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Отправитель</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Код</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="relative">
                        <div className="absolute inset-0 rounded-full blur-[10px] bg-primary/30 animate-pulse" />
                        <Loader2 className="h-8 w-8 animate-spin text-primary relative z-10" />
                      </div>
                      <span className="text-sm font-medium text-muted-foreground">Загрузка данных...</span>
                    </div>
                  </td>
                </tr>
              ) : data?.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <span className="text-sm font-medium text-foreground/70">Подписок не найдено</span>
                      <span className="text-xs text-muted-foreground">Попробуйте изменить параметры поиска</span>
                    </div>
                  </td>
                </tr>
              ) : (
                data?.items.map((item, idx) => {
                  const badge = giftStatusBadge(item.giftStatus, item.purchasedAsGift, item.subscriptionIndex);
                  const ownerName = item.owner.telegramUsername ? `@${item.owner.telegramUsername}` : item.owner.email || item.owner.telegramId;
                  // «Отправитель» = создатель gift code (giftSender),
                  // а не получатель. Если код создан админом — показываем  + email админа.
                  const sender = (item as { giftSender?: { telegramUsername?: string | null; email?: string | null; isAdmin?: boolean } | null }).giftSender;
                  const giftedName = sender?.isAdmin
                    ? ` ${sender.email ?? "Администратор"}`
                    : sender?.telegramUsername
                      ? `@${sender.telegramUsername}`
                      : sender?.email || "—";
                  const isSelected = selectedIds.has(item.id);
                  
                  return (
                    <motion.tr 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.02 }}
                      key={item.id} 
                      className={cn(
                        "transition-all duration-200 group cursor-pointer border-l-[3px] border-l-transparent",
                        isSelected 
                          ? "bg-primary/10 border-l-primary/50 hover:bg-primary/15" 
                          : "hover:bg-foreground/[0.05] dark:hover:bg-card hover:border-l-primary/30"
                      )}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button') || target.closest('[data-row-checkbox-zone]')) return;
                        openDetail(item.id);
                      }}
                    >
                      <td
                        data-row-checkbox-zone
                        className="px-5 py-4 text-center relative z-10 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          if ((e.target as HTMLElement).closest('[role="checkbox"]')) return;
                          toggleSelect(item.id);
                        }}
                      >
                        <Checkbox
                          className={cn("border-border transition-all", isSelected && "border-primary bg-primary text-primary-foreground")}
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(item.id)}
                        />
                      </td>
                      <td className="px-5 py-4 font-mono text-[11px] text-muted-foreground/70 group-hover:text-primary/70 transition-colors">
                        {item.id.substring(0, 8)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="text-sm font-medium text-foreground/90">{ownerName}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">#{item.subscriptionIndex}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-sm font-medium text-foreground/80">{item.tariff?.name || "—"}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{fmtMskDate(item.createdAt)}</div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase", badge.className)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn("text-sm transition-colors", giftedName !== "—" ? "text-foreground/80" : "text-muted-foreground/50")}>
                          {giftedName}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {item.latestGiftCode ? (
                          <div className="flex items-center gap-2 group/code">
                            <span className="font-mono text-xs bg-black/30 text-primary/90 px-2 py-1 rounded-md border border-border tracking-wider">
                              {item.latestGiftCode.code}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(item.latestGiftCode!.code); }}
                              className="w-7 h-7 rounded-md bg-foreground/[0.04] dark:bg-card hover:bg-primary/15 hover:text-primary border border-border hover:border-border flex items-center justify-center transition-all opacity-0 group-hover/code:opacity-100 shadow-sm"
                            >
                              {copiedCode === item.latestGiftCode.code ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-5 py-4 text-right relative z-10">
                        {/* кнопки «глаз» и «удалить» теперь видны
                            всегда, а не только при hover. Раньше пользователи думали что
                            кнопки удаления нет. */}
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl bg-foreground/[0.04] dark:bg-card hover:bg-blue-500/15 hover:text-blue-400 border border-border hover:border-blue-500/30 transition-all shadow-sm" onClick={(e) => { e.stopPropagation(); openDetail(item.id); }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl bg-foreground/[0.04] dark:bg-card hover:bg-destructive/15 text-muted-foreground hover:text-destructive border border-border hover:border-destructive/30 transition-all shadow-sm" onClick={(e) => { e.stopPropagation(); handleDeleteSingle(item.id); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t border-border bg-card relative z-10">
            <span className="text-sm font-medium text-muted-foreground">
              Страница {data.page} из {data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl border-border bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] shadow-sm transition-colors"
                disabled={data.page <= 1}
                onClick={() => setFilters((p) => ({ ...p, page: p.page! - 1 }))}
              >
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl border-border bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] shadow-sm transition-colors"
                disabled={data.page >= data.totalPages}
                onClick={() => setFilters((p) => ({ ...p, page: p.page! + 1 }))}
              >
                Вперед
              </Button>
            </div>
          </div>
        )}
      </motion.div>

      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-card border-border p-0 sm:rounded-2xl [&>button]:z-50">
          <div className="absolute top-0 right-0 w-[500px] h-[300px] bg-primary/10 blur-[100px] pointer-events-none rounded-full" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[300px] bg-purple-500/10 blur-[100px] pointer-events-none rounded-full" />
          
          <div className="p-4 border-b border-border relative z-10 bg-foreground/[0.03] dark:bg-card">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div>
                  <DialogTitle className="text-xl font-bold tracking-tight">Подписка #{detailData?.subscriptionIndex}</DialogTitle>
                  <DialogDescription className="font-mono text-xs opacity-60 mt-1 flex items-center gap-2">
                    ID: {detailId}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="p-4 relative z-10">
            {detailLoading || !detailData ? (
              <div className="py-16 flex flex-col items-center justify-center space-y-4">
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <div className="absolute inset-0 border-2 border-dashed border-border rounded-full animate-[spin_3s_linear_infinite]" />
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
                <span className="text-sm font-medium text-muted-foreground tracking-widest uppercase">Загрузка</span>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-[1.5rem] bg-card border border-border p-4 shadow-sm transition-all hover:shadow-md hover:border-border">
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground block mb-2">Тариф</span>
                    <span className="text-sm font-bold text-foreground/90">{detailData.tariff?.name || "—"}</span>
                  </div>
                  <div className="rounded-[1.5rem] bg-card border border-border p-4 shadow-sm transition-all hover:shadow-md hover:border-border flex flex-col items-start justify-center">
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground block mb-2">Статус</span>
                    <span className={cn("px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide", giftStatusBadge(detailData.giftStatus, detailData.purchasedAsGift, detailData.subscriptionIndex).className)}>
                      {giftStatusBadge(detailData.giftStatus, detailData.purchasedAsGift, detailData.subscriptionIndex).label}
                    </span>
                  </div>
                  <div className="rounded-[1.5rem] bg-card border border-border p-4 shadow-sm transition-all hover:shadow-md hover:border-border">
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground block mb-2">Создана</span>
                    <span className="text-sm font-medium text-foreground/80">{fmtMskDate(detailData.createdAt)}</span>
                  </div>
                  <div className="rounded-[1.5rem] bg-card border border-border p-4 shadow-sm transition-all hover:shadow-md hover:border-border">
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground block mb-2">Обновлена</span>
                    <span className="text-sm font-medium text-foreground/80">{fmtMskDate(detailData.updatedAt)}</span>
                  </div>
                </div>

                <div className="rounded-[1.5rem] bg-card border border-border p-4 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-[40px] pointer-events-none rounded-full" />
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 flex items-center gap-2.5 mb-5">
                    <User className="h-3.5 w-3.5 text-primary" /> Владелец
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm relative z-10">
                    <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-border rounded-xl p-4 transition-colors group-hover:bg-foreground/[0.06] dark:group-hover:bg-card">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Telegram ID</span>
                      <span className="font-mono">{detailData.owner.telegramId || "—"}</span>
                    </div>
                    <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-border rounded-xl p-4 transition-colors group-hover:bg-foreground/[0.06] dark:group-hover:bg-card">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Username</span>
                      <span className="font-medium text-foreground/90">{detailData.owner.telegramUsername ? `@${detailData.owner.telegramUsername}` : "—"}</span>
                    </div>
                    <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-border rounded-xl p-4 transition-colors group-hover:bg-foreground/[0.06] dark:group-hover:bg-card">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Email</span>
                      <span className="font-medium text-foreground/90">{detailData.owner.email || "—"}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.5rem] bg-card border border-border p-4 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-[40px] pointer-events-none rounded-full" />
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 flex items-center gap-2.5">
                      <Activity className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" /> Данные Remnawave
                    </h3>
                    {/* кнопка «Редактировать» — открывает модалку с полями. */}
                    {detailData.remnaData && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl h-8 px-3 text-[11px] font-bold gap-1.5 border-border bg-foreground/[0.04] dark:bg-white/[0.04] hover:bg-foreground/[0.08]"
                        onClick={() => {
                          setEditAddDays("");
                          setEditTrafficGb("");
                          setEditTrafficUnlimited(false);
                          setEditError(null);
                          setEditOpen(true);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Редактировать
                      </Button>
                    )}
                  </div>
                  {detailData.remnaData ? (() => {
                    // корректные имена полей Remna API
                    //   • status — строка ACTIVE / DISABLED / LIMITED / EXPIRED (верхний регистр).
                    //   • trafficLimitBytes — лимит в байтах (0 = безлимит).
                    //   • userTraffic.usedTrafficBytes — использовано в байтах.
                    // Раньше код читал `usedTraffic`, `trafficLimit`, `devices` — таких полей в Remna нет  всегда «0/∞».
                    const remna = detailData.remnaData as Record<string, unknown>;
                    const statusStr = String(remna.status ?? "unknown");
                    const statusActive = statusStr === "ACTIVE";
                    const trafficLimitBytesRaw = remna.trafficLimitBytes;
                    const trafficLimitBytes = typeof trafficLimitBytesRaw === "number"
                      ? trafficLimitBytesRaw
                      : typeof trafficLimitBytesRaw === "string" ? Number(trafficLimitBytesRaw) : 0;
                    const userTraffic = (remna.userTraffic ?? {}) as Record<string, unknown>;
                    const usedRaw = userTraffic.usedTrafficBytes ?? remna.trafficUsedBytes;
                    const usedBytes = typeof usedRaw === "number"
                      ? usedRaw
                      : typeof usedRaw === "string" ? Number(usedRaw) : 0;
                    const fmt = (b: number): string => {
                      if (!Number.isFinite(b) || b <= 0) return "0 B";
                      const u = ["B", "KB", "MB", "GB", "TB"];
                      const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
                      return `${(b / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${u[i]}`;
                    };
                    const trafficStr = `${fmt(usedBytes)} / ${trafficLimitBytes > 0 ? fmt(trafficLimitBytes) : "∞"}`;
                    const deviceLimit = typeof remna.hwidDeviceLimit === "number" ? remna.hwidDeviceLimit : "—";
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm relative z-10">
                        <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-border rounded-xl p-4">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-2">Статус</span>
                          <span className={cn(
                            "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                            statusActive
                              ? "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 shadow-sm"
                              : "bg-red-500/15 text-red-500 dark:text-red-400 border border-red-500/20 shadow-sm"
                          )}>
                            {statusStr}
                          </span>
                        </div>
                        <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-border rounded-xl p-4">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Истекает</span>
                          <span className="font-medium text-foreground/80">
                            {remna.expireAt
                              ? fmtMskDate(String(remna.expireAt))
                              : "—"}
                          </span>
                        </div>
                        <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-border rounded-xl p-4">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Трафик</span>
                          <span className="font-mono text-foreground/80 text-xs">{trafficStr}</span>
                        </div>
                        <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-border rounded-xl p-4">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Лимит устройств</span>
                          <span className="font-mono text-foreground/80">{String(deviceLimit)}</span>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="p-4 border border-dashed border-border rounded-xl flex items-center justify-center text-sm font-medium text-muted-foreground/60 relative z-10">
                      Нет данных Remnawave
                    </div>
                  )}
                </div>

                {detailData.giftCodes && detailData.giftCodes.length > 0 && (
                  <div className="rounded-[1.5rem] bg-card border border-border p-4 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 blur-[40px] pointer-events-none rounded-full" />
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 flex items-center gap-2.5 mb-5">
                      <Gift className="h-3.5 w-3.5 text-purple-400" /> Подарочные коды
                    </h3>
                    <div className="space-y-4 relative z-10">
                      {detailData.giftCodes.map((code) => (
                        <div key={code.id} className="p-4 bg-foreground/[0.03] dark:bg-white/[0.04] border border-border rounded-xl text-sm grid grid-cols-1 sm:grid-cols-2 gap-4 transition-colors hover:bg-foreground/[0.06] dark:hover:bg-card hover:border-border shadow-sm">
                          <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Код</span>
                            <div className="flex items-center gap-3">
                              <span className="font-mono bg-black/40 text-primary/90 px-3 py-1.5 rounded-lg border border-border tracking-widest text-base">
                                {code.code}
                              </span>
                              <span className={cn(
                                "text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider",
                                code.status === "ACTIVE" ? "bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/20 shadow-sm" : 
                                code.status === "REDEEMED" ? "bg-purple-500/15 text-purple-400 border border-purple-500/20 shadow-sm" : 
                                "bg-foreground/[0.06] dark:bg-card text-muted-foreground border border-border shadow-sm"
                              )}>
                                {code.status}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col justify-center sm:text-right text-xs gap-1.5">
                            {code.redeemedBy && (
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Активировал</span>
                                <span className="font-medium text-foreground/90 mt-0.5">{code.redeemedBy.telegramUsername ? `@${code.redeemedBy.telegramUsername}` : code.redeemedBy.email}</span>
                              </div>
                            )}
                            <div className="flex flex-col mt-1">
                              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Действует до</span>
                              <span className="font-medium text-foreground/80 mt-0.5">{fmtMskDate(code.expiresAt)}</span>
                            </div>
                          </div>
                          {code.giftMessage && (
                            <div className="col-span-full mt-2 pt-4 border-t border-border">
                              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Сообщение</span>
                              <div className="text-sm italic text-foreground/80 leading-relaxed pl-3 border-l-[3px] border-border">
                                "{code.giftMessage}"
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-[1.5rem] bg-card border border-border p-4 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 blur-[40px] pointer-events-none rounded-full" />
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 flex items-center gap-2.5 mb-5 relative z-10">
                    <Clock className="h-3.5 w-3.5 text-orange-400" /> История
                  </h3>
                  <div className="space-y-0 pl-6 border-l-2 border-gradient bg-transparent ml-3 relative z-10 py-2">
                    {detailData.history.length === 0 ? (
                      <div className="text-sm text-muted-foreground -ml-6 pb-2 italic">Нет истории событий</div>
                    ) : (
                      detailData.history.map((event, idx) => {
                        const evData = EVENT_LABELS[event.eventType] || { icon: <Activity className="h-4 w-4" />, label: event.eventType };
                        const isLast = idx === detailData.history.length - 1;
                        
                        return (
                          <div key={event.id} className={cn("relative -ml-[31px] flex items-start gap-5", !isLast && "pb-8")}>
                            <div className="bg-background border-2 border-border rounded-full p-1.5 mt-0.5 relative z-10">
                              <div className="text-foreground/80">{evData.icon}</div>
                            </div>
                            <div className="flex-1 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] transition-colors border border-border rounded-[1rem] p-4 shadow-sm">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-bold text-foreground/90">{evData.label}</span>
                                <span className="text-[10px] font-medium tracking-wide text-muted-foreground bg-foreground/[0.04] dark:bg-white/[0.04] px-2 py-1 rounded-md border border-border">
                                  {fmtMskShort(event.createdAt)}
                                </span>
                              </div>
                              {event.metadata && Object.keys(event.metadata).length > 0 && (
                                <pre className="text-[11px] text-muted-foreground/80 bg-black/40 p-3 rounded-lg border border-border mt-3 overflow-x-auto leading-relaxed font-mono">
                                  {JSON.stringify(event.metadata, null, 2)}
                                </pre>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* модалка редактирования доп. подписки админом. */}
      <Dialog open={editOpen} onOpenChange={(o) => !o && !editSaving && setEditOpen(false)}>
        <DialogContent className="sm:max-w-md bg-card border-border p-4 sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-[13.5px] font-bold tracking-tight flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" /> Редактирование подписки
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Дни добавляются к текущему сроку (отрицательное число — сократить). Изменения применяются в Remnawave.
            </DialogDescription>
          </DialogHeader>

          {/* текущее состояние подписки (срок + трафик). */}
          {(() => {
            const r = detailData?.remnaData as Record<string, unknown> | undefined;
            if (!r) return null;
            const BYTES = 1024 ** 3;
            // Расчёт «осталось дней» из expireAt.
            const expireRaw = r.expireAt ?? r.expire_at;
            let daysLeftLabel = "—";
            let expireDateLabel = "—";
            if (typeof expireRaw === "string" || typeof expireRaw === "number") {
              const d = typeof expireRaw === "number" ? new Date(expireRaw * 1000) : new Date(expireRaw);
              if (!isNaN(d.getTime())) {
                const diffMs = d.getTime() - Date.now();
                if (diffMs <= 0) {
                  daysLeftLabel = "истекла";
                } else {
                  const days = Math.ceil(diffMs / 86_400_000);
                  daysLeftLabel = `${days} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"}`;
                }
                expireDateLabel = fmtMskDate(d);
              }
            }
            // Трафик: usedTrafficBytes / trafficLimitBytes (0 = безлимит).
            const usedRaw = (r.userTraffic as { usedTrafficBytes?: number | string } | undefined)?.usedTrafficBytes
              ?? r.trafficUsedBytes ?? r.usedTrafficBytes ?? r.traffic_used_bytes ?? 0;
            const limitRaw = r.trafficLimitBytes ?? r.traffic_limit_bytes ?? 0;
            const usedNum = typeof usedRaw === "string" ? parseFloat(usedRaw) : Number(usedRaw);
            const limitNum = typeof limitRaw === "string" ? parseFloat(limitRaw) : Number(limitRaw);
            const usedGb = Number.isFinite(usedNum) ? (usedNum / BYTES).toFixed(2) : "0";
            const trafficLabel = Number.isFinite(limitNum) && limitNum > 0
              ? `${usedGb} / ${(limitNum / BYTES).toFixed(2)} ГБ`
              : `${usedGb} ГБ / ∞ (безлимит)`;
            const remainingLabel = Number.isFinite(limitNum) && limitNum > 0
              ? `осталось ${Math.max(0, (limitNum - usedNum) / BYTES).toFixed(2)} ГБ`
              : "безлимит";
            return (
              <div className="mt-4 rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.04] p-3.5 space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Срок:</span>
                  <span className="font-medium text-foreground/90">
                    осталось <b>{daysLeftLabel}</b>{expireDateLabel !== "—" && <span className="text-muted-foreground"> · до {expireDateLabel}</span>}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Трафик:</span>
                  <span className="font-mono text-foreground/90">
                    {trafficLabel} <span className="text-muted-foreground">({remainingLabel})</span>
                  </span>
                </div>
              </div>
            );
          })()}

          <div className="space-y-4 mt-4">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-add-days" className="text-xs text-muted-foreground">Изменить срок (дней)</Label>
              <Input
                id="edit-add-days"
                type="number"
                value={editAddDays}
                onChange={(e) => setEditAddDays(e.target.value)}
                placeholder="+30 (продлить) или -7 (сократить)"
                className="rounded-xl"
              />
              <p className="text-[10px] text-muted-foreground">
                Например <code>+30</code> — добавить 30 дней к текущему сроку. Пусто или 0 — не менять.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-traffic-gb" className="text-xs text-muted-foreground">Лимит трафика (ГБ)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="edit-traffic-gb"
                  type="text"
                  inputMode="decimal"
                  value={editTrafficGb}
                  onChange={(e) => { setEditTrafficGb(e.target.value); setEditTrafficUnlimited(false); }}
                  placeholder="например 100"
                  disabled={editTrafficUnlimited}
                  className="rounded-xl flex-1"
                />
                <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                  <Checkbox
                    checked={editTrafficUnlimited}
                    onCheckedChange={(c) => { setEditTrafficUnlimited(!!c); if (c) setEditTrafficGb(""); }}
                  />
                  Безлимит
                </label>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Пусто и без чекбокса — не менять. Чекбокс «Безлимит» = 0 ГБ (без ограничения).
              </p>
            </div>
            {editError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-3">
                 {editError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={editSaving}
                className="rounded-xl"
              >
                Отмена
              </Button>
              <Button
                onClick={async () => {
                  if (!detailId || !token) return;
                  const addDaysNum = editAddDays.trim() ? parseInt(editAddDays, 10) : 0;
                  if (editAddDays.trim() && !Number.isFinite(addDaysNum)) {
                    setEditError("Неверное число дней");
                    return;
                  }
                  let trafficLimitBytes: number | null | undefined = undefined;
                  if (editTrafficUnlimited) {
                    trafficLimitBytes = 0;
                  } else if (editTrafficGb.trim()) {
                    const gb = parseFloat(editTrafficGb.replace(",", "."));
                    if (!Number.isFinite(gb) || gb < 0) {
                      setEditError("Неверный лимит трафика");
                      return;
                    }
                    trafficLimitBytes = Math.floor(gb * 1024 ** 3);
                  }
                  if (!addDaysNum && trafficLimitBytes === undefined) {
                    setEditError("Укажите хотя бы одно поле для изменения");
                    return;
                  }
                  setEditSaving(true);
                  setEditError(null);
                  try {
                    const body: { addDays?: number; trafficLimitBytes?: number | null } = {};
                    if (addDaysNum) body.addDays = addDaysNum;
                    if (trafficLimitBytes !== undefined) body.trafficLimitBytes = trafficLimitBytes;
                    await api.editSecondarySubscription(token, detailId, body);
                    setEditOpen(false);
                    // Перезагружаем detail чтобы увидеть свежие данные из Remna.
                    const refreshed = await api.getSecondarySubscription(token, detailId);
                    setDetailData(refreshed);
                  } catch (e: unknown) {
                    setEditError(e instanceof Error ? e.message : "Ошибка сохранения");
                  } finally {
                    setEditSaving(false);
                  }
                }}
                disabled={editSaving}
                className="rounded-xl"
              >
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false); }}>
        <DialogContent className="sm:max-w-2xl bg-card border-border p-0 sm:rounded-2xl [&>button]:z-50">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-[80px] pointer-events-none rounded-full" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 blur-[80px] pointer-events-none rounded-full" />
          
          <div className="p-4 border-b border-border relative z-10 bg-foreground/[0.03] dark:bg-card">
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div>
                  <DialogTitle className="text-xl font-bold tracking-tight">{createNotify ? "Создать подарочный код" : "Выдать код для подарка"}</DialogTitle>
                  <DialogDescription className="text-xs mt-1 text-muted-foreground/80">
                    {createNotify ? "Код отправится клиенту в Telegram" : "Код НЕ отправляется клиенту — отдайте дарителю"}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="p-4 relative z-10">
            {createResult ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-6"
              >
                <div className="p-8 rounded-[1.5rem] bg-muted border border-green-500/20 text-center space-y-4 relative overflow-hidden">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
                    className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto border border-green-500/30 mb-2"
                  >
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 dark:text-emerald-400" />
                  </motion.div>
                  <p className="text-base font-bold text-emerald-500 dark:text-emerald-400">Подарочный код создан!</p>
                  
                  <div className="flex items-center justify-center gap-3 bg-black/40 p-4 rounded-xl border border-border group">
                    <span className="font-mono text-2xl text-primary font-bold tracking-[0.2em]">
                      {createResult.code}
                    </span>
                    <Button 
                      size="icon" 
                      className="h-10 w-10 rounded-xl bg-foreground/[0.04] dark:bg-card hover:bg-primary/15 text-muted-foreground hover:text-primary border border-border transition-all group-hover:border-border" 
                      onClick={() => copyToClipboard(createResult.code)}
                    >
                      {copiedCode === createResult.code ? <Check className="h-5 w-5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-5 w-5" />}
                    </Button>
                  </div>
                  
                  <p className="text-xs font-medium text-muted-foreground bg-card inline-block px-3 py-1.5 rounded-full border border-border">
                    Действует до: {fmtMsk(createResult.expiresAt)}
                  </p>

                  {createGiftUrl && (
                    <div className="space-y-2 pt-2">
                      <p className="text-[11px] font-medium text-muted-foreground">Ссылка для пересылки дарителю:</p>
                      <div className="flex items-center gap-2 bg-black/30 p-3 rounded-xl border border-border">
                        <span className="font-mono text-xs text-primary/90 flex-1 truncate text-left">{createGiftUrl}</span>
                        <Button size="icon" className="h-9 w-9 rounded-lg bg-foreground/[0.04] dark:bg-card hover:bg-primary/15 text-muted-foreground hover:text-primary border border-border shrink-0" onClick={() => copyToClipboard(createGiftUrl!)}>
                          {copiedCode === createGiftUrl ? <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      {!createNotify && (
                        <p className="text-[10px] text-amber-500/90">Клиенту ничего не отправлено — передайте код/ссылку дарителю.</p>
                      )}
                    </div>
                  )}
                </div>
                <Button className="w-full h-12 rounded-xl font-bold bg-foreground/[0.05] dark:bg-card hover:bg-foreground/[0.08] dark:hover:bg-white/[0.15] text-foreground border border-border transition-all shadow-sm" onClick={() => setCreateOpen(false)}>
                  Закрыть
                </Button>
              </motion.div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/80 ml-1">Клиент (владелец)</Label>
                  {createSelectedClient ? (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-border"
                    >
                      <span className="text-sm font-medium text-foreground/90 flex-1 truncate">
                        {createSelectedClient.telegramUsername
                          ? `@${createSelectedClient.telegramUsername}`
                          : createSelectedClient.email || `ID: ${createSelectedClient.telegramId}`}
                      </span>
                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/20 shrink-0" onClick={() => setCreateSelectedClient(null)}>
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </motion.div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground/60" />
                          <Input
                            placeholder="Email или Telegram..."
                            className="pl-9 bg-card border-border hover:border-border focus:border-border rounded-xl h-9 transition-all"
                            value={createClientSearch}
                            onChange={(e) => setCreateClientSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") searchClients(); }}
                          />
                        </div>
                        <Button variant="secondary" className="h-9 rounded-xl px-4 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border border-border transition-colors" onClick={searchClients} disabled={createClientsLoading}>
                          {createClientsLoading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : "Найти"}
                        </Button>
                      </div>
                      {createClients.length > 0 && (
                        <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-foreground/[0.04] dark:bg-white/[0.04] divide-y divide-border mt-2 custom-scrollbar">
                          {createClients.map((c) => (
                            <button
                              key={c.id}
                              className="w-full text-left px-4 py-3 text-sm hover:bg-foreground/[0.06] dark:hover:bg-card focus:bg-foreground/[0.06] dark:focus:bg-card outline-none transition-colors flex items-center gap-3 group"
                              onClick={() => {
                                setCreateSelectedClient(c);
                                setCreateClients([]);
                              }}
                            >
                              <span className="font-medium text-foreground/80 group-hover:text-foreground transition-colors truncate">
                                {c.telegramUsername ? `@${c.telegramUsername}` : c.email || `TG: ${c.telegramId}`}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Label className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/80 ml-1">Тариф</Label>
                  <div className="relative">
                    <select
                      className="flex h-12 w-full rounded-xl border border-border bg-card hover:border-border focus:border-border px-4 py-2 text-sm text-foreground focus:outline-none transition-all appearance-none cursor-pointer"
                      value={createSelectedTariff}
                      onChange={(e) => setCreateSelectedTariff(e.target.value)}
                    >
                      <option value="" disabled className="bg-background text-muted-foreground">Выберите тариф</option>
                      {createTariffs.map((t) => (
                        <option key={t.id} value={t.id} className="bg-background text-foreground py-2">
                          {t.name} ({t.durationDays}д · {t.price} {t.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* срок + трафик (override тарифа) + режим уведомления */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/80 ml-1">Срок (дней)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      placeholder="по тарифу"
                      className="bg-card border-border hover:border-border focus:border-border rounded-xl h-9"
                      value={createDurationDays}
                      onChange={(e) => setCreateDurationDays(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/80 ml-1">Трафик (GB)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      placeholder="по тарифу · 0 = ∞"
                      className="bg-card border-border hover:border-border focus:border-border rounded-xl h-9"
                      value={createTrafficGb}
                      onChange={(e) => setCreateTrafficGb(e.target.value)}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-3 px-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={createNotify}
                    onChange={(e) => setCreateNotify(e.target.checked)}
                  />
                  <span className="text-xs text-muted-foreground">Уведомить клиента в Telegram (отправить ему код + ссылку)</span>
                </label>

                <div className="space-y-3">
                  <div className="flex items-center justify-between ml-1">
                    <Label className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/80">Сообщение</Label>
                    <span className="text-[10px] font-bold text-muted-foreground bg-foreground/[0.04] dark:bg-card px-2 py-0.5 rounded-full border border-border">{createMessage.length}/200</span>
                  </div>
                  <Textarea
                    placeholder="Напишите приятные слова получателю... (необязательно)"
                    className="bg-card border-border hover:border-border focus:border-border rounded-xl resize-none p-4 transition-all"
                    maxLength={200}
                    rows={3}
                    value={createMessage}
                    onChange={(e) => setCreateMessage(e.target.value)}
                  />
                </div>

                {createError && (
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400 font-medium flex items-center gap-3">
                    <XCircle className="w-5 h-5 shrink-0" />
                    {createError}
                  </motion.div>
                )}

                <Button
                  className="w-full h-12 rounded-xl gap-2 font-bold hover:shadow-[0_0_25px_rgba(var(--primary),0.4)] transition-all overflow-hidden relative group"
                  disabled={!createSelectedClient || !createSelectedTariff || createLoading}
                  onClick={handleCreateSubmit}
                >
                  <div className="absolute inset-0 bg-transparent -translate-x-[200%] group-hover:translate-x-[200%] transition-transform duration-1000 ease-in-out" />
                  {createLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Gift className="h-5 w-5 group-hover:scale-110 transition-transform" />
                  )}
                  {createLoading ? "Создание..." : "Сгенерировать код"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
