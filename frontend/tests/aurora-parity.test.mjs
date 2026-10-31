import assert from "node:assert/strict";
import { test } from "node:test";
import { checkoutMethods, currencySymbol, formatCheckoutAmount } from "../src/lib/checkout-methods.ts";
import { formatTraffic, remnaDaysLeft, remnaInfo, remnaIsActive } from "../src/lib/subscription-remna.ts";

const config = {
  serviceName: "VPN",
  activeLanguages: ["ru", "en"],
  activeCurrencies: ["rub", "usd"],
  plategaMethods: [{ id: 7, label: "СБП" }],
  yookassaEnabled: true,
  yoomoneyEnabled: true,
  telegramStarsEnabled: true,
  cryptopayEnabled: true,
  heleketEnabled: true,
  rollypayEnabled: true,
  paritypayEnabled: true,
  cloudpaymentsEnabled: true,
  lavaEnabled: true,
  overpayEnabled: true,
  paymentProviders: [{ id: "cryptopay", label: "Crypto", sortOrder: 0 }],
};

test("balance is offered first and only when requested", () => {
  const without = checkoutMethods(config, "RUB");
  assert.ok(!without.some((m) => m.kind === "balance"));
  const withBalance = checkoutMethods(config, "RUB", { balanceAvailable: true });
  assert.equal(withBalance[0].kind, "balance");
  assert.equal(withBalance.filter((m) => m.kind === "balance").length, 1);
  assert.ok(withBalance.some((m) => m.kind === "platega"));
});

test("ruble-only providers disappear for foreign currency", () => {
  const usd = checkoutMethods(config, "USD").map((m) => m.kind);
  assert.ok(usd.includes("cryptopay"));
  assert.ok(usd.includes("heleket"));
  assert.ok(usd.includes("overpay"));
  assert.ok(!usd.includes("yookassa"));
  assert.ok(!usd.includes("yoomoney"));
  assert.ok(!usd.includes("telegram_stars"));
  assert.ok(!usd.includes("rollypay"));
  assert.ok(!usd.includes("paritypay"));
  assert.ok(!usd.includes("cloudpayments"));
  assert.ok(!usd.includes("lava"));
});

test("provider labels and platega methods come from config", () => {
  const methods = checkoutMethods(config, "RUB");
  assert.equal(methods.find((m) => m.kind === "cryptopay")?.label, "Crypto");
  assert.equal(methods.find((m) => m.kind === "platega")?.plategaId, 7);
  assert.equal(methods.find((m) => m.kind === "platega")?.label, "СБП");
});

test("telegram stars can be hidden without a linked telegram account", () => {
  const methods = checkoutMethods(config, "RUB", { hasTelegram: false }).map((m) => m.kind);
  assert.ok(!methods.includes("telegram_stars"));
});

test("amount formatting keeps currency and fraction", () => {
  assert.equal(currencySymbol("rub"), "₽");
  assert.equal(currencySymbol("usd"), "$");
  assert.match(formatCheckoutAmount(100, "RUB", "ru"), /100.*₽/);
  assert.match(formatCheckoutAmount(10.5, "USDT", "en"), /10[.,]5 USDT/);
});

test("remnawave payload is unwrapped from all response shapes", () => {
  const flat = remnaInfo({ status: "ACTIVE", expireAt: "2030-01-01T00:00:00.000Z", trafficLimitBytes: 0 });
  assert.equal(flat.status, "ACTIVE");
  assert.equal(flat.trafficLimitBytes, 0);

  const wrapped = remnaInfo({ response: { status: "EXPIRED", hwidDeviceLimit: 3, subscriptionUrl: " https://x " } });
  assert.equal(wrapped.status, "EXPIRED");
  assert.equal(wrapped.deviceLimit, 3);
  assert.equal(wrapped.subscriptionUrl, "https://x");

  const nested = remnaInfo({ data: { response: { userTraffic: { usedTrafficBytes: 1024 }, trafficLimitBytes: 2048 } } });
  assert.equal(nested.trafficUsed, 1024);
});

test("active state follows status before dates", () => {
  const active = remnaInfo({ status: "ACTIVE", expireAt: "2000-01-01T00:00:00.000Z" });
  assert.equal(remnaIsActive(active, 0), true);
  const expired = remnaInfo({ status: "EXPIRED", expireAt: "2999-01-01T00:00:00.000Z" });
  assert.equal(remnaIsActive(expired, 100), false);
  assert.equal(remnaDaysLeft("2000-01-01T00:00:00.000Z"), 0);
  assert.equal(remnaDaysLeft(null), null);
});

test("traffic is formatted in readable units", () => {
  assert.equal(formatTraffic(0), "0 Б");
  assert.equal(formatTraffic(1024), "1 КБ");
  assert.equal(formatTraffic(1536), "1.5 КБ");
  assert.equal(formatTraffic(10 * 1024 ** 3), "10 ГБ");
  assert.equal(formatTraffic(null), "—");
});
