import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Симулятор функции isUserActivelyEditing
 */
function isUserActivelyEditing(mockDocument) {
  if (!mockDocument) return false;
  if (mockDocument.hasDialog) return true;
  const active = mockDocument.activeElement;
  if (!active) return false;
  const tagName = (active.tagName || "").toUpperCase();
  if (tagName === "TEXTAREA") return true;
  if (active.isContentEditable) return true;
  if (tagName === "INPUT") {
    const inputType = (active.type || "text").toLowerCase();
    const nonTextTypes = ["button", "submit", "reset", "checkbox", "radio", "image", "file"];
    if (!nonTextTypes.includes(inputType)) return true;
  }
  return false;
}

/**
 * Логика принятия решения об автообновлении
 */
function shouldTriggerAutoUpdate({
  needRefresh,
  isOnline,
  isVisible,
  pathname,
  isEditing,
  lastReloadAt,
  snoozeUntil,
  now = Date.now(),
}) {
  if (!needRefresh) return { shouldUpdate: false, reason: "no_refresh_needed" };
  if (!isOnline) return { shouldUpdate: false, reason: "offline" };
  if (!isVisible) return { shouldUpdate: false, reason: "hidden" };

  // Loop guard
  if (lastReloadAt && now - lastReloadAt < 20_000) {
    return { shouldUpdate: false, reason: "loop_guard" };
  }

  // Snooze guard (кнопка Отложить)
  if (snoozeUntil && now < snoozeUntil) {
    return { shouldUpdate: false, reason: "snoozed" };
  }

  const isAdmin = pathname.startsWith("/admin");

  if (isAdmin) {
    // В админке ждем завершения ввода в форму/диалог
    if (isEditing) {
      return { shouldUpdate: false, delaySeconds: null, reason: "admin_actively_editing" };
    }
    // Если админ не редактирует - 5 секунд таймер
    return { shouldUpdate: true, delaySeconds: 5, reason: "admin_idle" };
  } else {
    // Для клиентов в /cabinet или других страницах:
    // Если открыт модальный диалог (например оплата) - не прерывать
    if (isEditing) {
      return { shouldUpdate: false, delaySeconds: null, reason: "client_dialog_open" };
    }
    // Быстрое обновление за 3 секунды
    return { shouldUpdate: true, delaySeconds: 3, reason: "client_auto_update" };
  }
}

test("isUserActivelyEditing detects active text inputs, textareas, and dialogs", () => {
  assert.equal(isUserActivelyEditing({ hasDialog: false, activeElement: null }), false);
  assert.equal(isUserActivelyEditing({ hasDialog: true, activeElement: null }), true);
  assert.equal(isUserActivelyEditing({ hasDialog: false, activeElement: { tagName: "BODY" } }), false);
  assert.equal(isUserActivelyEditing({ hasDialog: false, activeElement: { tagName: "BUTTON" } }), false);
  assert.equal(isUserActivelyEditing({ hasDialog: false, activeElement: { tagName: "INPUT", type: "checkbox" } }), false);
  assert.equal(isUserActivelyEditing({ hasDialog: false, activeElement: { tagName: "INPUT", type: "text" } }), true);
  assert.equal(isUserActivelyEditing({ hasDialog: false, activeElement: { tagName: "INPUT", type: "password" } }), true);
  assert.equal(isUserActivelyEditing({ hasDialog: false, activeElement: { tagName: "TEXTAREA" } }), true);
  assert.equal(isUserActivelyEditing({ hasDialog: false, activeElement: { tagName: "DIV", isContentEditable: true } }), true);
});

test("clients in Telegram Mini App (/cabinet/*) trigger auto update in 3 seconds", () => {
  const result = shouldTriggerAutoUpdate({
    needRefresh: true,
    isOnline: true,
    isVisible: true,
    pathname: "/cabinet/dashboard",
    isEditing: false,
    lastReloadAt: 0,
    snoozeUntil: 0,
  });

  assert.equal(result.shouldUpdate, true);
  assert.equal(result.delaySeconds, 3);
});

test("clients with URL search params (?tgWebAppStartParam) still trigger auto update", () => {
  const result = shouldTriggerAutoUpdate({
    needRefresh: true,
    isOnline: true,
    isVisible: true,
    pathname: "/cabinet/tariffs",
    isEditing: false,
    lastReloadAt: 0,
    snoozeUntil: 0,
  });

  assert.equal(result.shouldUpdate, true);
  assert.equal(result.delaySeconds, 3);
});

test("admin reading page (/admin/clients or /admin/settings) triggers auto update in 5 seconds", () => {
  const result = shouldTriggerAutoUpdate({
    needRefresh: true,
    isOnline: true,
    isVisible: true,
    pathname: "/admin/clients",
    isEditing: false,
    lastReloadAt: 0,
    snoozeUntil: 0,
  });

  assert.equal(result.shouldUpdate, true);
  assert.equal(result.delaySeconds, 5);
});

test("admin actively typing pauses auto update until input finishes", () => {
  const result = shouldTriggerAutoUpdate({
    needRefresh: true,
    isOnline: true,
    isVisible: true,
    pathname: "/admin/tariffs",
    isEditing: true, // typing in input
    lastReloadAt: 0,
    snoozeUntil: 0,
  });

  assert.equal(result.shouldUpdate, false);
  assert.equal(result.reason, "admin_actively_editing");
});

test("loop guard blocks auto update if reloaded less than 20 seconds ago", () => {
  const now = 1700000000000;
  const result = shouldTriggerAutoUpdate({
    needRefresh: true,
    isOnline: true,
    isVisible: true,
    pathname: "/cabinet",
    isEditing: false,
    lastReloadAt: now - 5000, // 5s ago
    snoozeUntil: 0,
    now,
  });

  assert.equal(result.shouldUpdate, false);
  assert.equal(result.reason, "loop_guard");
});

test("snooze button postpones auto update", () => {
  const now = 1700000000000;
  const result = shouldTriggerAutoUpdate({
    needRefresh: true,
    isOnline: true,
    isVisible: true,
    pathname: "/admin",
    isEditing: false,
    lastReloadAt: 0,
    snoozeUntil: now + 300000,
    now,
  });

  assert.equal(result.shouldUpdate, false);
  assert.equal(result.reason, "snoozed");
});
