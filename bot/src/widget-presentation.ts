import type { Context } from "grammy";

import type { WidgetSummary } from "./widget-content.js";
export { escapeWidgetText, cleanWidgetLabel, splitWidgetText, widgetContentPages } from "./widget-content.js";
export type { WidgetSummary } from "./widget-content.js";

const summaries = new WeakMap<Context, { text: string; summary: WidgetSummary }>();
export function setWidgetSummary(ctx: Context, text: string, summary?: WidgetSummary) {
  if (summary) summaries.set(ctx, { text, summary });
}
export const getWidgetSummary = (ctx: Context) => summaries.get(ctx);
