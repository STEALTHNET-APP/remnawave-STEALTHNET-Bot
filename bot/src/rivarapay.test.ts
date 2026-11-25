import assert from "node:assert/strict";
import { test } from "node:test";
import { setRivarapayEnabled, tariffPaymentMethodButtons, topupPaymentMethodButtons, giftPaymentButtons, proxyPaymentMethodButtons, singboxPaymentMethodButtons, optionPaymentMethodButtons } from "./keyboard.js";

const actions = (markup: ReturnType<typeof tariffPaymentMethodButtons>) => markup.inline_keyboard.flat().filter(b => "callback_data" in b).map(b => (b as {callback_data: string}).callback_data);
test("RivaraPay appears for ruble purchases, gifts and topups only while enabled", () => {
  const menu = (currency: string) => [
    ...actions(tariffPaymentMethodButtons("tariff", [], undefined, undefined, undefined, undefined, undefined, undefined, undefined, currency)),
    ...actions(topupPaymentMethodButtons("1", [], undefined, undefined, undefined, { currency })),
    ...actions(proxyPaymentMethodButtons("tariff", [], undefined, undefined, undefined, undefined, undefined, undefined, undefined, currency)),
    ...actions(singboxPaymentMethodButtons("tariff", [], undefined, undefined, undefined, undefined, undefined, undefined, undefined, currency)),
    ...actions(optionPaymentMethodButtons({kind:"traffic",id:"extra",name:"Traffic",trafficGb:10,price:10,currency},0,null)),
    ...actions(giftPaymentButtons("tariff", null, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, currency)),
  ].filter(id => id.includes("rivarapay"));
  setRivarapayEnabled(true);
  try {
    assert.deepEqual(menu("RUB").sort(), ["gift_pay_rivarapay:tariff", "pay_option_rivarapay:traffic:extra", "pay_proxy_rivarapay:tariff", "pay_singbox_rivarapay:tariff", "pay_tariff_rivarapay:tariff", "topup_rivarapay:1"]);
    assert.deepEqual(menu("USD"), []);
    setRivarapayEnabled(false);
    assert.deepEqual(menu("RUB"), []);
  } finally { setRivarapayEnabled(false); }
});
