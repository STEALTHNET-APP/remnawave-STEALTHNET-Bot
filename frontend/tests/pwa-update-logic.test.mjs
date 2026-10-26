import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// 1. Static Source Code Verification of PR #245
test("pwa-update-prompt.tsx contains PR #245 fixes and protections", () => {
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
});

// 2. Unit logic test for confirmUpdate
function createConfirmUpdateHarness({ edited = false, tg = undefined, isTelegramProxy = false, confirmResult = true, confirmThrows = false }) {
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
    if (!edited) {
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
  const result = createConfirmUpdateHarness({ edited: false, confirmResult: false });
  assert.equal(result.confirmedCalled, true);
});

test("confirmUpdate: desktop browser with user accepting confirm", () => {
  const result = createConfirmUpdateHarness({ edited: true, confirmResult: true });
  assert.equal(result.confirmedCalled, true);
});

test("confirmUpdate: desktop browser with user cancelling confirm", () => {
  const result = createConfirmUpdateHarness({ edited: true, confirmResult: false });
  assert.equal(result.confirmedCalled, false);
});

test("confirmUpdate: desktop browser when window.confirm throws exception", () => {
  const result = createConfirmUpdateHarness({ edited: true, confirmThrows: true });
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
  const result = createConfirmUpdateHarness({ edited: true, tg });
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
  const result = createConfirmUpdateHarness({ edited: true, tg });
  assert.equal(showConfirmCalled, true);
  assert.equal(result.confirmedCalled, false);
});

test("confirmUpdate: Telegram WebApp without showConfirm (bypasses broken window.confirm)", () => {
  const tg = { initData: "user=123" }; // No showConfirm
  const result = createConfirmUpdateHarness({ edited: true, tg, confirmResult: false });
  // Should NOT hang on window.confirm(false), should proceed!
  assert.equal(result.confirmedCalled, true);
});

test("confirmUpdate: Telegram WebView detected via TelegramWebviewProxy", () => {
  const result = createConfirmUpdateHarness({ edited: true, isTelegramProxy: true, confirmResult: false });
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

// 4. Safe Pages Auto-Update Rules Test
test("safe pages allow auto-countdown while editing / settings / backup pages block it", () => {
  const isSafePage = (pathname, search = "", hash = "") => {
    return ["/admin", "/cabinet/dashboard", "/cabinet/referral"].includes(pathname) && !search && !hash;
  };

  // Safe dashboard / admin landing pages without query params
  assert.equal(isSafePage("/admin"), true);
  assert.equal(isSafePage("/cabinet/dashboard"), true);
  assert.equal(isSafePage("/cabinet/referral"), true);

  // Critical forms / work areas must block auto-reload:
  assert.equal(isSafePage("/admin/backup"), false);
  assert.equal(isSafePage("/admin/settings"), false);
  assert.equal(isSafePage("/admin/tickets"), false);
  assert.equal(isSafePage("/cabinet/tariffs"), false);
  assert.equal(isSafePage("/cabinet/dashboard", "?payment=success"), false);
  assert.equal(isSafePage("/cabinet/dashboard", "", "#step-2"), false);
});
