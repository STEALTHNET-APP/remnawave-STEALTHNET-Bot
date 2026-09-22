import { createHash, randomBytes } from "node:crypto";

export type Device = { hwid: string; platform?: string; deviceModel?: string; appName?: string; createdAt?: string };
export type DeviceSubscription = {
  id: string; type: "root" | "secondary"; subscriptionIndex: number | null;
  tariffDisplayName: string; subscription: unknown; isBanned?: boolean;
};
export type DeviceSource = {
  subscriptions(): Promise<DeviceSubscription[]>;
  devices(id: string): Promise<{ total: number; devices: Device[] }>;
  remove(subscription: DeviceSubscription, hwid: string): Promise<unknown>;
};
type Button = { text: string; callback_data: string };
export type DeviceScreen = { text: string; markup: { inline_keyboard: Button[][] } };
type State = {
  nonce: string; expires: number; subscriptions: DeviceSubscription[];
  selected?: DeviceSubscription; devices: Device[]; page: number; confirmation?: Device;
};
const PAGE_SIZE = 6;
const TTL = 30 * 60_000;
const MAX_SESSIONS = 5000;
const TITLE = "◈ УСТРОЙСТВА";
const menu: Button[] = [{ text: "⌂ Главное меню", callback_data: "menu:main" }];
const back: Button[] = [{ text: "‹ Выбрать подписку", callback_data: "menu:devices" }];

function clean(value: string, max = 55): string {
  return Array.from(Buffer.from(value, "utf8").toString("utf8").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")).slice(0, max).join("").trim();
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function subscriptionDeviceLimit(sub: unknown): unknown {
  const outer = record(sub);
  const inner = record(outer.response ?? outer.data ?? outer);
  for (const key of ["hwidDeviceLimit", "deviceLimit", "device_limit"]) {
    if (inner[key] !== undefined) return inner[key];
  }
  return undefined;
}
export function formatDeviceCount(count: number | null, limit: unknown): string {
  if (count === null) return "📱 Устройства: не удалось загрузить количество";
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return `📱 Подключено: ${count} из ${limit} · свободно ${Math.max(0, limit - count)}`;
  }
  if (limit === 0 || limit === null) return `📱 Подключено: ${count} · без лимита`;
  return `📱 Подключено: ${count} · лимит не указан`;
}
function status(sub: DeviceSubscription): string {
  const outer = record(sub.subscription);
  const inner = record(outer.response ?? outer.data ?? outer);
  const expire = inner.expireAt ?? inner.expire_at;
  const expiry = typeof expire === "number" ? expire * 1000 : typeof expire === "string" ? Date.parse(expire) : NaN;
  if (sub.isBanned) return "🚫 Заблокирована";
  if (inner.status === "EXPIRED" || expiry <= Date.now()) return "⚪ Истекла";
  if (inner.status === "DISABLED") return "🔴 Отключена";
  if (inner.status === "LIMITED") return "🟡 Ограничена";
  return inner.status === "ACTIVE" ? "🟢 Активна" : "⚪ Статус недоступен";
}
function label(sub: DeviceSubscription): string {
  return `Подписка #${sub.subscriptionIndex ?? 0} · ${clean(sub.tariffDisplayName, 32) || "VPN"}`;
}
function deviceLabel(device: Device): string {
  return clean(device.deviceModel || device.platform || "Устройство", 34) || "Устройство";
}
function tag(device: Device): string {
  return createHash("sha256").update(device.hwid).digest("hex").slice(0, 6).toUpperCase();
}
function screen(text: string, rows: Button[][]): DeviceScreen {
  return { text, markup: { inline_keyboard: rows } };
}

/** Nonces bind every destructive callback to an immutable selection in one user/chat. */
export class DeviceFlow {
  private readonly states = new Map<string, State>();
  private save(key: string, state: Omit<State, "nonce" | "expires">): State {
    const now = Date.now();
    for (const [id, stored] of this.states) if (stored.expires <= now) this.states.delete(id);
    this.states.delete(key);
    if (this.states.size >= MAX_SESSIONS) {
      const oldest = this.states.keys().next().value;
      if (oldest !== undefined) this.states.delete(oldest);
    }
    const next = { ...state, nonce: randomBytes(8).toString("hex"), expires: now + TTL };
    this.states.set(key, next);
    return next;
  }
  private callback(state: State, action: string): string { return `dev:${state.nonce}:${action}`; }
  private expired(): DeviceScreen {
    return screen(`${TITLE}\n\nЭтот экран устарел. Откройте список устройств заново.`, [back, menu]);
  }
  private subscriptions(key: string, subscriptions: DeviceSubscription[], page = 0): DeviceScreen {
    const pages = Math.max(1, Math.ceil(subscriptions.length / PAGE_SIZE));
    page = Math.max(0, Math.min(page, pages - 1));
    const state = this.save(key, { subscriptions, devices: [], page });
    const rows = subscriptions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((sub, i) => [{
      text: `${status(sub)} · #${sub.subscriptionIndex ?? 0} · ${clean(sub.tariffDisplayName, 28)}`,
      callback_data: this.callback(state, `sub:${page * PAGE_SIZE + i}`),
    }]);
    this.pagination(rows, state, pages);
    rows.push(menu);
    return screen(`${TITLE}\n\n${subscriptions.length ? "Выберите подписку\nУ каждой подписки свой список устройств." : "У вас пока нет подписок."}${pages > 1 ? `\n\nСтраница ${page + 1} из ${pages}` : ""}`, rows);
  }
  private pagination(rows: Button[][], state: State, pages: number): void {
    const row: Button[] = [];
    if (state.page > 0) row.push({ text: "‹ Назад", callback_data: this.callback(state, `page:${state.page - 1}`) });
    if (state.page + 1 < pages) row.push({ text: "Далее ›", callback_data: this.callback(state, `page:${state.page + 1}`) });
    if (row.length) rows.push(row);
  }
  private async devices(key: string, selected: DeviceSubscription, source: DeviceSource, page = 0, note = ""): Promise<DeviceScreen> {
    const rows: Button[][] = [];
    const lines = [TITLE, "", label(selected), status(selected), ""];
    if (note) lines.push(note, "");
    try {
      const result = await source.devices(selected.id);
      const devices = [...new Map(result.devices.map(d => [d.hwid, d])).values()];
      const pages = Math.max(1, Math.ceil(devices.length / PAGE_SIZE));
      page = Math.max(0, Math.min(page, pages - 1));
      const state = this.save(key, { subscriptions: [], selected, devices, page });
      lines.push(formatDeviceCount(devices.length, subscriptionDeviceLimit(selected.subscription)), "");
      if (!devices.length) lines.push("Здесь пока нет подключённых устройств.", "Добавьте ссылку этой подписки в приложение на нужном устройстве.");
      else {
        lines.push("Выберите устройство, чтобы посмотреть детали или удалить его.", "Считаются добавленные устройства, даже когда VPN выключен.");
        devices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((device, i) => rows.push([{
          text: `📱 ${deviceLabel(device)} · ${tag(device)}`,
          callback_data: this.callback(state, `device:${page * PAGE_SIZE + i}`),
        }]));
      }
      if (pages > 1) lines.push("", `Страница ${page + 1} из ${pages}`);
      this.pagination(rows, state, pages);
      rows.push([{ text: "↻ Обновить", callback_data: this.callback(state, "refresh") }]);
    } catch {
      this.states.delete(key);
      lines.push("Устройства не удалось загрузить. Попробуйте обновить список.");
      rows.push([{ text: "↻ Повторить", callback_data: `dev:open:${selected.id}` }]);
    }
    rows.push([{ text: "‹ К подписке", callback_data: `sub:detail:${selected.type}:${selected.id}` }], back);
    return screen(lines.join("\n"), rows);
  }
  async handle(key: string, data: string, source: DeviceSource): Promise<DeviceScreen> {
    if (data === "menu:devices" || data.startsWith("dev:open:")) {
      this.states.delete(key);
      try {
        const subscriptions = (await source.subscriptions()).sort((a, b) => (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0));
        if (data === "menu:devices") return this.subscriptions(key, subscriptions);
        const selected = subscriptions.find(s => s.id === data.slice("dev:open:".length));
        return selected ? this.devices(key, selected, source) : this.expired();
      } catch {
        return screen(`${TITLE}\n\nНе удалось загрузить подписки. Попробуйте ещё раз.`, [back, menu]);
      }
    }
    const match = /^dev:([a-f0-9]{16}):(sub|device|page|refresh|cancel|yes)(?::(\d+))?$/.exec(data);
    const state = this.states.get(key);
    if (!match || !state || state.expires <= Date.now() || state.nonce !== match[1]) return this.expired();
    // Consume synchronously before the first await: repeated clicks cannot replay a deletion.
    this.states.delete(key);
    const action = match[2];
    const index = match[3] === undefined ? NaN : Number(match[3]);
    if (action === "sub" && !state.selected) {
      const selected = state.subscriptions[index];
      return selected ? this.devices(key, selected, source) : this.expired();
    }
    if (action === "page" && Number.isSafeInteger(index)) {
      return state.selected ? this.devices(key, state.selected, source, index) : this.subscriptions(key, state.subscriptions, index);
    }
    if (!state.selected) return this.expired();
    if (action === "refresh" || action === "cancel") return this.devices(key, state.selected, source, state.page);
    if (action === "device") {
      const device = state.devices[index];
      if (!device) return this.expired();
      const next = this.save(key, { ...state, confirmation: device });
      const date = device.createdAt ? new Date(device.createdAt) : null;
      const details = [TITLE, "", label(state.selected), "", `📱 ${deviceLabel(device)} · ${tag(device)}`];
      if (device.platform) details.push(`Система: ${clean(device.platform)}`);
      if (device.appName) details.push(`Приложение: ${clean(device.appName)}`);
      if (date && Number.isFinite(date.getTime())) details.push(`Добавлено: ${date.toLocaleDateString("ru-RU")}`);
      details.push("", "Удалить устройство из этой подписки?", "Оно освободит место в списке. При повторном подключении может добавиться снова.");
      return screen(details.join("\n"), [
        [{ text: "🗑 Да, удалить", callback_data: this.callback(next, "yes") }],
        [{ text: "‹ Отмена", callback_data: this.callback(next, "cancel") }],
      ]);
    }
    if (action === "yes" && state.confirmation) {
      try { await source.remove(state.selected, state.confirmation.hwid); }
      catch { return this.devices(key, state.selected, source, state.page, "Не удалось удалить устройство. Обновите список и попробуйте ещё раз."); }
      return this.devices(key, state.selected, source, state.page, "✓ Устройство удалено из этой подписки.");
    }
    return this.expired();
  }
}
