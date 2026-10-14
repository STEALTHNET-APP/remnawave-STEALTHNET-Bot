import { test } from "node:test";
import assert from "node:assert/strict";
import type { ApiResponse } from "grammy/types";
import { ignoreNotModified } from "./ignore-not-modified.js";

const NOT_MODIFIED: ApiResponse<unknown> = {
  ok: false,
  error_code: 400,
  description:
    "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
};

// Минимальная заглушка prev: возвращает заранее заданный ответ независимо от метода.
function run(method: string, response: ApiResponse<unknown>): Promise<ApiResponse<unknown>> {
  type Prev = Parameters<typeof ignoreNotModified>[0];
  const prev = (async () => response) as unknown as Prev;
  const call = ignoreNotModified as unknown as (
    prev: Prev,
    method: string,
    payload: object,
  ) => Promise<ApiResponse<unknown>>;
  return call(prev, method, {});
}

for (const method of ["editMessageText", "editMessageCaption", "editMessageReplyMarkup", "editMessageMedia"]) {
  test(`${method}: 'message is not modified' превращается в успех`, async () => {
    const res = await run(method, NOT_MODIFIED);
    assert.equal(res.ok, true);
  });
}

test("sendMessage: та же ошибка не подавляется", async () => {
  const res = await run("sendMessage", NOT_MODIFIED);
  assert.deepEqual(res, NOT_MODIFIED);
});

test("edit: другая 400 ошибка не подавляется", async () => {
  const other: ApiResponse<unknown> = { ok: false, error_code: 400, description: "Bad Request: message to edit not found" };
  assert.deepEqual(await run("editMessageText", other), other);
});

test("edit: успешный ответ проходит как есть", async () => {
  const ok: ApiResponse<unknown> = { ok: true, result: { message_id: 7 } };
  assert.deepEqual(await run("editMessageText", ok), ok);
});
