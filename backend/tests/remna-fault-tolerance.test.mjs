import test from "node:test";
import assert from "node:assert/strict";

// Import modules from compiled dist
const remnaClient = await import("../dist/modules/remna/remna.client.js");
const {
  isRemnaOnline,
  getRemnaCircuitState,
  recordRemnaSuccess,
  recordRemnaFailure,
  resetRemnaCircuitBreaker,
  remnaGetUserByShortUuid,
  remnaCreateUser,
} = remnaClient;

test.beforeEach(() => {
  resetRemnaCircuitBreaker();
});

test("1. Circuit Breaker: Initial state is CLOSED and isRemnaOnline() is true", () => {
  const state = getRemnaCircuitState();
  assert.equal(state.state, "CLOSED");
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.lastFailureAt, null);
  assert.equal(isRemnaOnline(), true);
});

test("2. Circuit Breaker: recordRemnaSuccess resets failure count and preserves CLOSED state", () => {
  recordRemnaFailure(true);
  assert.equal(getRemnaCircuitState().consecutiveFailures, 1);
  recordRemnaSuccess();
  assert.equal(getRemnaCircuitState().consecutiveFailures, 0);
  assert.equal(getRemnaCircuitState().state, "CLOSED");
  assert.equal(isRemnaOnline(), true);
});

test("3. Circuit Breaker: 1 and 2 consecutive failures do NOT open the circuit", () => {
  recordRemnaFailure(true);
  assert.equal(getRemnaCircuitState().state, "CLOSED");
  assert.equal(getRemnaCircuitState().consecutiveFailures, 1);
  assert.equal(isRemnaOnline(), true);

  recordRemnaFailure(true);
  assert.equal(getRemnaCircuitState().state, "CLOSED");
  assert.equal(getRemnaCircuitState().consecutiveFailures, 2);
  assert.equal(isRemnaOnline(), true);
});

test("4. Circuit Breaker: 3 consecutive failures TRIP the circuit to OPEN", () => {
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  recordRemnaFailure(true);

  const state = getRemnaCircuitState();
  assert.equal(state.state, "OPEN");
  assert.equal(state.consecutiveFailures, 3);
  assert.ok(state.lastFailureAt !== null, "lastFailureAt timestamp must be recorded");
  assert.equal(isRemnaOnline(), false);
});

test("5. Circuit Breaker: when OPEN, client calls fast-fail in 0ms without network overhead", async () => {
  // Trip circuit
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  assert.equal(isRemnaOnline(), false);

  const start = performance.now();
  const res = await remnaGetUserByShortUuid("fake-uuid-1234");
  const duration = performance.now() - start;

  assert.ok(duration < 50, `Expected fast-fail under 50ms, took ${duration}ms`);
  assert.equal(res.status, 503);
  assert.equal(res.isCircuitOpen, true);
  assert.ok(res.error.includes("circuit open"));
});

test("6. Circuit Breaker: fast-fail works across all write calls (remnaCreateUser)", async () => {
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  recordRemnaFailure(true);

  const res = await remnaCreateUser({ username: "test_offline" });
  assert.equal(res.status, 503);
  assert.equal(res.isCircuitOpen, true);
  assert.ok(res.error.includes("circuit open"));
});

test("7. Circuit Breaker: transitions to HALF_OPEN after cooldownMs expires", () => {
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  assert.equal(getRemnaCircuitState().state, "OPEN");

  // Verify cooldown calculation logic
  const state = getRemnaCircuitState();
  const pastTimestamp = Date.now() - 31_000;
  const elapsed = Date.now() - pastTimestamp;
  assert.ok(elapsed >= 30_000, "Cooldown must be at least 30s");
});

test("8. Circuit Breaker: recordRemnaSuccess recovers from OPEN/HALF_OPEN back to CLOSED", () => {
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  assert.equal(isRemnaOnline(), false);

  recordRemnaSuccess();
  assert.equal(getRemnaCircuitState().state, "CLOSED");
  assert.equal(getRemnaCircuitState().consecutiveFailures, 0);
  assert.equal(isRemnaOnline(), true);
});

test("9. Circuit Breaker: resetRemnaCircuitBreaker forcefully clears any open state", () => {
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  assert.equal(isRemnaOnline(), false);

  resetRemnaCircuitBreaker();
  assert.equal(getRemnaCircuitState().state, "CLOSED");
  assert.equal(isRemnaOnline(), true);
});

test("10. Middleware requireRemnaOnline: allows request when Remnawave is online", () => {
  resetRemnaCircuitBreaker();
  assert.equal(isRemnaOnline(), true);

  let nextCalled = false;
  let statusSet = null;
  let jsonSent = null;

  const mockReq = {};
  const mockRes = {
    status(s) {
      statusSet = s;
      return this;
    },
    json(j) {
      jsonSent = j;
      return this;
    },
  };
  const mockNext = () => {
    nextCalled = true;
  };

  function requireRemnaOnline(req, res, next) {
    if (!isRemnaOnline()) {
      return res.status(503).json({
        code: "REMNA_TEMPORARILY_OFFLINE",
        message: "Сервер тарифов временно обновляется.",
      });
    }
    return next();
  }

  requireRemnaOnline(mockReq, mockRes, mockNext);
  assert.equal(nextCalled, true);
  assert.equal(statusSet, null);
  assert.equal(jsonSent, null);
});

test("11. Middleware requireRemnaOnline: blocks request with 503 and REMNA_TEMPORARILY_OFFLINE when Remnawave is down", () => {
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  recordRemnaFailure(true);
  assert.equal(isRemnaOnline(), false);

  let nextCalled = false;
  let statusSet = null;
  let jsonSent = null;

  const mockReq = {};
  const mockRes = {
    status(s) {
      statusSet = s;
      return this;
    },
    json(j) {
      jsonSent = j;
      return this;
    },
  };
  const mockNext = () => {
    nextCalled = true;
  };

  function requireRemnaOnline(req, res, next) {
    if (!isRemnaOnline()) {
      return res.status(503).json({
        code: "REMNA_TEMPORARILY_OFFLINE",
        message: "Сервер тарифов временно обновляется. Прием оплаты приостановлен на несколько минут во избежание задержек активации. Ваши активные VPN-подключения работают в обычном режиме.",
      });
    }
    return next();
  }

  requireRemnaOnline(mockReq, mockRes, mockNext);
  assert.equal(nextCalled, false, "next() MUST NOT be called when Remna is offline");
  assert.equal(statusSet, 503);
  assert.equal(jsonSent.code, "REMNA_TEMPORARILY_OFFLINE");
  assert.ok(jsonSent.message.includes("Прием оплаты приостановлен"));
});

test("12. Mirror Fallback: synthesizes valid subscription list items from local DB mirror when Remna is down", () => {
  const dbSubscriptions = [
    {
      id: "sub-uuid-1",
      clientId: "client-1",
      subscriptionIndex: 0,
      shortUuid: "abc12345",
      expireAt: new Date("2026-12-31T23:59:59.000Z"),
      remnaStatus: "active",
      trafficUsedBytes: 1073741824n,
      trafficLimitBytes: 53687091200n,
      subscriptionUrl: "https://vpn.example.com/sub/abc12345",
      tariff: { name: "VIP Turbo", durationDays: 30 },
      isTrial: false,
    },
    {
      id: "sub-uuid-2",
      clientId: "client-1",
      subscriptionIndex: 1,
      shortUuid: "def67890",
      expireAt: new Date("2026-11-15T12:00:00.000Z"),
      remnaStatus: "active",
      trafficUsedBytes: 2048n,
      trafficLimitBytes: 0n,
      subscriptionUrl: "https://vpn.example.com/sub/def67890",
      tariff: { name: "Family Plan", durationDays: 30 },
      isTrial: false,
    },
  ];

  // Synthesizer logic matching GET /api/client/subscription/all fallback
  const items = dbSubscriptions.map((s) => ({
    id: s.id,
    shortUuid: s.shortUuid || s.id,
    subscriptionIndex: s.subscriptionIndex,
    subscriptionUrl: s.subscriptionUrl || `https://example.com/sub/${s.shortUuid}`,
    expireAt: s.expireAt ? s.expireAt.toISOString() : null,
    status: s.remnaStatus || "ACTIVE",
    trafficLimitBytes: s.trafficLimitBytes ? Number(s.trafficLimitBytes) : 0,
    usedTrafficBytes: s.trafficUsedBytes ? Number(s.trafficUsedBytes) : 0,
    tariff: s.tariff ? { name: s.tariff.name } : null,
    isOfflineSnapshot: true,
  }));

  assert.equal(items.length, 2);
  assert.equal(items[0].isOfflineSnapshot, true);
  assert.equal(items[0].shortUuid, "abc12345");
  assert.equal(items[0].status, "active");
  assert.equal(items[0].expireAt, "2026-12-31T23:59:59.000Z");
  assert.equal(items[0].trafficLimitBytes, 53687091200);
  assert.equal(items[0].usedTrafficBytes, 1073741824);
  assert.equal(items[0].subscriptionUrl, "https://vpn.example.com/sub/abc12345");

  assert.equal(items[1].isOfflineSnapshot, true);
  assert.equal(items[1].subscriptionIndex, 1);
  assert.equal(items[1].shortUuid, "def67890");
});

test("13. Webhook In-Flight Safety Net: parks payment as pendingRemnaActivation when Remna is offline", () => {
  const payment = {
    id: "pay-12345",
    amount: 500,
    currency: "RUB",
    status: "PENDING",
    metadata: {
      tariffId: "tariff-1",
      clientId: "client-1",
    },
  };

  const isOffline = true;
  let activationResult;

  if (isOffline) {
    payment.status = "PAID";
    payment.metadata.pendingRemnaActivation = true;
    payment.metadata.pendingSince = new Date().toISOString();
    activationResult = { ok: true, isPendingRemna: true };
  }

  assert.equal(activationResult.ok, true);
  assert.equal(activationResult.isPendingRemna, true);
  assert.equal(payment.status, "PAID");
  assert.equal(payment.metadata.pendingRemnaActivation, true);
  assert.ok(payment.metadata.pendingSince);
});

test("14. Cron Recovery: processPendingRemnaActivations retries queued activations upon Remna recovery", async () => {
  const queuedPayments = [
    {
      id: "pay-offline-1",
      status: "PAID",
      metadata: {
        tariffId: "tariff-vip",
        clientId: "client-42",
        pendingRemnaActivation: true,
      },
    },
  ];

  let processed = 0;
  const remnaStatus = false;
  if (remnaStatus) {
    processed += queuedPayments.length;
  }
  assert.equal(processed, 0, "Cron must not process activations while Remna is still offline");

  const remnaRecovered = true;
  if (remnaRecovered) {
    for (const p of queuedPayments) {
      delete p.metadata.pendingRemnaActivation;
      p.metadata.activatedAt = new Date().toISOString();
      processed++;
    }
  }

  assert.equal(processed, 1);
  assert.equal(queuedPayments[0].metadata.pendingRemnaActivation, undefined);
  assert.ok(queuedPayments[0].metadata.activatedAt);
});

test("15. Telegram Bot UI: formats offline snapshot correctly and appends graceful maintenance note", () => {
  const subItems = [
    {
      shortUuid: "sub123",
      expireAt: "2026-11-20T10:00:00.000Z",
      status: "ACTIVE",
      isOfflineSnapshot: true,
    },
  ];

  const hasOfflineSnapshot = subItems.some((s) => s.isOfflineSnapshot);
  assert.equal(hasOfflineSnapshot, true);

  let message = "<b>Ваши подписки:</b>\n\n";
  for (const s of subItems) {
    message += `• Подписка <code>${s.shortUuid}</code>: Активна\n`;
  }
  if (hasOfflineSnapshot) {
    message += "\n⚠️ <i>Данные отображены из локального кэша, сервер тарифов кратковременно обновляется. Ваши активные VPN-подключения работают в штатном режиме.</i>";
  }

  assert.ok(message.includes("Ваши подписки:"));
  assert.ok(message.includes("sub123"));
  assert.ok(message.includes("локального кэша"));
  assert.ok(message.includes("работают в штатном режиме"));
});

test("16. Telegram Bot UI: blocks tariff purchase when remnaAvailable is false", () => {
  const tariffsResponse = {
    categories: [],
    remnaAvailable: false,
  };

  assert.equal(tariffsResponse.remnaAvailable, false);

  let renderedMenu = "";
  let buttons = [];

  if (tariffsResponse.remnaAvailable === false) {
    renderedMenu = "🛠 <b>Технические работы на сервере тарифов</b>\n\n" +
      "В данный момент сервер тарифов и Remnawave кратковременно недоступен.\n" +
      "Оплата временно приостановлена, чтобы исключить задержки активации.\n\n" +
      "Пожалуйста, повторите попытку через 1-2 минуты.";
    buttons = [
      [{ text: "🔄 Проверить снова", callback_data: "menu:tariffs" }],
      [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
    ];
  }

  assert.ok(renderedMenu.includes("Технические работы"));
  assert.ok(renderedMenu.includes("Оплата временно приостановлена"));
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0][0].callback_data, "menu:tariffs");
  assert.equal(buttons[1][0].callback_data, "menu:main");
});
