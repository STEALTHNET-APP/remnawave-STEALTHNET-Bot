export const AUTO_RELOAD_KEY = "pwa_last_auto_reload";
export const SNOOZE_KEY = "pwa_snooze_until";
const TELEGRAM_INVOICE_KEY = "stealthnet_telegram_invoice_open";

export const AUTO_RELOAD_COOLDOWN_MS = 5 * 60 * 1000;
export const SNOOZE_MS = 15 * 60 * 1000;
export const EDIT_GRACE_MS = 15 * 1000;
export const COLD_START_MS = 15 * 1000;
export const LONG_SESSION_MS = 2 * 60 * 1000;
const TELEGRAM_INVOICE_MAX_AGE_MS = 15 * 60 * 1000;

const PAYMENT_PARAM_NAMES = [
  "payment", "paymentid", "payment_id",
  "invoice", "invoiceid", "invoice_id",
  "order", "orderid", "order_id",
  "yookassa", "heleket", "rollypay", "cispay", "paritypay",
  "lava", "lavatop", "overpay", "yoomoney_form",
  "cryptopay", "stars", "redirect",
];
const PAYMENT_PATH_PREFIXES = [
  "/cabinet/payment-wait",
  "/cabinet/yoomoney-pay",
  "/cabinet/payment",
  "/cabinet/subscribe",
];
const BLOCKED_PATH_PREFIXES = [
  "/cabinet/custom-build",
  "/cabinet/onboarding",
  "/admin/settings",
  "/admin/backup",
  "/admin/tickets",
  "/admin/landing-editor",
  "/admin/tour-constructor",
];
const OVERLAY_SELECTORS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  "dialog[open]",
  '[aria-modal="true"]',
  ".au-sheet-overlay",
  ".app-viewport-overlay",
  ".admin-command",
  ".cabinet-floating-chat",
  ".cabinet-ticket-conversation",
  '[data-tour="floating-chat"]',
  "[data-pwa-block-update]",
];
const editableSelector = 'input:not([type=hidden]), textarea, select, [contenteditable="true"], [contenteditable=""]';

export type SafeLocation = {
  pathname: string;
  search?: string;
  hash?: string;
};

export function readSessionTime(key: string): number {
  try {
    return Number(sessionStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function matchesPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function hasPaymentSearchParams(search = ""): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  return Array.from(params.entries()).some(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    const normalizedValue = value.toLowerCase();
    return PAYMENT_PARAM_NAMES.some(name => normalizedKey.includes(name) || normalizedValue.includes(name));
  });
}

export function isSafeUrlForAutoUpdate(location: SafeLocation): boolean {
  const pathname = location.pathname || "/";
  if (PAYMENT_PATH_PREFIXES.some(prefix => matchesPath(pathname, prefix))) return false;
  if (BLOCKED_PATH_PREFIXES.some(prefix => matchesPath(pathname, prefix))) return false;
  return !hasPaymentSearchParams(location.search || "");
}

export function isTelegramInvoiceOpen(now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  const globalOpenedAt = (window as { __stealthnet_telegram_invoice_opened_at?: number }).__stealthnet_telegram_invoice_opened_at || 0;
  const openedAt = Math.max(globalOpenedAt, readSessionTime(TELEGRAM_INVOICE_KEY));
  return openedAt > 0 && now - openedAt < TELEGRAM_INVOICE_MAX_AGE_MS;
}

function editableValue(element: Element): string {
  if (element instanceof HTMLInputElement) {
    return element.type === "checkbox" || element.type === "radio" ? String(element.checked) : element.value;
  }
  if (element instanceof HTMLTextAreaElement) return element.value;
  if (element instanceof HTMLSelectElement) return JSON.stringify(Array.from(element.selectedOptions, option => option.value));
  return element.innerHTML;
}

function defaultEditableValue(element: Element): string | undefined {
  if (element instanceof HTMLInputElement) {
    return element.type === "checkbox" || element.type === "radio" ? String(element.defaultChecked) : element.defaultValue;
  }
  if (element instanceof HTMLTextAreaElement) return element.defaultValue;
  if (element instanceof HTMLSelectElement) {
    const selected = Array.from(element.options).filter(option => option.defaultSelected);
    return JSON.stringify((selected.length || element.multiple ? selected : Array.from(element.options).slice(0, 1)).map(option => option.value));
  }
  return undefined;
}

export function createEditTracker() {
  const baseline = new WeakMap<Element, string | undefined>();
  const changed = new Set<Element>();
  const target = (event: Event) => event.target instanceof Element ? event.target.closest(editableSelector) : null;
  return {
    focus(event: Event) {
      const element = target(event);
      if (element && !changed.has(element)) baseline.set(element, editableValue(element));
    },
    edit(event: Event) {
      const element = target(event);
      if (!element) return;
      if (!baseline.has(element)) baseline.set(element, defaultEditableValue(element));
      if (editableValue(element) === baseline.get(element)) changed.delete(element);
      else changed.add(element);
    },
    hasChanges() {
      for (const element of changed) {
        if (!element.isConnected || editableValue(element) === baseline.get(element)) changed.delete(element);
      }
      return changed.size > 0;
    },
  };
}

function isVisible(element: Element): boolean {
  return element.getClientRects().length > 0;
}

export function hasOpenOverlay(): boolean {
  if (typeof document === "undefined") return false;
  return OVERLAY_SELECTORS.some(selector =>
    Array.from(document.querySelectorAll(selector)).some(isVisible),
  );
}

export function hasFileUploadInProgress(): boolean {
  if (typeof document === "undefined") return false;
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).some(input => (input.files?.length ?? 0) > 0);
}

export function hasUnsavedFormInput(): boolean {
  if (typeof document === "undefined") return false;
  return Array.from(document.querySelectorAll(editableSelector)).some(element => {
    const initial = defaultEditableValue(element);
    return initial !== undefined && editableValue(element) !== initial;
  });
}

export function isUserActivelyEditing(now = Date.now(), lastEditTime = 0): boolean {
  if (typeof document !== "undefined") {
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.matches("input, textarea, select") || active.isContentEditable)) return true;
  }
  return now - lastEditTime < EDIT_GRACE_MS;
}

export type UpdateSafetyOptions = {
  location?: SafeLocation;
  now?: number;
  lastEditTime?: number;
  hasTrackedChanges?: boolean;
};

export function canSafelyApplyUpdate(options: UpdateSafetyOptions = {}): boolean {
  const now = options.now ?? Date.now();
  const location = options.location ?? (typeof window !== "undefined" ? window.location : undefined);
  if (!location) return false;
  if (isTelegramInvoiceOpen(now)) return false;
  if (isUserActivelyEditing(now, options.lastEditTime ?? 0)) return false;
  if (options.hasTrackedChanges || hasUnsavedFormInput()) return false;
  if (hasOpenOverlay()) return false;
  if (hasFileUploadInProgress()) return false;
  if (!isSafeUrlForAutoUpdate(location)) return false;
  if (now < readSessionTime(SNOOZE_KEY)) return false;
  if (now - readSessionTime(AUTO_RELOAD_KEY) < AUTO_RELOAD_COOLDOWN_MS) return false;
  return true;
}

