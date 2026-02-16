import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type {
  TariffCategoryWithTariffs,
  TariffRecord,
  CreateTariffPayload,
  UpdateTariffPayload,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Pencil,
  Trash2,
  FolderOpen,
  CreditCard,
  Loader2,
  X,
  ChevronDown,
  Check,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const BYTES_PER_GB = 1024 * 1024 * 1024;

const CURRENCIES = [
  { value: "usd", label: "USD" },
  { value: "rub", label: "RUB" },
];

function formatTraffic(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes >= BYTES_PER_GB) return `${(bytes / BYTES_PER_GB).toFixed(1)} ГБ`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} МБ`;
}

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

type SquadOption = { uuid: string; name?: string };

function SortableCategoryCard({
  cat,
  onEditCategory,
  onDeleteCategory,
  onAddTariff,
  onEditTariff,
  onDeleteTariff,
  onTariffDragEnd,
  formatPrice,
  formatTraffic,
}: {
  cat: TariffCategoryWithTariffs;
  onEditCategory: () => void;
  onDeleteCategory: () => void;
  onAddTariff: () => void;
  onEditTariff: (t: TariffRecord) => void;
  onDeleteTariff: (id: string) => void;
  onTariffDragEnd: (event: DragEndEvent) => void;
  formatPrice: (amount: number, currency: string) => string;
  formatTraffic: (bytes: number | null) => string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cat.id,
  });
  const tariffSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`overflow-hidden rounded-xl border shadow-sm ${isDragging ? "opacity-80 shadow-lg z-10" : ""}`}
    >
      <CardHeader className="pb-2 bg-muted/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <span
              className="flex h-9 w-9 shrink-0 cursor-grab active:cursor-grabbing items-center justify-center rounded-lg bg-muted/80 text-muted-foreground hover:bg-muted"
              {...attributes}
              {...listeners}
              title="Перетащите для изменения порядка"
            >
              <GripVertical className="h-5 w-5" />
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderOpen className="h-5 w-5" />
            </span>
            {cat.name}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={onEditCategory} title="Редактировать категорию">
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Изменить
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-destructive hover:text-destructive"
              onClick={onDeleteCategory}
              title="Удалить категорию"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Удалить
            </Button>
            <Button size="sm" className="rounded-lg shadow-sm" onClick={onAddTariff}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Тариф
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {cat.tariffs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Нет тарифов. Нажмите «Тариф», чтобы добавить (название, срок в днях, сквады, лимит трафика и устройств).
          </p>
        ) : (
          <DndContext
            sensors={tariffSensors}
            collisionDetection={closestCenter}
            onDragEnd={onTariffDragEnd}
          >
            <SortableContext
              items={cat.tariffs.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {cat.tariffs.map((t) => (
                  <SortableTariffRow
                    key={t.id}
                    tariff={t}
                    onEdit={() => onEditTariff(t)}
                    onDelete={() => onDeleteTariff(t.id)}
                    formatPrice={formatPrice}
                    formatTraffic={formatTraffic}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  );
}

function SortableTariffRow({
  tariff: t,
  onEdit,
  onDelete,
  formatPrice,
  formatTraffic,
}: {
  tariff: TariffRecord;
  onEdit: () => void;
  onDelete: () => void;
  formatPrice: (amount: number, currency: string) => string;
  formatTraffic: (bytes: number | null) => string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: t.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 transition-colors ${isDragging ? "opacity-80 shadow-md z-10" : ""}`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="flex h-8 w-8 shrink-0 cursor-grab active:cursor-grabbing items-center justify-center rounded-lg bg-muted/80 text-muted-foreground hover:bg-muted"
          {...attributes}
          {...listeners}
          title="Перетащите для изменения порядка"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
          <CreditCard className="h-4 w-4" />
        </span>
        <span className="font-medium">{t.name}</span>
        <span className="text-muted-foreground text-sm">{t.durationDays} дн.</span>
        <span className="font-semibold text-primary">
          {formatPrice(t.price ?? 0, t.currency ?? "usd")}
        </span>
        <span className="text-muted-foreground text-sm">сквадов: {t.internalSquadUuids.length}</span>
        <span className="text-muted-foreground text-sm">трафик: {formatTraffic(t.trafficLimitBytes)}</span>
        {t.deviceLimit != null && (
          <span className="text-muted-foreground text-sm">устройств: {t.deviceLimit}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="rounded-lg h-8" onClick={onEdit} title="Редактировать">
          <Pencil className="h-3.5 w-3.5 mr-1" />
          Изменить
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          title="Удалить"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

export function TariffsPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? null;

  const [categories, setCategories] = useState<TariffCategoryWithTariffs[]>([]);
  const [squads, setSquads] = useState<SquadOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [remnaConfigured, setRemnaConfigured] = useState<boolean | null>(null);

  const [categoryModal, setCategoryModal] = useState<"add" | { edit: TariffCategoryWithTariffs } | null>(null);
  const [tariffModal, setTariffModal] = useState<
    | { kind: "add"; categoryId: string }
    | { kind: "edit"; category: TariffCategoryWithTariffs; tariff: TariffRecord }
    | null
  >(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [status, cats, squadsRes] = await Promise.all([
        api.getRemnaStatus(token),
        api.getTariffCategories(token),
        api.getRemnaSquadsInternal(token).catch(() => ({ response: { internalSquads: [] } })),
      ]);
      setRemnaConfigured(status.configured);
      setCategories(cats.items);
      const res = squadsRes as { response?: { internalSquads?: { uuid?: string; name?: string }[] } };
      const list = res?.response?.internalSquads ?? (Array.isArray(res?.response) ? res.response : []);
      setSquads(Array.isArray(list) ? list.map((s) => ({ uuid: s.uuid ?? "", name: s.name })) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  const handleDeleteCategory = async (id: string) => {
    if (!token || !confirm("Удалить категорию и все тарифы в ней?")) return;
    try {
      await api.deleteTariffCategory(token, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleDeleteTariff = async (id: string) => {
    if (!token || !confirm("Удалить тариф?")) return;
    try {
      await api.deleteTariff(token, id);
      await load();
      setTariffModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleCategoryDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(categories, oldIndex, newIndex);
    setCategories(reordered);
    if (!token) return;
    try {
      await Promise.all(
        reordered.map((cat, index) =>
          api.updateTariffCategory(token, cat.id, { sortOrder: index })
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения порядка");
      load();
    }
  };

  const handleTariffDragEnd = async (
    event: DragEndEvent,
    category: TariffCategoryWithTariffs
  ) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const tariffs = category.tariffs;
    const oldIndex = tariffs.findIndex((t) => t.id === active.id);
    const newIndex = tariffs.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(tariffs, oldIndex, newIndex);
    setCategories((prev) =>
      prev.map((c) =>
        c.id === category.id ? { ...c, tariffs: reordered } : c
      )
    );
    if (!token) return;
    try {
      await Promise.all(
        reordered.map((t, index) =>
          api.updateTariff(token, t.id, { sortOrder: index })
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения порядка");
      load();
    }
  };

  if (loading && categories.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Тарифы</h1>
          <p className="text-muted-foreground mt-1">
            Категории тарифов и тарифы с указанием срока (1–360 дней), сквадов и лимитов
          </p>
        </div>
        <Button onClick={() => setCategoryModal("add")} className="rounded-xl shadow-sm shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Добавить категорию
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {remnaConfigured === false && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="pt-6">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Remna API не настроен. Сквады для тарифов подтягиваются из Remna — настройте REMNA_API_URL и REMNA_ADMIN_TOKEN в бэкенде.
            </p>
          </CardContent>
        </Card>
      )}

      {categories.length === 0 && !loading ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center py-8">
              Нет категорий. Создайте категорию тарифов, затем добавьте в неё тарифы (1–360 дней, сквады, лимиты).
            </p>
            <div className="flex justify-center">
              <Button onClick={() => setCategoryModal("add")}>
                <Plus className="h-4 w-4 mr-2" />
                Создать категорию
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleCategoryDragEnd}
        >
          <SortableContext
            items={categories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-4">
              {categories.map((cat) => (
                <SortableCategoryCard
                  key={cat.id}
                  cat={cat}
                  onEditCategory={() => setCategoryModal({ edit: cat })}
                  onDeleteCategory={() => handleDeleteCategory(cat.id)}
                  onAddTariff={() => setTariffModal({ kind: "add", categoryId: cat.id })}
                  onEditTariff={(t) => setTariffModal({ kind: "edit", category: cat, tariff: t })}
                  onDeleteTariff={handleDeleteTariff}
                  onTariffDragEnd={(e) => handleTariffDragEnd(e, cat)}
                  formatPrice={formatPrice}
                  formatTraffic={formatTraffic}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Модалка категории */}
      {categoryModal && (
        <CategoryModal
          token={token}
          modal={categoryModal}
          onClose={() => setCategoryModal(null)}
          onSaved={() => {
            setCategoryModal(null);
            load();
          }}
          saving={saving}
          setSaving={setSaving}
        />
      )}

      {/* Модалка тарифа */}
      {tariffModal && (
        <TariffModal
          token={token}
          squads={squads}
          modal={tariffModal}
          onClose={() => setTariffModal(null)}
          onSaved={() => {
            setTariffModal(null);
            load();
          }}
          saving={saving}
          setSaving={setSaving}
        />
      )}
    </div>
  );
}

function CategoryModal({
  token,
  modal,
  onClose,
  onSaved,
  saving,
  setSaving,
}: {
  token: string | null;
  modal: "add" | { edit: TariffCategoryWithTariffs };
  onClose: () => void;
  onSaved: () => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
}) {
  const isEdit = modal !== "add";
  const editCat = isEdit ? (modal as { edit: TariffCategoryWithTariffs }).edit : null;
  const [name, setName] = useState(editCat?.name ?? "");
  const [emojiKey, setEmojiKey] = useState<string>(editCat?.emojiKey ?? "");

  useEffect(() => {
    if (isEdit && editCat) {
      setName(editCat.name);
      setEmojiKey(editCat.emojiKey ?? "");
    } else {
      setName("");
      setEmojiKey("");
    }
  }, [modal, isEdit, editCat?.name, editCat?.emojiKey]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: name.trim(), emojiKey: emojiKey.trim() || null };
      if (isEdit) {
        await api.updateTariffCategory(token, (modal as { edit: TariffCategoryWithTariffs }).edit.id, payload);
      } else {
        await api.createTariffCategory(token, payload);
      }
      onSaved();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{isEdit ? "Редактировать категорию" : "Новая категория"}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit}>
          <Label htmlFor="cat-name">Название категории</Label>
          <Input
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Базовый"
            className="mt-1 mb-4"
            required
          />
          <Label htmlFor="cat-emoji" className="mt-2 block">Эмодзи (по коду)</Label>
          <select
            id="cat-emoji"
            value={emojiKey}
            onChange={(e) => setEmojiKey(e.target.value)}
            className="mt-1 mb-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">— без эмодзи —</option>
            <option value="ordinary">ordinary — 📦</option>
            <option value="premium">premium — ⭐</option>
          </select>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEdit ? "Сохранить" : "Создать"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TariffModal({
  token,
  squads,
  modal,
  onClose,
  onSaved,
  saving,
  setSaving,
}: {
  token: string | null;
  squads: SquadOption[];
  modal: { kind: "add"; categoryId: string } | { kind: "edit"; category: TariffCategoryWithTariffs; tariff: TariffRecord };
  onClose: () => void;
  onSaved: () => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
}) {
  const isEdit = modal.kind === "edit";
  const tariff = isEdit ? modal.tariff : null;
  const categoryId = isEdit ? modal.category.id : modal.categoryId;

  const [name, setName] = useState(tariff?.name ?? "");
  const [durationDays, setDurationDays] = useState(tariff?.durationDays ?? 30);
  const [selectedSquadUuids, setSelectedSquadUuids] = useState<string[]>(tariff?.internalSquadUuids ?? []);
  const [trafficGb, setTrafficGb] = useState<string>(
    tariff?.trafficLimitBytes != null ? String((tariff.trafficLimitBytes / BYTES_PER_GB).toFixed(2)) : ""
  );
  const [deviceLimit, setDeviceLimit] = useState<string>(tariff?.deviceLimit != null ? String(tariff.deviceLimit) : "");
  const [price, setPrice] = useState<string>(tariff?.price != null ? String(tariff.price) : "0");
  const [currency, setCurrency] = useState<string>((tariff?.currency ?? "usd").toLowerCase());

  useEffect(() => {
    if (isEdit && tariff) {
      setName(tariff.name);
      setDurationDays(tariff.durationDays);
      setSelectedSquadUuids(tariff.internalSquadUuids);
      setTrafficGb(tariff.trafficLimitBytes != null ? String((tariff.trafficLimitBytes / BYTES_PER_GB).toFixed(2)) : "");
      setDeviceLimit(tariff.deviceLimit != null ? String(tariff.deviceLimit) : "");
      setPrice(String(tariff.price ?? 0));
      setCurrency((tariff.currency ?? "usd").toLowerCase());
    } else {
      setName("");
      setDurationDays(30);
      setSelectedSquadUuids([]);
      setTrafficGb("");
      setDeviceLimit("");
      setPrice("0");
      setCurrency("usd");
    }
  }, [modal, isEdit, tariff]);

  const [squadsOpen, setSquadsOpen] = useState(false);
  const squadsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (squadsRef.current && !squadsRef.current.contains(e.target as Node)) {
        setSquadsOpen(false);
      }
    };
    if (squadsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [squadsOpen]);

  const toggleSquad = (uuid: string) => {
    setSelectedSquadUuids((prev) =>
      prev.includes(uuid) ? prev.filter((id) => id !== uuid) : [...prev, uuid]
    );
  };

  const selectedSquadsList = squads.filter((s) => selectedSquadUuids.includes(s.uuid));
  const squadsTriggerLabel =
    selectedSquadUuids.length === 0
      ? "Выберите сквады…"
      : selectedSquadUuids.length === 1
        ? selectedSquadsList[0]?.name || selectedSquadsList[0]?.uuid || "1 сквад"
        : `Выбрано: ${selectedSquadUuids.length}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim() || selectedSquadUuids.length === 0) return;
    const trafficLimitBytes =
      trafficGb.trim() !== "" ? Math.round(parseFloat(trafficGb) * BYTES_PER_GB) : null;
    const deviceLimitNum = deviceLimit.trim() !== "" ? parseInt(deviceLimit, 10) : null;
    if (deviceLimit.trim() !== "" && (isNaN(deviceLimitNum!) || deviceLimitNum! < 0)) return;
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) return;

    setSaving(true);
    try {
      if (isEdit && tariff) {
        const payload: UpdateTariffPayload = {
          name: name.trim(),
          durationDays,
          internalSquadUuids: selectedSquadUuids,
          trafficLimitBytes: trafficLimitBytes ?? null,
          deviceLimit: deviceLimitNum ?? null,
          price: priceNum,
          currency: currency || "usd",
        };
        await api.updateTariff(token, tariff.id, payload);
      } else {
        const payload: CreateTariffPayload = {
          categoryId,
          name: name.trim(),
          durationDays,
          internalSquadUuids: selectedSquadUuids,
          trafficLimitBytes: trafficLimitBytes ?? null,
          deviceLimit: deviceLimitNum ?? null,
          price: priceNum,
          currency: currency || "usd",
        };
        await api.createTariff(token, payload);
      }
      onSaved();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto py-8" onClick={onClose}>
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-lg p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{isEdit ? "Редактировать тариф" : "Новый тариф"}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="tariff-name">Название</Label>
            <Input
              id="tariff-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: 30 дней, 1 год"
              required
            />
          </div>
          <div>
            <Label htmlFor="tariff-days">Срок (дней)</Label>
            <Input
              id="tariff-days"
              type="number"
              min={1}
              max={3650}
              value={durationDays}
              onChange={(e) => setDurationDays(parseInt(e.target.value, 10) || 1)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tariff-price">Цена</Label>
              <Input
                id="tariff-price"
                type="number"
                min={0}
                step={0.01}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="tariff-currency">Валюта</Label>
              <select
                id="tariff-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div ref={squadsRef} className="relative">
            <Label>Сквады (Remna)</Label>
            <p className="text-xs text-muted-foreground mb-1.5">Один или несколько внутренних сквадов</p>
            {squads.length === 0 ? (
              <div className="flex h-10 items-center rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground">
                Список сквадов пуст или Remna не настроен
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setSquadsOpen((o) => !o)}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className={selectedSquadUuids.length === 0 ? "text-muted-foreground" : ""}>
                    {squadsTriggerLabel}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${squadsOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {squadsOpen && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-background shadow-lg">
                    <div className="max-h-48 overflow-y-auto p-1">
                      {squads.map((s) => {
                        const checked = selectedSquadUuids.includes(s.uuid);
                        return (
                          <button
                            key={s.uuid}
                            type="button"
                            onClick={() => toggleSquad(s.uuid)}
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:outline-none"
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                checked ? "bg-primary border-primary text-primary-foreground" : "border-input"
                              }`}
                            >
                              {checked ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <span className="truncate">{s.name || s.uuid}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <Label htmlFor="tariff-traffic">Лимит трафика (ГБ)</Label>
            <Input
              id="tariff-traffic"
              type="number"
              min={0}
              step={0.1}
              value={trafficGb}
              onChange={(e) => setTrafficGb(e.target.value)}
              placeholder="Не ограничено"
            />
            <p className="text-xs text-muted-foreground mt-1">1 ГБ = 1024³ байт (ГиБ). В Remna передаётся лимит в байтах.</p>
          </div>
          <div>
            <Label htmlFor="tariff-devices">Лимит устройств</Label>
            <Input
              id="tariff-devices"
              type="number"
              min={0}
              value={deviceLimit}
              onChange={(e) => setDeviceLimit(e.target.value)}
              placeholder="Не ограничено"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={saving || selectedSquadUuids.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEdit ? "Сохранить" : "Создать"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
