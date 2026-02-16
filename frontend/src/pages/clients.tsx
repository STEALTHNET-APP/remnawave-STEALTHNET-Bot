import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import {
  api,
  type ClientRecord,
  type UpdateClientPayload,
  type UpdateClientRemnaPayload,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, Trash2, Ban, ShieldCheck, Wifi, Ticket, KeyRound, Search, Filter } from "lucide-react";

export function ClientsPage() {
  const { state } = useAuth();
  const [data, setData] = useState<{ items: ClientRecord[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ClientRecord | null>(null);
  const [editForm, setEditForm] = useState<UpdateClientPayload & Partial<UpdateClientRemnaPayload>>({});
  const [remnaData, setRemnaData] = useState<{ squads: { uuid: string; name?: string }[] }>({ squads: [] });
  const [clientRemnaSquads, setClientRemnaSquads] = useState<string[]>([]);
  const [settings, setSettings] = useState<{ activeLanguages: string[]; activeCurrencies: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState<{ newPassword: string; confirm: string }>({ newPassword: "", confirm: "" });
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [filterBlocked, setFilterBlocked] = useState<"all" | "blocked" | "active">("all");
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

  useEffect(() => {
    loadClients();
  }, [token, page, searchApplied, filterBlocked]);

  const applySearch = () => {
    setSearchApplied(search);
    setPage(1);
  };

  useEffect(() => {
    if (editing?.remnawaveUuid) {
      api.getRemnaSquadsInternal(token).then((raw: unknown) => {
        const res = raw as { response?: { internalSquads?: { uuid: string; name?: string }[] } };
        const items = res?.response?.internalSquads ?? (Array.isArray(res) ? res : []);
        setRemnaData({ squads: Array.isArray(items) ? items : [] });
      }).catch(() => setRemnaData({ squads: [] }));
      api.getClientRemna(token, editing.id).then((raw: unknown) => {
        const res = raw as { response?: { activeInternalSquads?: Array<{ uuid?: string } | string> } };
        const arr = res?.response?.activeInternalSquads ?? [];
        const uuids = Array.isArray(arr) ? arr.map((s) => (typeof s === "string" ? s : s?.uuid)).filter((u): u is string => Boolean(u)) : [];
        setClientRemnaSquads(uuids);
      }).catch(() => setClientRemnaSquads([]));
    } else {
      setRemnaData({ squads: [] });
      setClientRemnaSquads([]);
    }
  }, [token, editing?.id, editing?.remnawaveUuid]);

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
      });
      setEditing(updated);
      setEditForm({});
      setActionMessage("Сохранено");
      loadClients();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function saveRemnaLimits() {
    if (!editing?.remnawaveUuid) return;
    setSaving(true);
    setActionMessage(null);
    try {
      const payload: UpdateClientRemnaPayload = {};
      if (editForm.trafficLimitBytes !== undefined) payload.trafficLimitBytes = editForm.trafficLimitBytes;
      if (editForm.trafficLimitStrategy) payload.trafficLimitStrategy = editForm.trafficLimitStrategy;
      if (editForm.hwidDeviceLimit !== undefined) payload.hwidDeviceLimit = editForm.hwidDeviceLimit;
      if (editForm.expireAt) payload.expireAt = editForm.expireAt;
      await api.updateClientRemna(token, editing.id, payload);
      setActionMessage("Лимиты Remna обновлены");
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Ошибка Remna");
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

  async function remnaAction(
    name: string,
    fn: () => Promise<unknown>
  ) {
    setActionMessage(null);
    try {
      await fn();
      setActionMessage(name + " — ок");
      loadClients();
    } catch (e) {
      setActionMessage(name + ": " + (e instanceof Error ? e.message : "ошибка"));
    }
  }

  async function saveClientPassword() {
    if (!editing) return;
    if (passwordForm.newPassword.length < 8) {
      setPasswordMessage("Пароль не менее 8 символов");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirm) {
      setPasswordMessage("Пароли не совпадают");
      return;
    }
    setPasswordMessage(null);
    setSavingPassword(true);
    try {
      await api.setClientPassword(token, editing.id, passwordForm.newPassword);
      setPasswordMessage("Пароль установлен");
      setPasswordForm({ newPassword: "", confirm: "" });
    } catch (e) {
      setPasswordMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSavingPassword(false);
    }
  }

  async function squadAdd(squadUuid: string) {
    if (!editing) return;
    await remnaAction("Сквад добавлен", () => api.clientRemnaSquadAdd(token, editing.id, squadUuid));
    setClientRemnaSquads((prev) => (prev.includes(squadUuid) ? prev : [...prev, squadUuid]));
  }

  async function squadRemove(squadUuid: string) {
    if (!editing) return;
    await remnaAction("Сквад снят", () => api.clientRemnaSquadRemove(token, editing.id, squadUuid));
    setClientRemnaSquads((prev) => prev.filter((u) => u !== squadUuid));
  }

  if (loading && !data) return <div className="text-muted-foreground">Загрузка…</div>;
  if (!data) return <div className="text-destructive">Ошибка загрузки</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Клиенты</h1>
        <p className="text-muted-foreground">Пользователи бота, сайта и Mini App</p>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Всего: {data.total}</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * 20 >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Вперёд
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex flex-1 items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Поиск: email, Telegram, реф. код, ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applySearch()}
                className="max-w-xs"
              />
              <Button variant="secondary" size="sm" onClick={applySearch}>
                Искать
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              <select
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={filterBlocked}
                onChange={(e) => {
                  setFilterBlocked(e.target.value as "all" | "blocked" | "active");
                  setPage(1);
                }}
              >
                <option value="all">Все</option>
                <option value="active">Только активные</option>
                <option value="blocked">Только заблокированные</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2">Email</th>
                  <th className="text-left py-2 px-2">Telegram</th>
                  <th className="text-left py-2 px-2">Язык</th>
                  <th className="text-left py-2 px-2">Валюта</th>
                  <th className="text-left py-2 px-2">Баланс</th>
                  <th className="text-left py-2 px-2">Реф.%</th>
                  <th className="text-left py-2 px-2">Блок</th>
                  <th className="text-left py-2 px-2">Дата</th>
                  <th className="text-left py-2 px-2">Действия</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="py-2 px-2">{c.email ?? "—"}</td>
                    <td className="py-2 px-2">
                      {c.telegramId != null || c.telegramUsername ? (
                        <span title={c.telegramId ?? undefined}>
                          {c.telegramUsername ? `@${c.telegramUsername}` : ""}
                          {c.telegramUsername && c.telegramId ? " " : ""}
                          {c.telegramId != null ? `(ID: ${c.telegramId})` : ""}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-2 px-2">{c.preferredLang}</td>
                    <td className="py-2 px-2">{c.preferredCurrency}</td>
                    <td className="py-2 px-2">{c.balance}</td>
                    <td className="py-2 px-2">{c.referralPercent != null ? c.referralPercent + "%" : "—"}</td>
                    <td className="py-2 px-2">{c.isBlocked ? <span className="text-destructive">Да</span> : "—"}</td>
                    <td className="py-2 px-2 text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-2 flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)} title="Редактировать">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => deleteClient(c)} title="Удалить" className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {editing && (
        <ClientEditModal
          client={editing}
          editForm={editForm}
          setEditForm={setEditForm}
          saving={saving}
          actionMessage={actionMessage}
          remnaData={remnaData}
          clientRemnaSquads={clientRemnaSquads}
          activeLanguages={settings?.activeLanguages ?? []}
          activeCurrencies={settings?.activeCurrencies ?? []}
          onClose={() => {
            setEditing(null);
            setPasswordForm({ newPassword: "", confirm: "" });
            setPasswordMessage(null);
          }}
          onSave={saveClient}
          onSaveRemnaLimits={saveRemnaLimits}
          onRemnaAction={remnaAction}
          onSquadAdd={squadAdd}
          onSquadRemove={squadRemove}
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
  remnaData,
  onClose,
  onSave,
  onSaveRemnaLimits,
  onRemnaAction,
  onSquadAdd,
  onSquadRemove,
  onSetPassword,
  passwordForm,
  setPasswordForm,
  passwordMessage,
  savingPassword,
  token,
  activeLanguages,
  activeCurrencies,
  clientRemnaSquads,
}: {
  client: ClientRecord;
  editForm: UpdateClientPayload & Partial<UpdateClientRemnaPayload>;
  setEditForm: React.Dispatch<React.SetStateAction<UpdateClientPayload & Partial<UpdateClientRemnaPayload>>>;
  saving: boolean;
  actionMessage: string | null;
  remnaData: { squads: { uuid: string; name?: string }[] };
  clientRemnaSquads: string[];
  activeLanguages: string[];
  activeCurrencies: string[];
  onClose: () => void;
  onSave: () => Promise<void>;
  onSaveRemnaLimits: () => Promise<void>;
  onRemnaAction: (name: string, fn: () => Promise<unknown>) => Promise<void>;
  onSquadAdd: (squadUuid: string) => Promise<void>;
  onSquadRemove: (squadUuid: string) => Promise<void>;
  onSetPassword: () => Promise<void>;
  passwordForm: { newPassword: string; confirm: string };
  setPasswordForm: React.Dispatch<React.SetStateAction<{ newPassword: string; confirm: string }>>;
  passwordMessage: string | null;
  savingPassword: boolean;
  token: string;
}) {
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border-primary/50 shadow-xl">
        <CardHeader className="flex flex-row items-center justify-between shrink-0">
          <CardTitle>Редактировать клиента</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>Закрыть</Button>
        </CardHeader>
        <div className="overflow-y-auto px-6 pb-6">
          <div className="mb-4 p-3 rounded-md bg-muted/50 text-sm">
            <div className="font-medium mb-1">Клиент</div>
            <div className="space-y-0.5 text-muted-foreground">
              {editing.email && <div>Email: {editing.email}</div>}
              <div>
                Telegram username: {editing.telegramUsername ? `@${editing.telegramUsername}` : "—"}
              </div>
              <div>
                Telegram ID: {editing.telegramId != null ? editing.telegramId : "—"}
              </div>
              <div>ID в панели: {editing.id}</div>
              <div>
                Реферальный код: {editing.referralCode ? (
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{editing.referralCode}</code>
                ) : "—"}
              </div>
              <div>
                Рефералов: {editing._count?.referrals ?? 0}
              </div>
            </div>
          </div>
          <CardContent className="p-0 space-y-6">
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
                <Label>Язык</Label>
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
                <Label>Валюта</Label>
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
                <Label>Баланс</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editForm.balance ?? 0}
                  onChange={(e) => setEditForm((f) => ({ ...f, balance: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Реферальный % (личный)</Label>
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
                  placeholder="по умолчанию из настроек"
                />
              </div>
              <div className="space-y-2 flex items-end gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editForm.isBlocked ?? false}
                    onChange={(e) => setEditForm((f) => ({ ...f, isBlocked: e.target.checked }))}
                  />
                  <span>Заблокирован</span>
                </label>
              </div>
              {(editForm.isBlocked ?? editing.isBlocked) && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Причина блокировки</Label>
                  <Input
                    value={editForm.blockReason ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, blockReason: e.target.value || undefined }))}
                    placeholder="Причина"
                  />
                </div>
              )}
            </div>
            {actionMessage && <p className="text-sm text-muted-foreground">{actionMessage}</p>}
            <div className="flex gap-2">
              <Button onClick={onSave} disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</Button>
            </div>

            <hr />
            <div>
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Пароль для входа в кабинет
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Установить или сменить пароль клиента. Вход по паролю возможен только при указанном email (сохраните профиль с email выше).
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Новый пароль (не менее 8 символов)</Label>
                  <Input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Повторите пароль</Label>
                  <Input
                    type="password"
                    value={passwordForm.confirm}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              {passwordMessage && (
                <p className={`text-sm mt-2 ${passwordMessage === "Пароль установлен" ? "text-green-600" : "text-destructive"}`}>
                  {passwordMessage}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={onSetPassword}
                disabled={savingPassword || !passwordForm.newPassword || passwordForm.newPassword.length < 8}
              >
                {savingPassword ? "Сохранение…" : "Установить / сменить пароль"}
              </Button>
            </div>

            {editing.remnawaveUuid && (
              <>
                <hr />
                <div>
                  <h3 className="font-semibold mb-2">Remna (лимиты, сквад, тариф)</h3>
                  <div className="grid gap-4 sm:grid-cols-2 text-sm">
                    <div className="space-y-2">
                      <Label>Лимит трафика (ГБ), 0 = без лимита</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        value={
                          editForm.trafficLimitBytes !== undefined && editForm.trafficLimitBytes > 0
                            ? (editForm.trafficLimitBytes / (1024 ** 3)).toFixed(2).replace(/\.?0+$/, "")
                            : editForm.trafficLimitBytes === 0
                              ? "0"
                              : ""
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditForm((f) => ({
                            ...f,
                            trafficLimitBytes:
                              v === ""
                                ? undefined
                                : (() => {
                                    const gb = parseFloat(v);
                                    return Number.isNaN(gb) ? undefined : Math.round(gb * 1024 ** 3);
                                  })(),
                          }));
                        }}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Лимит устройств (HWID)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={editForm.hwidDeviceLimit ?? ""}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            hwidDeviceLimit: e.target.value === "" ? undefined : Number(e.target.value),
                          }))
                        }
                        placeholder="—"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Сброс трафика</Label>
                      <Select
                        value={editForm.trafficLimitStrategy ?? ""}
                        onChange={(v) => setEditForm((f) => ({ ...f, trafficLimitStrategy: v as UpdateClientRemnaPayload["trafficLimitStrategy"] }))}
                        options={[
                          { value: "", label: "—" },
                          { value: "NO_RESET", label: "Без сброса" },
                          { value: "DAY", label: "День" },
                          { value: "WEEK", label: "Неделя" },
                          { value: "MONTH", label: "Месяц" },
                        ]}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Дата окончания (ISO)</Label>
                      <Input
                        type="datetime-local"
                        value={editForm.expireAt ? editForm.expireAt.slice(0, 16) : ""}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            expireAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="mt-2" onClick={onSaveRemnaLimits} disabled={saving}>
                    Применить лимиты в Remna
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRemnaAction("Подписка отозвана", () => api.clientRemnaRevokeSubscription(token, editing.id))}
                  >
                    <Ticket className="h-4 w-4 mr-1" /> Отозвать тариф
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRemnaAction("Отключён", () => api.clientRemnaDisable(token, editing.id))}
                  >
                    <Ban className="h-4 w-4 mr-1" /> Отключить в Remna
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRemnaAction("Включён", () => api.clientRemnaEnable(token, editing.id))}
                  >
                    <ShieldCheck className="h-4 w-4 mr-1" /> Включить в Remna
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRemnaAction("Трафик сброшен", () => api.clientRemnaResetTraffic(token, editing.id))}
                  >
                    <Wifi className="h-4 w-4 mr-1" /> Сбросить трафик
                  </Button>
                </div>

                {remnaData.squads.length > 0 && (
                  <div className="mt-4">
                    <Label>Сквады</Label>
                    <p className="text-xs text-muted-foreground mb-2">Отмечено, в каких сквадах состоит клиент в Remna</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {remnaData.squads.map((s) => {
                        const inSquad = clientRemnaSquads.includes(s.uuid);
                        return (
                          <span
                            key={s.uuid}
                            className={`inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-xs border ${
                              inSquad ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted border-transparent text-muted-foreground"
                            }`}
                          >
                            <span className="font-medium">{s.name || s.uuid}</span>
                            <span className="text-[10px]">{inSquad ? "в скваде" : "не в скваде"}</span>
                            {inSquad ? (
                              <Button variant="ghost" size="sm" className="h-6 px-1 text-destructive" onClick={() => onSquadRemove(s.uuid)} title="Убрать из сквада">
                                − Убрать
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" className="h-6 px-1" onClick={() => onSquadAdd(s.uuid)} title="Добавить в сквад">
                                + Добавить
                              </Button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </div>
      </Card>
    </div>
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
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
