import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { Context, MiddlewareFn } from "grammy";
import { cleanWidgetLabel, getWidgetSummary, widgetContentPages, type WidgetSummary } from "./widget-presentation.js";

type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string }; copy_text?: { text: string } };
type Action = { text: string; kind: "callback" | "url" | "copy"; value: string };
type Screen = { summary?: WidgetSummary; owner: number; messageId: number; text: string; keyboard: Button[][]; expires: number; consumed: boolean; actions: Map<string, string> };
type WidgetQuery = { id: string; from: { id: number; is_bot: boolean; first_name: string }; chat?: { id: number; type: string }; message_id?: number; data: string; chat_instance: string; type?: { type: string } };
const screens = new Map<string, Screen>();
const ordinary = new Map<number, number>();
const TTL = 60 * 60_000;
const key = (chatId: number, messageId: number) => `${chatId}:${messageId}`;
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

function plain(text: string) {
  return text.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
function safeUrl(value: string): boolean {
  try { const u = new URL(value); return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "tg:"; } catch { return false; }
}

export function buildWidget(text: string, keyboard: Button[][], brand: string, summary?: WidgetSummary) {
  const actions = new Map<string, string>();
  const buttons: Action[] = [];
  for (const button of keyboard.flat()) {
    if (button.callback_data) {
      const id = randomBytes(12).toString("base64url"); actions.set(id, button.callback_data);
      buttons.push({ text: button.text, kind: "callback", value: id });
    } else if (button.url || button.web_app?.url) {
      const url = button.url || button.web_app!.url;
      if (safeUrl(url)) buttons.push({ text: button.text, kind: "url", value: url });
    } else if (button.copy_text) buttons.push({ text: button.text, kind: "copy", value: button.copy_text.text });
    else return null;
  }
  for (const match of text.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = plain(match[1]!);
    if (safeUrl(url) && !buttons.some(button => button.kind === "url" && button.value === url)) buttons.push({ text: plain(match[2]!) || "Открыть ссылку", kind: "url", value: url });
  }
  const textPages = widgetContentPages(plain(text), summary);
  for (const button of buttons) button.text = cleanWidgetLabel(button.text) || button.text;
  const html = `<html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:16px 16px max(18px,env(safe-area-inset-bottom));color:var(--tg-theme-text-color);font-family:system-ui;font-size:14px;font-weight:400;line-height:1.4}h3{font-size:11px;font-weight:600;letter-spacing:1px;margin:0 0 14px;color:var(--tg-theme-hint-color)}h2{font-size:18px;line-height:1.25;font-weight:650;margin:0 0 8px;word-break:break-word}.balance{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--tg-theme-section-separator-color)}.balance strong{font-size:24px;font-weight:650}.label,.account{font-size:12px;color:var(--tg-theme-hint-color)}.status{font-size:12px;color:var(--tg-theme-subtitle-text-color);margin-bottom:10px}.row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:4px 0}.row .label{flex-shrink:0}.value{text-align:right;font-size:13px;word-break:break-word}.account{margin-top:10px;font-size:10px}.prose{white-space:pre-wrap;word-break:break-word;font-size:14px;font-weight:400;line-height:1.45}.prose:empty{display:none}#text{margin-bottom:14px}#buttons{display:grid;grid-template-columns:1fr 1fr;gap:7px}button{width:100%;min-height:42px;padding:10px 8px;margin:0;border:0;border-radius:10px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color);font-family:system-ui;font-size:12px;font-weight:550;line-height:1.25;word-break:break-word}#buttons button:first-child{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}button:disabled{opacity:.4}#nav{display:flex;gap:8px;align-items:center;margin-top:10px}#nav button{width:40px;min-height:32px;padding:6px;background:transparent}#page{flex:1;text-align:center;font-size:11px;color:var(--tg-theme-hint-color)}#status{font-size:11px;color:var(--tg-theme-hint-color);margin-top:6px}#status:empty{display:none}</style></head><body><h3>${escape(brand.slice(0, 80))}</h3><div id="text"></div><div id="buttons"></div><div id="nav"><button id="prev">←</button><span id="page"></span><button id="next">→</button></div><div id="status"></div><script>var t=${json(textPages)},b=${json(buttons)},p=0,n=Math.max(t.length,Math.ceil(b.length/6)),W=TelegramWidget;function el(id){return document.getElementById(id)}function draw(){el('text').innerHTML=t[Math.min(p,t.length-1)];el('buttons').innerHTML='';b.slice(p*6,p*6+6).forEach(function(a){var x=document.createElement('button');x.textContent=a.text;x.onclick=function(){try{if(a.kind==='url'){if(/^https?:\\/\\/t\\.me\\//.test(a.value)||a.value.indexOf('tg:')===0)W.openTelegramLink(a.value);else W.openLink(a.value);return}if(a.kind==='copy'){W.copyText(a.value);el('status').textContent='Скопировано';return}x.disabled=true;el('status').textContent='Открываем…';W.request(a.value).then(function(r){el('status').textContent=r.result||'';x.disabled=false},function(){el('status').textContent='Не удалось выполнить. Повторите или отправьте /start';x.disabled=false})}catch(e){el('status').textContent='Откройте обычное меню кнопкой под сообщением'}};el('buttons').appendChild(x)});el('nav').style.display=n>1?'flex':'none';el('prev').disabled=p===0;el('next').disabled=p===n-1;el('page').textContent=(p+1)+' / '+n}el('prev').onclick=function(){if(p>0){p--;draw()}};el('next').onclick=function(){if(p<n-1){p++;draw()}};draw();</script></body></html>`;
  if (Buffer.byteLength(html) > 32768 || deflateSync(html, { level: 9 }).length > 4096) return null;
  return { html, actions };
}

function sweep() {
  const now = Date.now();
  for (const [id, screen] of screens) if (screen.expires <= now) screens.delete(id);
  for (const [id, expiry] of ordinary) if (expiry <= now) ordinary.delete(id);
  while (screens.size >= 5000) screens.delete(screens.keys().next().value!);
}

export function createWidgetMiddleware(config: () => Promise<{ botHtmlBubblesTest?: boolean; serviceName?: string | null } | null>): MiddlewareFn<Context> {
  return async (ctx, next) => {
    sweep();
    const update = ctx.update as unknown as { widget_query?: WidgetQuery; callback_query?: unknown };
    const query = update.widget_query;
    const cfg = await config().catch(() => null);
    if (query) {
      const raw = ctx.api.raw as unknown as { answerWidgetQuery(p: { widget_query_id: string; data?: string }): Promise<unknown> };
      const screen = query.chat && query.message_id ? screens.get(key(query.chat.id, query.message_id)) : undefined;
      const action = screen?.actions.get(query.data);
      const allowed = cfg?.botHtmlBubblesTest && !ordinary.has(query.from.id) && query.chat?.type === "private" && query.chat.id === query.from.id && (!query.type || query.type.type === "data") && screen?.owner === query.from.id && !screen.consumed && action;
      if (!allowed) {
        await raw.answerWidgetQuery({ widget_query_id: query.id, data: "Меню устарело. Отправьте /start или откройте обычное меню." }); return;
      }
      screen.consumed = true;
      await raw.answerWidgetQuery({ widget_query_id: query.id, data: "Открываем…" });
      update.callback_query = { id: `widget:${query.id}`, from: query.from, chat_instance: query.chat_instance, data: action, message: { message_id: query.message_id, date: Math.floor(Date.now() / 1000), chat: query.chat, text: screen.text } };
    }
    const fallback = ctx.callbackQuery?.data === "widgets:classic";
    if (fallback && ctx.chat?.type === "private" && ctx.chat.id === ctx.from?.id) {
      ordinary.set(ctx.from.id, Date.now() + 24 * TTL);
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.reply("Обычное меню включено на 24 часа. Отправьте /start."); return;
    }
    if (!cfg?.botHtmlBubblesTest || ctx.chat?.type !== "private" || ctx.chat.id !== ctx.from?.id || ordinary.has(ctx.from.id)) return next();
    const owner = ctx.from.id;
    ctx.api.config.use(async (prev, method, payload, signal) => {
      const p = payload as unknown as Record<string, any>;
      if (method === "answerCallbackQuery" && String(p.callback_query_id).startsWith("widget:")) return { ok: true, result: true } as any;
      if (Number(p.chat_id) !== owner) return prev(method, payload, signal);
      const prior = p.message_id ? screens.get(key(owner, p.message_id)) : undefined;
      const edit = method === "editMessageText" || method === "editMessageCaption" || (method === "editMessageReplyMarkup" && prior);
      const send = method === "sendMessage" || ((method === "sendPhoto" || method === "sendAnimation") && p.caption && p.reply_markup?.inline_keyboard);
      if (!send && !edit) return prev(method, payload, signal);
      const text = p.text ?? p.caption ?? prior?.text;
      const keyboard = p.reply_markup?.inline_keyboard ?? (method === "editMessageReplyMarkup" ? [] : prior?.keyboard ?? []);
      if (typeof text !== "string" || p.reply_markup?.keyboard || p.reply_markup?.force_reply || p.reply_markup?.remove_keyboard) return prev(method, payload, signal);
      const current = getWidgetSummary(ctx);
      const matchesSummary = current && (current.text === text || (text.endsWith("...") && current.text.startsWith(text.slice(0, -3))));
      const summary = matchesSummary ? current.summary : prior?.text === text ? prior.summary : undefined;
      const widget = buildWidget(text, keyboard, cfg.serviceName || "Личный кабинет", summary);
      const ordinaryMessage = async () => {
        if (!prior) return prev(method, payload, signal);
        const result = await prev("sendMessage", { chat_id: owner, text, reply_markup: { inline_keyboard: keyboard }, ...(p.parse_mode ? { parse_mode: p.parse_mode } : {}), ...(p.entities || p.caption_entities ? { entities: p.entities ?? p.caption_entities } : {}) } as any, signal);
        if (result.ok) {
          screens.delete(key(owner, p.message_id));
          await prev("deleteMessage", { chat_id: owner, message_id: p.message_id }, signal).catch(() => {});
        }
        return result;
      };
      if (!widget) return ordinaryMessage();
      const response = await prev("sendWidget" as any, {
        chat_id: owner, html: widget.html, allow_queries: true,
        ...(p.message_thread_id ? { message_thread_id: p.message_thread_id } : {}),
        ...(p.disable_notification ? { disable_notification: true } : {}),
        reply_markup: { inline_keyboard: [[{ text: "Обычное меню", callback_data: "widgets:classic" }]] },
      } as any, signal);
      if (!response.ok) {
        if ([400, 404].includes(response.error_code)) return ordinaryMessage();
        return response as any;
      }
      const sent = response.result as unknown as { message_id: number };
      screens.set(key(owner, sent.message_id), { owner, messageId: sent.message_id, text, keyboard, summary, expires: Date.now() + TTL, consumed: false, actions: widget.actions });
      if (edit && p.message_id) {
        screens.delete(key(owner, p.message_id));
        await prev("deleteMessage", { chat_id: owner, message_id: p.message_id }, signal).catch(() => {});
      }
      return response as any;
    });
    return next();
  };
}
