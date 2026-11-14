import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeHtml,
  formatTicketReplySnippet,
  buildTelegramReplyPayload,
  buildEmailReplyPayload,
} from "./ticket-client-notify.service.js";

test("escapeHtml properly sanitizes HTML characters", () => {
  const unsafe = '<script>alert("XSS")</script> & "hello"';
  const safe = escapeHtml(unsafe);
  assert.equal(safe, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt; &amp; &quot;hello&quot;');
});

test("formatTicketReplySnippet truncates long messages to 300 characters", () => {
  const longText = "A".repeat(350);
  const snippet = formatTicketReplySnippet(longText);
  assert.equal(snippet.length, 300);
  assert.ok(snippet.endsWith("..."));
  assert.equal(snippet.slice(0, 297), "A".repeat(297));
});

test("formatTicketReplySnippet returns fallback placeholder when text is empty but attachments exist", () => {
  const ruSnippet = formatTicketReplySnippet("   ", 2, false);
  assert.equal(ruSnippet, "📎 (Прикреплены файлы)");

  const enSnippet = formatTicketReplySnippet("", 1, true);
  assert.equal(enSnippet, "📎 (Attached files)");
});

test("buildTelegramReplyPayload formats Russian message with inline keyboard", () => {
  const payload = buildTelegramReplyPayload({
    subject: "Проблема с <подключением>",
    snippet: "Мы перезагрузили ваш профиль",
    attachmentsCount: 1,
    hasText: true,
    ticketUrl: "https://vpn.example.com/cabinet/tickets?id=t-123",
    isEn: false,
  });

  assert.ok(payload.text.includes("💬 <b>Ответ службы поддержки</b>"));
  assert.ok(payload.text.includes("Проблема с &lt;подключением&gt;"));
  assert.ok(payload.text.includes("<blockquote>Мы перезагрузили ваш профиль</blockquote>"));
  assert.ok(payload.text.includes("Прикреплено файлов: 1"));
  assert.deepEqual(payload.replyMarkup, {
    inline_keyboard: [[{ text: "💬 Открыть обращение", web_app: { url: "https://vpn.example.com/cabinet/tickets?id=t-123" } }]],
  });
});

test("buildTelegramReplyPayload formats English message correctly", () => {
  const payload = buildTelegramReplyPayload({
    subject: "Connection issue",
    snippet: "Your issue has been resolved",
    hasText: true,
    isEn: true,
  });

  assert.ok(payload.text.includes("💬 <b>Support Reply</b>"));
  assert.ok(payload.text.includes("Connection issue"));
  assert.ok(payload.text.includes("<blockquote>Your issue has been resolved</blockquote>"));
  assert.equal(payload.replyMarkup, undefined);
});

test("buildEmailReplyPayload produces branded email with sanitized content", () => {
  const payload = buildEmailReplyPayload({
    serviceName: "AcmeVPN",
    subject: "Вопрос по тарифу <VIP>",
    snippet: "Вам начислен дополнительный трафик",
    attachmentsCount: 0,
    ticketUrl: "https://vpn.example.com/cabinet/tickets?id=t-456",
    isEn: false,
  });

  assert.equal(payload.emailSubject, "💬 Ответ службы поддержки по обращению «Вопрос по тарифу <VIP>» — AcmeVPN");
  assert.ok(payload.html.includes("AcmeVPN"));
  assert.ok(payload.html.includes("Вопрос по тарифу &lt;VIP&gt;"));
  assert.ok(payload.html.includes("Вам начислен дополнительный трафик"));
  assert.ok(payload.html.includes("https://vpn.example.com/cabinet/tickets?id=t-456"));
  assert.ok(payload.html.includes("Перейти к тикету"));
});

test("buildTelegramReplyPayload falls back to standard url when scheme is not https", () => {
  const payload = buildTelegramReplyPayload({
    subject: "Local test",
    snippet: "Testing fallback",
    hasText: true,
    ticketUrl: "http://localhost:3000/cabinet/tickets?id=t-789",
    isEn: false,
  });

  assert.deepEqual(payload.replyMarkup, {
    inline_keyboard: [[{ text: "💬 Открыть обращение", url: "http://localhost:3000/cabinet/tickets?id=t-789" }]],
  });
});
