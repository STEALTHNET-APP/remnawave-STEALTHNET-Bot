import test from "node:test";
import assert from "node:assert/strict";
import { Api, Context } from "grammy";
import { deflateSync } from "node:zlib";
import { buildWidget, createWidgetMiddleware } from "./widgets.js";
const info = { id: 999, is_bot: true as const, first_name: "Test", username: "test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };
let messageId = 100;
function fixture(update: unknown) {
  const calls: { method: string; payload: any }[] = [];
  const api = new Api("999:fixture");
  api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method.startsWith("send") ? { message_id: ++messageId, date: 1, chat: { id: 123, type: "private" } } : true } as any;
  });
  return { ctx: new Context(update as any, api, info as any), calls };
}
const message = (id = 123, type = "private") => ({ update_id: 1, message: { message_id: 1, date: 1, chat: { id, type }, from: { id: 123, is_bot: false, first_name: "Test" }, text: "/start" } });
test("widget escapes untrusted content and uses opaque actions within Telegram limits", () => {
  const widget = buildWidget('<b>Привет</b> </script><script>alert(1)</script>', [[{ text: 'Оплатить', callback_data: 'pay:private-id' }]], 'A <script>');
  assert.ok(widget); assert.ok(Buffer.byteLength(widget.html) <= 32768); assert.ok(deflateSync(widget.html, { level: 9 }).length <= 4096);
  assert.equal(widget.html.includes('pay:private-id'), false); assert.equal(widget.html.includes('<script>alert'), false);
  assert.equal([...widget.actions.values()][0], 'pay:private-id');
  assert.ok([...widget.actions.keys()].every(id => Buffer.byteLength(id) <= 64));
});
test("unsupported inline controls stay in ordinary messages", () => {
  assert.equal(buildWidget('Invoice', [[{ text: 'Pay', pay: true } as any]], 'Test'), null);
});
test("widget requests bind actions to sender and message, reject replay, and reuse existing callbacks", async () => {
  const middleware = createWidgetMiddleware(async () => ({ botHtmlBubblesTest: true, serviceName: 'Test' }));
  const first = fixture(message());
  await middleware(first.ctx, async () => { await first.ctx.reply('Выберите тариф', { reply_markup: { inline_keyboard: [[{ text: 'Тариф', callback_data: 'tariff:one' }]] } }); });
  const sent = first.calls.find(c => c.method === 'sendWidget')!; assert.ok(sent);
  const id = messageId;
  const token = JSON.parse(sent.payload.html.match(/,b=(\[.*?\]),p=0/)![1])[0].value;
  const query = (sender = 123, mid = id) => ({ update_id: 2, widget_query: { id: 'q1', from: { id: sender, is_bot: false, first_name: 'User' }, chat: { id: sender, type: 'private' }, message_id: mid, data: token, chat_instance: 'chat', type: { type: 'data' } } });
  for (const update of [query(321), query(123, id + 100)]) {
    const denied = fixture(update); let handled = false;
    await middleware(denied.ctx, async () => { handled = true; }); assert.equal(handled, false);
    assert.match(denied.calls[0]!.payload.data, /устарело/);
  }
  const good = fixture(query()); let handled = 0;
  await middleware(good.ctx, async () => { handled++; assert.equal(good.ctx.callbackQuery?.data, 'tariff:one'); await good.ctx.editMessageText('Тариф выбран', { reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'back' }]] } }); });
  assert.equal(handled, 1); assert.ok(good.calls.some(c => c.method === 'sendWidget')); assert.ok(good.calls.some(c => c.method === 'deleteMessage'));
  await middleware(fixture(query()).ctx, async () => { handled++; }); assert.equal(handled, 1);
});
test("disabled mode and group chats retain ordinary Telegram API", async () => {
  for (const [enabled, update] of [[false, message()], [true, message(-123, 'group')]] as const) {
    const f = fixture(update);
    await createWidgetMiddleware(async () => ({ botHtmlBubblesTest: enabled }))(f.ctx, async () => { await f.ctx.reply('Hello'); });
    assert.equal(f.calls[0]!.method, 'sendMessage');
  }
});

test("unsupported Telegram methods fall back once; network uncertainty never sends a duplicate", async () => {
  for (const uncertain of [false, true]) {
    const api = new Api("999:fixture"); const calls: string[] = [];
    api.config.use(async (_prev, method) => {
      calls.push(method);
      if (method === ("sendWidget" as any)) {
        if (uncertain) throw Error("Connection lost after delivery");
        return { ok: false, error_code: 404, description: "Not Found" } as any;
      }
      return { ok: true, result: { message_id: 700, date: 1, chat: { id: 123, type: "private" } } } as any;
    });
    const ctx = new Context(message() as any, api, info as any);
    const run = async () => createWidgetMiddleware(async () => ({ botHtmlBubblesTest: true }))(ctx, async () => { await ctx.reply("Menu"); });
    if (uncertain) await assert.rejects(run, /Connection lost/); else await run();
    assert.deepEqual(calls, uncertain ? ["sendWidget"] : ["sendWidget", "sendMessage"]);
  }
});

test("ordinary-menu fallback remains usable after administrator disables widgets", async () => {
  const f = fixture({ update_id: 9, callback_query: { id: "fallback", from: { id: 456, is_bot: false, first_name: "User" }, chat_instance: "chat", data: "widgets:classic", message: { message_id: 800, date: 1, chat: { id: 456, type: "private" } } } });
  let called = false;
  await createWidgetMiddleware(async () => ({ botHtmlBubblesTest: false }))(f.ctx, async () => { called = true; });
  assert.equal(called, false); assert.ok(f.calls.some(c => c.method === "sendMessage" && c.payload.text.includes("24 часа")));
});
