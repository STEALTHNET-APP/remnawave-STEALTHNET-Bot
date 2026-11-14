import test from "node:test";
import assert from "node:assert/strict";
import { Api, Context } from "grammy";
import { deflateSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import { buildWidget, createWidgetMiddleware } from "./widgets.js";
import { createMemoryWidgetPreferences } from "./widget-preferences.js";
import { splitWidgetText } from "./widget-presentation.js";
const info = { id: 999, is_bot: true as const, first_name: "Test", username: "test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };
let messageId = 100;
function fixture(update: unknown) {
  const calls: { method: string; payload: any; messageId?: number }[] = [];
  const api = new Api("999:fixture");
  api.config.use(async (_prev, method, payload) => {
    const id = method.startsWith("send") ? ++messageId : undefined;
    calls.push({ method, payload, messageId: id });
    return { ok: true, result: id ? { message_id: id, date: 1, chat: { id: 123, type: "private" } } : true } as any;
  });
  return { ctx: new Context(update as any, api, info as any), calls };
}
const message = (id = 123, type = "private") => ({ update_id: 1, message: { message_id: 1, date: 1, chat: { id, type }, from: { id: 123, is_bot: false, first_name: "Test" }, text: "/start" } });
async function widgetQueryFixture(action: string) {
  const middleware = createWidgetMiddleware(async () => ({ botHtmlBubblesTest: true }));
  const first = fixture(message());
  await middleware(first.ctx, async () => {
    await first.ctx.reply('Menu', { reply_markup: { inline_keyboard: [[{ text: 'Action', callback_data: action }]] } });
  });
  const sent = first.calls.find(c => c.method === 'sendWidget')!;
  const token = JSON.parse(sent.payload.html.match(/,b=(\[.*?\]),p=0/)![1])[0].value;
  const update = { update_id: 2, widget_query: { id: `query:${messageId}`, from: { id: 123, is_bot: false, first_name: 'User' }, chat: { id: 123, type: 'private' }, message_id: sent.messageId, data: token, chat_instance: 'chat' } };
  return { middleware, update, request: fixture(update) };
}
test("widget escapes untrusted content and uses opaque actions within Telegram limits", () => {
  const widget = buildWidget('<b>Привет</b> </script><script>alert(1)</script>', [[{ text: 'Оплатить', callback_data: 'pay:private-id' }]], 'A <script>');
  assert.ok(widget); assert.ok(Buffer.byteLength(widget.html) <= 32768); assert.ok(deflateSync(widget.html, { level: 9 }).length <= 4096);
  assert.equal(widget.html.includes('pay:private-id'), false); assert.equal(widget.html.includes('<script>alert'), false);
  assert.equal([...widget.actions.values()][0], 'pay:private-id');
  assert.ok([...widget.actions.keys()].every(id => Buffer.byteLength(id) <= 64));
});
test("text pages preserve words, line breaks and emoji", () => {
  const text = 'Подписка активна\n' + 'Доступно устройств: 3. '.repeat(25) + '😀';
  const pages = splitWidgetText(text);
  assert.equal(pages.join(''), text);
  assert.ok(pages.length > 1);
  assert.ok(pages.slice(0, -1).every(page => /\s$/.test(page)));
});
test("long text retains its final action group on every remaining page", () => {
  for (const count of [3, 7]) {
    const labels = Array.from({ length: count }, (_, i) => `Действие ${i + 1}`);
    const text = Array.from({ length: 24 }, (_, i) => `Строка ${i + 1}: ${'описание подписки '.repeat(4)}`).join('\n');
    const widget = buildWidget(text, [labels.map(label => ({ text: label, callback_data: label }))], 'Test')!;
    const element = () => ({
      children: [] as any[], textContent: '', style: {} as Record<string, string>, disabled: false, onclick: () => {},
      appendChild(child: unknown) { this.children.push(child); },
      set innerHTML(_value: string) { this.children = []; },
    });
    const nodes = Object.fromEntries(['text', 'buttons', 'nav', 'prev', 'next', 'page', 'status'].map(id => [id, element()]));
    runInNewContext(widget.html.match(/<script>([\s\S]*)<\/script>/)![1], { TelegramWidget: {}, document: { getElementById: (id: string) => nodes[id], createElement: element } });
    assert.deepEqual(nodes.buttons!.children.map(button => button.textContent), labels.slice(0, 6));
    let pages = 1;
    while (!nodes.next!.disabled) {
      nodes.next!.onclick();
      pages++;
      assert.deepEqual(nodes.buttons!.children.map(button => button.textContent), labels.slice(count > 6 ? 6 : 0));
      assert.ok(pages < 30);
    }
    assert.ok(pages > 2);
  }
});
test("account widget uses structured data without repeating legacy menu text", async () => {
  const { buildMainMenuText } = await import('./handlers/shared.js');
  const menu = buildMainMenuText({ serviceName: 'TEST', telegramId: 123, balance: 25, currency: 'RUB', tariffDisplayName: '🎁 Пробная 1', menuLineVisibility: {balancePrefix:true,tariffPrefix:true,subscriptionPrefix:true,trafficPrefix:true,devicesLabel:true}, subscription: { hwidDeviceLimit: 3, user: { status: 'EXPIRED', expireAt: '2026-10-22T12:21:00Z', hwidDeviceLimit: 3, trafficLimitBytes: 5 * 1024 ** 3, usedTrafficBytes: 0 } } });
  assert.ok(menu.widgetSummary);
  assert.equal(menu.widgetSummary.tariff, 'Пробная 1');
  const widget = buildWidget(menu.text, [[{text:'📦 Тарифы',callback_data:'tariffs'}]], 'TEST', menu.widgetSummary)!;
  assert.ok(widget);
  assert.equal(widget.html.includes('Добро пожаловать'), false);
  assert.equal(widget.html.includes('Ваш тариф'), false);
  assert.ok(widget.html.includes('Баланс'));
  assert.ok(widget.html.includes('Трафик'));
  const hidden = buildMainMenuText({serviceName:'TEST',telegramId:123,balance:25,currency:'RUB',subscription:null,menuLineVisibility:{balancePrefix:false,telegramIdPrefix:false,tariffPrefix:false,trafficPrefix:false}});
  assert.equal(hidden.widgetSummary?.balance,undefined);
  assert.equal(hidden.widgetSummary?.account,undefined);
  assert.equal(hidden.widgetSummary?.tariff,undefined);
  assert.equal(hidden.widgetSummary,undefined);
});
test("unsupported inline controls stay in ordinary messages", () => {
  assert.equal(buildWidget('Invoice', [[{ text: 'Pay', pay: true } as any]], 'Test'), null);
});
test("Mini App controls retain native launch semantics and button attributes", async () => {
  const app = { text: 'Рулетка', web_app: { url: 'https://example.com/cabinet/roulette' }, style: 'primary', icon_custom_emoji_id: '12345' };
  const f = fixture(message());
  await createWidgetMiddleware(async () => ({ botHtmlBubblesTest: true }))(f.ctx, async () => {
    await f.ctx.reply('Menu', { reply_markup: { inline_keyboard: [[{ text: 'Тарифы', callback_data: 'tariffs' }, app], [{ text: 'Помощь', url: 'https://example.com/help' }]] } as any });
  });
  const sent = f.calls.find(c => c.method === 'sendWidget')!;
  assert.deepEqual(sent.payload.reply_markup.inline_keyboard, [[app], [{ text: 'Обычное меню', callback_data: 'widgets:classic' }]]);
  assert.equal(sent.payload.html.includes(app.web_app.url), false);
  assert.ok(sent.payload.html.includes('https://example.com/help'));
});
test("account notes resolve configured emoji placeholders", async () => {
  const { buildMainMenuText } = await import('./handlers/shared.js');
  const menu = buildMainMenuText({ serviceName: 'Test', telegramId: 123, balance: 0, currency: 'RUB', subscription: { user: { status: 'EXPIRED' } }, infoBlock: '{{INFO}} Важное сообщение', botEmojis: { INFO: { unicode: 'ℹ️' } }, menuLineVisibility: { subscriptionPrefix: true } });
  assert.equal(menu.widgetSummary?.note, 'ℹ️ Важное сообщение');
});
test("empty acknowledgments do not swallow alerts and safe subscription checks can retry", async () => {
  const { middleware, update, request } = await widgetQueryFixture('check_subscribe');
  const respond = async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery({ text: 'Сначала подпишитесь на канал', show_alert: true });
  };
  await middleware(request.ctx, () => respond(request.ctx));
  assert.deepEqual(request.calls.filter(c => c.method === 'answerWidgetQuery').map(c => c.payload.data), ['Сначала подпишитесь на канал']);
  assert.equal(request.calls.some(c => c.method === 'answerCallbackQuery'), false);
  const retry = fixture(update);
  let handled = false;
  await middleware(retry.ctx, async () => { handled = true; await respond(retry.ctx); });
  assert.equal(handled, true);
});
test("confirmation text reaches the widget before its replacement", async () => {
  const { middleware, request } = await widgetQueryFixture('check_subscribe');
  await middleware(request.ctx, async () => {
    await request.ctx.answerCallbackQuery();
    await request.ctx.answerCallbackQuery({ text: 'Подписка подтверждена' });
    await request.ctx.editMessageText('Личный кабинет');
  });
  assert.equal(request.calls[0]!.method, 'answerWidgetQuery');
  assert.equal(request.calls[0]!.payload.data, 'Подписка подтверждена');
  assert.equal(request.calls.filter(c => c.method === 'answerWidgetQuery').length, 1);
  assert.ok(request.calls.some(c => c.method === 'sendWidget'));
});
test("business callbacks stay consumed after an alert or an uncertain failure", async () => {
  for (const throws of [false, true]) {
    const { middleware, update, request } = await widgetQueryFixture('payment:confirm');
    let attempts = 0;
    const run = async () => middleware(request.ctx, async () => {
      attempts++;
      await request.ctx.answerCallbackQuery();
      if (throws) throw Error('Connection lost after payment');
      await request.ctx.answerCallbackQuery({ text: 'Проверьте результат операции', show_alert: true });
    });
    if (throws) await assert.rejects(run, /Connection lost/); else await run();
    assert.equal(request.calls.filter(c => c.method === 'answerWidgetQuery').length, 1);
    if (throws) assert.match(request.calls[0]!.payload.data, /Не удалось подтвердить результат/);
    const retry = fixture(update);
    await middleware(retry.ctx, async () => { attempts++; });
    assert.equal(attempts, 1);
    assert.match(retry.calls[0]!.payload.data, /устарело/);
  }
});
test("slow callbacks answer before Telegram's deadline and deliver late notices", async (t) => {
  const { middleware, update, request } = await widgetQueryFixture('payment:confirm');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const run = middleware(request.ctx, async () => {
    started();
    await pending;
    await request.ctx.answerCallbackQuery({ text: 'Оплата получена' });
  });
  await entered;
  t.mock.timers.tick(10_000);
  await Promise.resolve();
  assert.equal(request.calls.filter(c => c.method === 'answerWidgetQuery').length, 1);
  assert.match(request.calls[0]!.payload.data, /ещё выполняется/);
  release();
  await run;
  assert.equal(request.calls.filter(c => c.method === 'answerWidgetQuery').length, 1);
  assert.ok(request.calls.some(c => c.method === 'sendWidget' && c.payload.html.includes('Оплата получена')));
  let retried = false;
  await middleware(fixture(update).ctx, async () => { retried = true; });
  assert.equal(retried, false);
});
test("widget answers preserve UTF-8 within the 1024-byte response limit", async () => {
  const { middleware, request } = await widgetQueryFixture('gift:noop:one');
  await middleware(request.ctx, async () => { await request.ctx.answerCallbackQuery({ text: '✅'.repeat(400) }); });
  const data = request.calls.find(c => c.method === 'answerWidgetQuery')!.payload.data;
  assert.ok(Buffer.byteLength(data) <= 1024);
  assert.equal(data.includes('\uFFFD'), false);
  assert.ok(data.length > 0);
});
test("widget requests bind actions to sender and message, reject replay, and reuse existing callbacks", async () => {
  const middleware = createWidgetMiddleware(async () => ({ botHtmlBubblesTest: true, serviceName: 'Test' }));
  const first = fixture(message());
  await middleware(first.ctx, async () => { await first.ctx.reply('Выберите тариф', { reply_markup: { inline_keyboard: [[{ text: 'Тариф', callback_data: 'tariff:one' }]] } }); });
  const sent = first.calls.find(c => c.method === 'sendWidget')!; assert.ok(sent);
  assert.equal(sent.payload.height, undefined);
  assert.equal(sent.payload.caption, undefined);
  const id = sent.messageId!;
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
  assert.equal(good.calls[0]!.method, 'answerWidgetQuery');
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
    assert.deepEqual(calls, ["sendWidget", "sendMessage"]);
  }
});

test("ordinary-menu fallback remains usable after administrator disables widgets", async () => {
  const f = fixture({ update_id: 9, callback_query: { id: "fallback", from: { id: 456, is_bot: false, first_name: "User" }, chat_instance: "chat", data: "widgets:classic", message: { message_id: 800, date: 1, chat: { id: 456, type: "private" } } } });
  let called = false;
  await createWidgetMiddleware(async () => ({ botHtmlBubblesTest: false }))(f.ctx, async () => { called = true; });
  assert.equal(called, true); assert.ok(f.calls.some(c => c.method === "sendMessage" && c.payload.text.includes("только для вас")));
  assert.equal(f.ctx.callbackQuery?.data, "menu:main");
});

const switchUpdate = (id: number, data = "widgets:classic", type = "private", sender = id) => ({ update_id: id, callback_query: { id: `switch:${id}`, from: { id: sender, is_bot: false, first_name: "User" }, chat_instance: "chat", data, message: { message_id: 800, date: 1, chat: { id, type } } } });
const ownMessage = (id: number) => ({ ...message(id), message: { ...message(id).message, from: { id, is_bot: false, first_name: "User" } } });
const menuReply = (ctx: Context) => ctx.reply("Меню", { reply_markup: { inline_keyboard: [[{ text: "Тарифы", callback_data: "menu:tariffs" }]] } });

test("a newly sent widget has a separate ordinary recovery message, not another widget", async () => {
  const middleware = createWidgetMiddleware(async () => ({ botHtmlBubblesTest: true }));
  const first = fixture(ownMessage(501));
  await middleware(first.ctx, async () => { await menuReply(first.ctx); await menuReply(first.ctx); });
  assert.deepEqual(first.calls.map(c => c.method), ["sendWidget", "sendMessage", "sendWidget"]);
  const hint = first.calls[1]!;
  assert.match(hint.payload.text, /Возможно.*Telegram.*только для вас/);
  assert.equal(hint.payload.disable_notification, true);
  assert.deepEqual(hint.payload.reply_markup.inline_keyboard, [[{ text: "Включить обычное меню", callback_data: "widgets:classic" }]]);
  const again = fixture(ownMessage(501));
  await middleware(again.ctx, async () => { await menuReply(again.ctx); });
  assert.equal(again.calls.filter(c => c.method === "sendMessage").length, 1);
  assert.ok(again.calls.some(c => c.method === "deleteMessage" && c.payload.message_id === hint.messageId));
  const edit = fixture(switchUpdate(501, "menu:tariffs"));
  await middleware(edit.ctx, async () => { await edit.ctx.editMessageText("Тарифы", { reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "menu:main" }]] } }); });
  assert.equal(edit.calls.some(c => c.method === "sendMessage"), false);
});

test("personal classic selection opens the main menu immediately and leaves other users in widgets", async () => {
  const preferences = createMemoryWidgetPreferences();
  const middleware = createWidgetMiddleware(async () => ({ botHtmlBubblesTest: true }), { preferences });
  const classic = fixture(switchUpdate(502));
  await middleware(classic.ctx, async () => {
    assert.equal(classic.ctx.callbackQuery?.data, "menu:main");
    await classic.ctx.editMessageText("Главное меню", { reply_markup: { inline_keyboard: [[{ text: "Тарифы", callback_data: "menu:tariffs" }]] } });
  });
  assert.equal(await preferences.isClassic(502), true);
  assert.equal(classic.calls.some(c => c.method === "sendWidget" || c.method === "editMessageText"), false);
  assert.ok(classic.calls.some(c => c.method === "sendMessage" && c.payload.text === "Главное меню"));
  assert.ok(classic.calls.some(c => c.method === "sendMessage" && c.payload.reply_markup?.inline_keyboard[0][0].callback_data === "widgets:modern"));
  for (const [id, expected] of [[502, "sendMessage"], [503, "sendWidget"]] as const) {
    const user = fixture(ownMessage(id));
    await middleware(user.ctx, async () => { await menuReply(user.ctx); });
    assert.equal(user.calls[0]!.method, expected);
    if (id === 502) assert.equal(user.calls[0]!.payload.reply_markup.inline_keyboard.at(-1)[0].callback_data, "widgets:modern");
  }
  const modern = fixture(switchUpdate(502, "widgets:modern"));
  await middleware(modern.ctx, async () => {
    assert.equal(modern.ctx.callbackQuery?.data, "menu:main");
    await modern.ctx.editMessageText("Главное меню", { reply_markup: { inline_keyboard: [[{ text: "Тарифы", callback_data: "menu:tariffs" }]] } });
  });
  assert.equal(await preferences.isClassic(502), false);
  assert.ok(modern.calls.some(c => c.method === "sendWidget"));
  assert.ok(modern.calls.some(c => c.method === "sendMessage" && c.payload.text.startsWith("Новое меню не отображается?")));
});

test("personal menu selection rejects foreign chats and respects the administrator toggle", async () => {
  const preferences = createMemoryWidgetPreferences();
  await preferences.setClassic(504, true);
  for (const update of [switchUpdate(504, "widgets:modern", "group"), switchUpdate(504, "widgets:classic", "private", 505), switchUpdate(504, "widgets:modern")]) {
    const request = fixture(update);
    let handled = false;
    await createWidgetMiddleware(async () => ({ botHtmlBubblesTest: false }), { preferences })(request.ctx, async () => { handled = true; });
    assert.equal(handled, false);
    assert.ok(request.calls.some(c => c.method === "answerCallbackQuery" && c.payload.text));
  }
  assert.equal(await preferences.isClassic(504), true);
  assert.equal(await preferences.isClassic(505), false);
});

test("storage errors never claim a saved preference or force a user into widgets", async () => {
  const preferences = { async isClassic() { throw Error("unreadable"); }, async setClassic() { throw Error("disk full"); } };
  const middleware = createWidgetMiddleware(async () => ({ botHtmlBubblesTest: true }), { preferences });
  const failed = fixture(switchUpdate(506));
  let handled = false;
  await middleware(failed.ctx, async () => { handled = true; });
  assert.equal(handled, false);
  assert.equal(failed.calls.length, 1);
  assert.match(failed.calls[0]!.payload.text, /Не удалось сохранить/);
  const reading = fixture(ownMessage(506));
  await middleware(reading.ctx, async () => { await menuReply(reading.ctx); });
  assert.equal(reading.calls[0]!.method, "sendMessage");
});

test("switching to classic rejects actions from an earlier widget", async () => {
  const { middleware, update } = await widgetQueryFixture("payment:confirm");
  const classic = fixture(switchUpdate(123));
  await middleware(classic.ctx, async () => {});
  let handled = false;
  const old = fixture(update);
  await middleware(old.ctx, async () => { handled = true; });
  assert.equal(handled, false);
  assert.match(old.calls[0]!.payload.data, /Меню устарело/);
});

test("failure to deliver the recovery hint never retries or loses the delivered widget", async () => {
  const calls: string[] = [];
  const api = new Api("999:fixture");
  api.config.use(async (_prev, method) => {
    calls.push(method);
    if (method === "sendMessage") throw Error("Connection lost after hint delivery");
    return { ok: true, result: { message_id: 800, chat: { id: 507, type: "private" } } } as any;
  });
  const ctx = new Context(ownMessage(507) as any, api, info as any);
  await createWidgetMiddleware(async () => ({ botHtmlBubblesTest: true }))(ctx, async () => { await menuReply(ctx); });
  assert.deepEqual(calls, ["sendWidget", "sendMessage"]);
});

test("uncertain widget delivery leaves an ordinary recovery action and never renders catch text as another widget", async (t) => {
  const calls: { method: string; payload: any }[] = [];
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  const api = new Api("999:fixture");
  const failure = Object.assign(new Error("Network request for sendWidget failed! https://api.telegram.org/botSECRET/sendWidget"), {
    name: "HttpError", error: { cause: { code: "ECONNRESET", url: "https://api.telegram.org/botSECRET/sendWidget" } },
  });
  api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    if (method === ("sendWidget" as any)) throw failure;
    return { ok: true, result: { message_id: 900, chat: { id: 508, type: "private" } } } as any;
  });
  const ctx = new Context(ownMessage(508) as any, api, info as any);
  await createWidgetMiddleware(async () => ({ botHtmlBubblesTest: true }))(ctx, async () => {
    try { await menuReply(ctx); }
    catch (error) {
      assert.equal(error, failure);
      await ctx.reply("Не удалось открыть меню. Попробуйте позже.");
    }
  });
  assert.deepEqual(calls.map(c => c.method), ["sendWidget", "sendMessage", "sendMessage"]);
  assert.equal(calls[1]!.payload.reply_markup.inline_keyboard[0][0].callback_data, "widgets:classic");
  assert.match(calls[1]!.payload.text, /только для вас/);
  assert.deepEqual(warnings, [["[Widgets] Widget delivery was not confirmed", { name: "HttpError", code: "ECONNRESET" }]]);
  assert.equal(JSON.stringify(warnings).includes("SECRET"), false);
});
