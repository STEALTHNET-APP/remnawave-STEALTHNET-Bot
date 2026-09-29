import assert from "node:assert/strict";
import { mock, test } from "node:test";

const requests = [];
mock.module("../dist/modules/proxy-util/get-proxy-url.js", {
  namedExports: { getProxyUrl: async () => null },
});
mock.module("../dist/modules/proxy-util/proxy-fetch.js", {
  namedExports: {
    proxyFetch: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ redirect: "https://example.test/pay", transactionId: "tx-test" }));
    },
  },
});
const { createPlategaTransaction } = await import("../dist/modules/platega/platega.service.js");

test("provider boundary sends payer email and unchanged order payload without making a payment", async () => {
  const config = { merchantId: "test-merchant", secret: "test-secret" };
  const params = {
    amount: 123, currency: "RUB", orderId: "renewal-order", paymentMethod: 2,
    returnUrl: "https://example.test/return", failedUrl: "https://example.test/fail",
  };
  for (const email of [" Payer@example.test ", null]) {
    const result = await createPlategaTransaction(config, { ...params, email });
    assert.deepEqual(result, { paymentUrl: "https://example.test/pay", transactionId: "tx-test" });
    const request = requests.at(-1);
    assert.equal(request.url, "https://app.platega.io/transaction/process");
    assert.equal(request.init.method, "POST");
    const body = JSON.parse(request.init.body);
    assert.equal(body.payload, "renewal-order");
    assert.deepEqual(body.metadata, email ? { email: "Payer@example.test" } : undefined);
  }
  assert.equal(requests.length, 2);
});
