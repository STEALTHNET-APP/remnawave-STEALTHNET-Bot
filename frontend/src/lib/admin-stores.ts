/**
 * Zustand-сторы админ-панели: кросс-компонентный UI-state, который раньше
 * жил в пропсах/useState верхнего уровня страницы.
 *
 * Сессионное хранилище (без persist): выделение клиентов, модалки, refresh-сигнал.
 */
import { create } from "zustand";

/** Выделение клиентов для bulk-операций на /admin/clients. */
interface AdminSelectionState {
  selectedClientIds: string[];
  toggleClientSelected: (id: string) => void;
  setSelectedClients: (ids: string[]) => void;
  clearSelectedClients: () => void;
}

export const useAdminSelection = create<AdminSelectionState>((set) => ({
  selectedClientIds: [],
  toggleClientSelected: (id) =>
    set((s) => ({
      selectedClientIds: s.selectedClientIds.includes(id)
        ? s.selectedClientIds.filter((x) => x !== id)
        : [...s.selectedClientIds, id],
    })),
  setSelectedClients: (ids) => set({ selectedClientIds: ids }),
  clearSelectedClients: () => set({ selectedClientIds: [] }),
}));

/** Глобальный сигнал «данные изменились» для вне-query кода (легаси-колбеки). */
interface AdminUiState {
  refreshTick: number;
  bumpRefresh: () => void;
  /** ID открытой модалки/дровера (для закрытия по Escape вне фокуса). */
  activeModal: string | null;
  setActiveModal: (id: string | null) => void;
}

export const useAdminUi = create<AdminUiState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  activeModal: null,
  setActiveModal: (id) => set({ activeModal: id }),
}));
