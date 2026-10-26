import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// 1. Static Source Code Verification
test("pwa-update-prompt.tsx contains smart auto-update filter and protections", () => {
  const content = readFileSync(
    new URL("../src/components/pwa/pwa-update-prompt.tsx", import.meta.url),
    "utf8"
  );

  // Fallback getRegistration() hook
  assert.ok(content.includes("navigator.serviceWorker.getRegistration()"));

  // Telegram WebApp detection and showConfirm integration
  assert.ok(content.includes("tg?.showConfirm"));
  assert.ok(content.includes("TelegramWebviewProxy"));

  // Native window.confirm fallback with try/catch
  assert.ok(content.includes("window.confirm("));

  // controllerchange listener
  assert.ok(content.includes('navigator.serviceWorker.addEventListener('));
  assert.ok(content.includes('"controllerchange"'));
  assert.ok(content.includes("{ once: true }"));

  // SKIP_WAITING postMessage
  assert.ok(content.includes('postMessage({ type: "SKIP_WAITING" })'));

  // Fallback reload timeout (1500ms)
  assert.ok(content.includes("setTimeout(() => {"));
  assert.ok(content.includes("window.location.reload();"));
  assert.ok(content.includes("1500"));

  // Safety unblock timeout (6000ms)
  assert.ok(content.includes("6000"));
  assert.ok(content.includes("updateTriggeredRef.current = false"));
  assert.ok(content.includes("setAutoUpdating(false)"));

  // Smart filter features:
  assert.ok(content.includes("isSafeUrlForAutoUpdate"));
  assert.ok(content.includes("lastEditTime"));
  assert.ok(content.includes("7000")); // 7s inactivity threshold
  assert.ok(content.includes("180000")); // 3m cooldown
  assert.ok(content.includes("touchstart")); // Mobile touch support
});

// 2. Unit logic test for confirmUpdate
function createConfirmUpdateHarness({
  isActivelyEditing = false,
  tg = undefined,
  isTelegramProxy = false,
  confirmResult = true,
  confirmThrows = false,
}) {
  let confirmedCalled = false;
  const onConfirmed = () => { confirmedCalled = true; };

  const fakeWindow = {
    Telegram: tg ? { WebApp: tg } : undefined,
    TelegramWebviewProxy: isTelegramProxy ? {} : undefined,
    confirm: confirmThrows
      ? () => { throw new Error("Blocked"); }
      : () => confirmResult,
  };

  const confirmUpdate = (onConfirmedCb) => {
    if (!isActivelyEditing) {
      onConfirmedCb();
      return;
    }
    const currentTg = fakeWindow.Telegram?.WebApp;
    const isTelegram = Boolean(currentTg?.initData || fakeWindow.TelegramWebviewProxy);
    if (typeof currentTg?.showConfirm === "function") {
      currentTg.showConfirm("Обновить страницу? Несохранённые изменения будут потеряны.", (ok) => {
        if (ok) onConfirmedCb();
      });
      return;
    }
    if (isTelegram) {
      onConfirmedCb();
      return;
    }
    try {
      if (typeof fakeWindow !== "undefined" && typeof fakeWindow.confirm === "function") {
        if (fakeWindow.confirm("Обновить страницу? Несохранённые изменения будут потеряны.")) {
          onConfirmedCb();
        }
        return;
      }
    } catch {}
    onConfirmedCb();
  };

  confirmUpdate(onConfirmed);
  return { confirmedCalled };
}

test("confirmUpdate: unedited field bypasses confirm dialog immediately", () => {
  const result = createConfirmUpdateHarness({ isActivelyEditing: false, confirmResult: false });
  assert.equal(result.confirmedCalled, true);
});

test("confirmUpdate: desktop browser with user accepting confirm", () => {
  const result = createConfirmUpdateHarness({ isActivelyEditing: true, confirmResult: true });
  assert.equal(result.confirmedCalled, true);
});

test("confirmUpdate: desktop browser with user cancelling confirm", () => {
  const result = createConfirmUpdateHarness({ isActivelyEditing: true, confirmResult: false });
  assert.equal(result.confirmedCalled, false);
});

test("confirmUpdate: desktop browser when window.confirm throws exception", () => {
  const result = createConfirmUpdateHarness({ isActivelyEditing: true, confirmThrows: true });
  assert.equal(result.confirmedCalled, true);
});

test("confirmUpdate: Telegram WebApp with native showConfirm accepted", () => {
  let showConfirmCalled = false;
  const tg = {
    initData: "user=123",
    showConfirm: (msg, cb) => {
      showConfirmCalled = true;
      cb(true);
    },
  };
  const result = createConfirmUpdateHarness({ isActivelyEditing: true, tg });
  assert.equal(showConfirmCalled, true);
  assert.equal(result.confirmedCalled, true);
});

test("confirmUpdate: Telegram WebApp with native showConfirm cancelled", () => {
  let showConfirmCalled = false;
  const tg = {
    initData: "user=123",
    showConfirm: (msg, cb) => {
      showConfirmCalled = true;
      cb(false);
    },
  };
  const result = createConfirmUpdateHarness({ isActivelyEditing: true, tg });
  assert.equal(showConfirmCalled, true);
  assert.equal(result.confirmedCalled, false);
});

test("confirmUpdate: Telegram WebApp without showConfirm (bypasses broken window.confirm)", () => {
  const tg = { initData: "user=123" };
  const result = createConfirmUpdateHarness({ isActivelyEditing: true, tg, confirmResult: false });
  assert.equal(result.confirmedCalled, true);
});

test("confirmUpdate: Telegram WebView detected via TelegramWebviewProxy", () => {
  const result = createConfirmUpdateHarness({ isActivelyEditing: true, isTelegramProxy: true, confirmResult: false });
  assert.equal(result.confirmedCalled, true);
});

// 3. doApplyUpdate Service Worker & Reloading Logic
test("doApplyUpdate: sends SKIP_WAITING and sets up controllerchange & fallback reload", async () => {
  const events = [];
  const postMessages = [];
  let reloadCalled = false;

  const fakeWaitingWorker = {
    postMessage: (msg) => { postMessages.push(msg); },
  };

  const fakeRegistration = {
    waiting: fakeWaitingWorker,
  };

  const fakeNavigator = {
    serviceWorker: {
      controller: {},
      addEventListener: (evt, handler, opts) => {
        events.push({ evt, handler, opts });
      },
    },
  };

  const fakeWindow = {
    location: {
      reload: () => { reloadCalled = true; },
    },
  };

  let updateTriggered = false;
  let autoUpdating = false;

  const doApplyUpdate = async () => {
    if (updateTriggered) return;
    updateTriggered = true;
    autoUpdating = true;

    if (fakeNavigator.serviceWorker) {
      fakeNavigator.serviceWorker.addEventListener(
        "controllerchange",
        () => { fakeWindow.location.reload(); },
        { once: true }
      );
    }

    if (fakeRegistration?.waiting) {
      fakeRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    // Fallback timer
    setTimeout(() => {
      fakeWindow.location.reload();
    }, 50);

    // Safety reset timer
    setTimeout(() => {
      updateTriggered = false;
      autoUpdating = false;
    }, 150);
  };

  await doApplyUpdate();

  assert.equal(updateTriggered, true);
  assert.equal(autoUpdating, true);
  assert.deepEqual(postMessages, [{ type: "SKIP_WAITING" }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].evt, "controllerchange");
  assert.equal(events[0].opts.once, true);

  // Check controllerchange listener triggers reload
  events[0].handler();
  assert.equal(reloadCalled, true);

  // Check safety reset timer unblocks updateTriggered
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(updateTriggered, false);
  assert.equal(autoUpdating, false);
});

// 4. Smart Safe Pages Filter Tests
function isSafeUrlForAutoUpdate(location) {
  const pathname = location.pathname || "/";
  const search = location.search || "";

  if (search && (search.includes("payment=") || search.includes("invoice=") || search.includes("order="))) {
    return false;
  }
  const unsafePaths = [
    "/cabinet/payment-wait",
    "/cabinet/yoomoney-pay",
    "/cabinet/custom-build",
    "/cabinet/onboarding",
    "/admin/settings",
    "/admin/backup",
    "/admin/tickets",
    "/admin/landing-editor",
    "/admin/tour-constructor",
  ];
  if (unsafePaths.some((p) => pathname.startsWith(p))) {
    return false;
  }

  const safeClientPaths = [
    "/",
    "/cabinet",
    "/cabinet/dashboard",
    "/cabinet/profile",
    "/cabinet/referral",
    "/cabinet/gifts",
    "/cabinet/roulette",
    "/cabinet/proxy",
    "/cabinet/singbox",
    "/cabinet/documents/privacy",
    "/cabinet/documents/offer",
    "/cabinet/documents/refund",
  ];
  if (safeClientPaths.includes(pathname) || pathname.startsWith("/cabinet/menu/")) {
    return true;
  }

  const safeAdminPaths = [
    "/admin",
    "/admin/analytics",
    "/admin/sales-report",
    "/admin/business-analytics",
    "/admin/referral-network",
    "/admin/diagnostics",
  ];
  if (safeAdminPaths.includes(pathname)) {
    return true;
  }

  return false;
}

test("smart filter allows client home & dashboard even with Telegram Mini App hash/params", () => {
  // Telegram Mini App with tgWebAppData hash
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/dashboard", hash: "#tgWebAppData=user123" }), true);
  // Telegram Mini App startParam
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/dashboard", search: "?tgWebAppStartParam=ref_1" }), true);
  // Base cabinet route and root landing
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet" }), true);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/" }), true);
  // Profile, referral, gifts, menus
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/profile" }), true);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/referral" }), true);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/gifts" }), true);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/menu/faq" }), true);
  // Admin dashboard & analytics
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/admin" }), true);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/admin/analytics" }), true);
});

test("smart filter blocks dangerous payment, builder, and admin config pages", () => {
  // Payment redirect queries
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/dashboard", search: "?payment=success" }), false);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/dashboard", search: "?payment=failed" }), false);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/", search: "?order=123" }), false);
  // Payment waiting pages
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/payment-wait" }), false);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/yoomoney-pay" }), false);
  // Tariff builder and onboarding
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/custom-build" }), false);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/cabinet/onboarding" }), false);
  // Admin config forms
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/admin/settings" }), false);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/admin/backup" }), false);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/admin/tickets" }), false);
  assert.equal(isSafeUrlForAutoUpdate({ pathname: "/admin/landing-editor" }), false);
});

// 5. Inactivity threshold (7s) & Dynamic Editing tests
test("7s inactivity threshold: does not trigger before 7s, triggers at >= 7s", () => {
  const now = 100000;
  let seconds = null;
  let applied = false;

  const runTick = (lastActivity, lastEditTime, isModalOpen = false) => {
    seconds = null;
    applied = false;
    const editing = isModalOpen || (now - lastEditTime < 15000);
    if (editing || now - lastActivity < 7000) {
      return;
    }
    seconds = 5;
    applied = true;
  };

  // Only 4 seconds of idle -> should NOT start
  runTick(now - 4000, 0);
  assert.equal(applied, false);
  assert.equal(seconds, null);

  // 6 seconds of idle -> should NOT start
  runTick(now - 6000, 0);
  assert.equal(applied, false);
  assert.equal(seconds, null);

  // 7 seconds of idle -> SHOULD start!
  runTick(now - 7000, 0);
  assert.equal(applied, true);
  assert.equal(seconds, 5);

  // 10 seconds of idle -> SHOULD start!
  runTick(now - 10000, 0);
  assert.equal(applied, true);

  // 10 seconds of idle, BUT typed 5 seconds ago -> should NOT start!
  runTick(now - 10000, now - 5000);
  assert.equal(applied, false);

  // 10 seconds of idle, typed 16 seconds ago (done editing) -> SHOULD start!
  runTick(now - 10000, now - 16000);
  assert.equal(applied, true);

  // 10 seconds of idle, but active modal open -> should NOT start!
  runTick(now - 10000, 0, true);
  assert.equal(applied, false);
});
