/**
 * Zustand сторы для UI-состояния, которое раньше жило в десятке useState
 * или тянулось из localStorage вручную.
 *
 * clientUi: предпочтения клиента (тема/язык/валюта/акцент дублируются в
 * localStorage через contexts/theme — тут только runtime-состояние интерфейса,
 * которое должно переживать unmount компонента, но не обязательно перезагрузку).
 */
import { create } from "zustand";

/** UI-состояние кабинета: открытые модалки, активные табы, временные выборы. */
interface CabinetUiState {
  /** Открыто ли меню пользователя в шапке (закрытие по клику вне — в компоненте). */
  userMenuOpen: boolean;
  toggleUserMenu: () => void;
  setUserMenu: (open: boolean) => void;

  /** Extend-диалог подписки: id подписки или null (единый на весь кабинет). */
  extendSubscriptionId: string | null;
  setExtendSubscriptionId: (id: string | null) => void;

  /** Счётчик «данные изменились» — триггер рефетча для вне-query кода. */
  refreshTick: number;
  bumpRefresh: () => void;
}

export const useCabinetUi = create<CabinetUiState>((set) => ({
  userMenuOpen: false,
  toggleUserMenu: () => set((s) => ({ userMenuOpen: !s.userMenuOpen })),
  setUserMenu: (open) => set({ userMenuOpen: open }),

  extendSubscriptionId: null,
  setExtendSubscriptionId: (id) => set({ extendSubscriptionId: id }),

  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));

/** Ленивое persist-хранилище: вынесенные из localStorage ключи UI-предпочтений. */
interface PersistedUiState {
  /** Схлопнутые секции профиля. */
  collapsedSections: Record<string, boolean>;
  toggleSection: (id: string) => void;
}

const COLLAPSED_KEY = "stealthnet-ui-collapsed";

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveCollapsed(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export const usePersistedUi = create<PersistedUiState>((set) => ({
  collapsedSections: loadCollapsed(),
  toggleSection: (id) =>
    set((s) => {
      const next = { ...s.collapsedSections, [id]: !s.collapsedSections[id] };
      saveCollapsed(next);
      return { collapsedSections: next };
    }),
}));
