import type { Context } from "grammy";

export type WidgetSummary = {
  balance?: string;
  tariff?: string;
  status?: string;
  details: Array<{ label: string; value: string }>;
  account?: string;
  note?: string;
};

export const escapeWidgetText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const cleanWidgetLabel = (s: string) => s.replace(/^[\s\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]+/u, "").trim();

export function splitWidgetText(text: string): string[] {
  const pages: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 260 || remaining.split("\n").length > 9) {
    const lines = remaining.split("\n").slice(0, 9).join("\n").length;
    const limit = Math.min(260, lines);
    const line = remaining.lastIndexOf("\n", limit);
    const space = remaining.lastIndexOf(" ", limit);
    let end = line >= limit / 2 ? line + 1 : space > 0 ? space + 1 : limit;
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end--;
    pages.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining || !pages.length) pages.push(remaining);
  return pages;
}

export function widgetContentPages(text: string, summary?: WidgetSummary): string[] {
  const e = escapeWidgetText;
  const prose = (content: string) => `<div class="prose">${e(content.trim())}</div>`;
  if (summary) {
    const details = summary.details.map(row => `<div class="row"><span class="label">${e(row.label)}</span><span class="value">${e(row.value)}</span></div>`).join("");
    const balance = summary.balance ? `<div class="balance"><span class="label">Баланс</span><strong>${e(summary.balance)}</strong></div>` : "";
    const tariff = summary.tariff ? `<h2>${e(summary.tariff)}</h2>` : "";
    const status = summary.status ? `<div class="status">${e(summary.status)}</div>` : "";
    const account = summary.account ? `<div class="account">ID ${e(summary.account)}</div>` : "";
    return [`${balance}<section>${tariff}${status}${details}</section>${account}`, ...(summary.note ? splitWidgetText(summary.note).map(prose) : [])];
  }
  return splitWidgetText(text).map((page, index) => {
    const lines = page.trim().split("\n");
    const first = lines[0] || "";
    if (index === 0 && first.length <= 85) {
      return `<h2>${e(cleanWidgetLabel(first))}</h2>${prose(lines.slice(1).join("\n"))}`;
    }
    return prose(page);
  });
}

const summaries = new WeakMap<Context, { text: string; summary: WidgetSummary }>();
export function setWidgetSummary(ctx: Context, text: string, summary?: WidgetSummary) {
  if (summary) summaries.set(ctx, { text, summary });
}
export const getWidgetSummary = (ctx: Context) => summaries.get(ctx);
