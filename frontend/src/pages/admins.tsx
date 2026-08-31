import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type AdminListItem, MANAGER_SECTIONS, MANAGER_SECTION_CATEGORIES } from "@/lib/api";
import { adminPermissionsApi, type ActionDef } from "@/lib/admin-extras-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Loader2, Crown, X, Shield, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function AdminsPage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const [list, setList] = useState<AdminListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [allowedSections, setAllowedSections] = useState<string[]>([]);
  // actions в той же форме что и секции.
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [actionCatalog, setActionCatalog] = useState<ActionDef[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getAdmins(token).then(setList).catch(() => setError("Нет доступа")).finally(() => setLoading(false));
    // Каталог критических action-прав — грузим один раз при заходе.
    adminPermissionsApi.actions(token).then((r) => setActionCatalog(r.actions ?? [])).catch(() => {});
  }, [token]);

  function openCreate() {
    setModal("create");
    setEditingId(null);
    setDeleteConfirm(null);
    setEmail("");
    setPassword("");
    setAllowedSections([]);
    setSelectedActions([]);
  }

  async function openEdit(item: AdminListItem) {
    if (item.role === "ADMIN") return;
    setModal("edit");
    setEditingId(item.id);
    setDeleteConfirm(null);
    setEmail(item.email);
    setPassword("");
    setAllowedSections(item.allowedSections ?? []);
    // Подгружаем текущие granted actions.
    if (token) {
      setActionsLoading(true);
      try {
        const cur = await adminPermissionsApi.get(token, item.id);
        setSelectedActions(Array.isArray(cur.actions) ? cur.actions : []);
      } catch {
        setSelectedActions([]);
      } finally {
        setActionsLoading(false);
      }
    }
  }

  function toggleSection(key: string) {
    setAllowedSections((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );
  }

  function toggleAction(key: string) {
    setSelectedActions((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );
  }

  async function handleCreate() {
    if (!token || !email.trim() || !password) {
      setError("Укажите email и пароль (мин. 8 символов)");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await api.createManager(token, {
        email: email.trim(),
        password,
        allowedSections,
      });
      // сохраняем actions сразу после создания.
      if (selectedActions.length > 0) {
        await adminPermissionsApi.set(token, created.id, selectedActions).catch(() => {});
      }
      setList((prev) => [created, ...prev]);
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!token || !editingId) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateManager(token, editingId, {
        allowedSections,
        ...(password.trim() ? { password: password.trim() } : {}),
      });
      // обновляем actions тем же save.
      // На бэке PATCH /admins/:id уже сохраняет существующие actions при изменении секций
      // (мерж), а потом PUT /admin-permissions/:adminId перезаписывает их новыми.
      await adminPermissionsApi.set(token, editingId, selectedActions).catch(() => {});
      setList((prev) => prev.map((a) => (a.id === editingId ? { ...a, ...updated } : a)));
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    setSaving(true);
    setError("");
    try {
      await api.deleteManager(token, id);
      setList((prev) => prev.filter((a) => a.id !== id));
      setDeleteConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Загружаем менеджеров…</p>
      </div>
    );
  }

  if (error && list.length === 0) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <Card className="bg-card border-border rounded-2xl py-12 text-center">
          <p className="text-muted-foreground">{error}</p>
        </Card>
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
              Менеджеры
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">
              Создавайте менеджеров и назначайте им доступ только к нужным разделам.
            </p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-1.5 rounded-xl">
          <Plus className="h-4 w-4" />
          Добавить менеджера
        </Button>
      </motion.div>

      <Card className="bg-card border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold tracking-tight">Пользователи админки</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Админ имеет полный доступ. Менеджеру доступны только выбранные разделы.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-foreground/[0.04] dark:bg-white/[0.03] border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Email</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Роль</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Разделы доступа</th>
                <th className="w-32 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 font-medium">{item.email}</td>
                  <td className="px-4 py-3">
                    {item.role === "ADMIN" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 px-2.5 py-0.5 text-[11px] font-medium">
                        <Crown className="h-3 w-3" />
                        Админ
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary border border-border px-2.5 py-0.5 text-[11px] font-medium">
                        <Shield className="h-3 w-3" />
                        Менеджер
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {item.role === "ADMIN" ? (
                      <span className="text-amber-500 dark:text-amber-400">Все разделы</span>
                    ) : item.allowedSections?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {item.allowedSections.map((k) => (
                          <span key={k} className="inline-flex items-center rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] border border-border px-2 py-0.5 text-[10px] font-medium">
                            {MANAGER_SECTIONS.find((s) => s.key === k)?.label ?? k}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60">Нет доступа</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.role === "MANAGER" && (
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => openEdit(item)} title="Изменить">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {deleteConfirm === item.id ? (
                          <>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-8 rounded-lg"
                              onClick={() => handleDelete(item.id)}
                              disabled={saving}
                            >
                              Да
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 rounded-lg" onClick={() => setDeleteConfirm(null)}>
                              Нет
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10"
                            onClick={() => setDeleteConfirm(item.id)}
                            title="Удалить"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {error && modal && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400">
          {error}
        </div>
      )}

      {(modal === "create" || (modal === "edit" && editingId)) && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-card border-border rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
                  {modal === "create" ? <Plus className="h-5 w-5 text-primary" /> : <Pencil className="h-5 w-5 text-primary" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight">{modal === "create" ? "Новый менеджер" : "Редактировать менеджера"}</h3>
                  <p className="text-xs text-muted-foreground">{modal === "create" ? "Email + пароль + доступы" : "Изменить пароль и/или доступы"}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setModal(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input
                  type="email"
                  value={email}
                  disabled={modal === "edit"}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="manager@example.com"
                  className={cn("rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50", modal === "edit" && "opacity-60")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">{modal === "create" ? "Пароль (мин. 8 символов)" : "Новый пароль (пусто — не менять)"}</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs text-muted-foreground">Доступ к разделам</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-lg text-xs"
                      onClick={() => setAllowedSections(MANAGER_SECTIONS.map((s) => s.key))}
                    >
                      Выбрать все
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-lg text-xs"
                      onClick={() => setAllowedSections([])}
                    >
                      Снять все
                    </Button>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-4">
                  {MANAGER_SECTION_CATEGORIES.map((cat) => {
                    const items = MANAGER_SECTIONS.filter((s) => s.category === cat.key);
                    if (items.length === 0) return null;
                    const allChecked = items.every((s) => allowedSections.includes(s.key));
                    const someChecked = items.some((s) => allowedSections.includes(s.key));
                    return (
                      <div key={cat.key} className="space-y-2">
                        <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-[2px] h-[12px] bg-primary" />
                            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                              {cat.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60">
                              {items.filter((s) => allowedSections.includes(s.key)).length}/{items.length}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="text-[11px] text-primary/80 hover:text-primary transition-colors"
                            onClick={() => {
                              const keys = items.map((s) => s.key);
                              setAllowedSections((prev) =>
                                allChecked
                                  ? prev.filter((k) => !keys.includes(k))
                                  : Array.from(new Set([...prev, ...keys]))
                              );
                            }}
                          >
                            {allChecked ? "Снять группу" : someChecked ? "Дозаполнить" : "Выбрать группу"}
                          </button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pl-3">
                          {items.map((s) => (
                            <label key={s.key} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={allowedSections.includes(s.key)}
                                onCheckedChange={() => toggleSection(s.key)}
                              />
                              <span className="text-sm">{s.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* критические действия (action-уровень) — отдельный блок. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    <Label className="text-xs text-muted-foreground">Критические действия</Label>
                  </div>
                  {actionCatalog.length > 0 && (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-lg text-xs"
                        onClick={() => setSelectedActions(actionCatalog.map((a) => a.key))}
                      >
                        Выбрать все
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-lg text-xs"
                        onClick={() => setSelectedActions([])}
                      >
                        Снять все
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground/80 mb-2 pl-1">
                  Тонкие права на чувствительные операции (возвраты, удаление устройств и т.д.). Менеджер получает доступ к ним только если есть галка.
                </p>
                <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] p-4 space-y-4">
                  {actionsLoading && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {!actionsLoading && actionCatalog.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">Каталог действий пока пуст</p>
                  )}
                  {!actionsLoading && actionCatalog.length > 0 && (() => {
                    const groupLabels: Record<string, { label: string; color: string }> = {
                      payments: { label: "Платежи", color: "bg-emerald-500" },
                      clients: { label: "Клиенты", color: "bg-sky-500" },
                      security: { label: "Безопасность", color: "bg-rose-500" },
                      operations: { label: "Операции", color: "bg-violet-500" },
                    };
                    const groups = Object.keys(groupLabels);
                    return groups.map((groupKey) => {
                      const items = actionCatalog.filter((a) => a.group === groupKey);
                      if (items.length === 0) return null;
                      const meta = groupLabels[groupKey];
                      const allChecked = items.every((a) => selectedActions.includes(a.key));
                      const someChecked = items.some((a) => selectedActions.includes(a.key));
                      return (
                        <div key={groupKey} className="space-y-2">
                          <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5">
                            <div className="flex items-center gap-2">
                              <div className={cn("w-[2px] h-[12px]", meta.color)} />
                              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{meta.label}</span>
                              <span className="text-[10px] text-muted-foreground/60">
                                {items.filter((a) => selectedActions.includes(a.key)).length}/{items.length}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="text-[11px] text-amber-500/80 hover:text-amber-500 transition-colors"
                              onClick={() => {
                                const keys = items.map((a) => a.key);
                                setSelectedActions((prev) =>
                                  allChecked
                                    ? prev.filter((k) => !keys.includes(k))
                                    : Array.from(new Set([...prev, ...keys]))
                                );
                              }}
                            >
                              {allChecked ? "Снять группу" : someChecked ? "Дозаполнить" : "Выбрать группу"}
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-3">
                            {items.map((a) => {
                              const sevColor = a.severity === "critical"
                                ? "text-rose-500 dark:text-rose-400"
                                : a.severity === "warn"
                                  ? "text-amber-500 dark:text-amber-400"
                                  : "text-sky-500 dark:text-sky-400";
                              return (
                                <label key={a.key} className="flex items-start gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-white/[0.03] transition-colors">
                                  <Checkbox
                                    checked={selectedActions.includes(a.key)}
                                    onCheckedChange={() => toggleAction(a.key)}
                                    className="mt-0.5"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm font-medium">{a.label}</span>
                                      <span className={cn("text-[9px] uppercase tracking-wider font-bold", sevColor)}>
                                        {a.severity}
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground/70 mt-0.5 line-clamp-2" title={a.description}>
                                      {a.description}
                                    </p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setModal(null)} className="rounded-xl">Отмена</Button>
                <Button
                  onClick={modal === "create" ? handleCreate : handleUpdate}
                  disabled={saving}
                  className="gap-2 rounded-xl"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {modal === "create" ? "Создать" : "Сохранить"}
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

    </div>
  );
}
