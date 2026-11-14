type DeviceNavigator = { userAgent?: string; platform?: string; userAgentData?: { platform?: string } };
export function usesCommandKey(device: DeviceNavigator = typeof navigator === "undefined" ? {} : navigator): boolean {
  const platform = device.userAgentData?.platform;
  if (platform) return /mac|ios|ipados/i.test(platform);
  const agent = device.userAgent ?? "";
  if (/android|windows|cros/i.test(agent)) return false;
  if (/macintosh|mac os|iphone|ipad|ipod/i.test(agent)) return true;
  return /mac|iphone|ipad|ipod/i.test(device.platform ?? "");
}
export function searchShortcut(device?: DeviceNavigator) {
  const command = usesCommandKey(device);
  return { label: command ? "⌘ K" : "Ctrl K", aria: command ? "Meta+K" : "Control+K" };
}
type ShortcutEvent = Pick<KeyboardEvent, "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing">;
export function isSearchShortcut(event: ShortcutEvent, command: boolean): boolean {
  if (event.isComposing || event.altKey || event.shiftKey) return false;
  const modifier = command ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const key = event.code ? event.code === "KeyK" : /^(k|л)$/i.test(event.key);
  return modifier && key;
}
export const OPEN_ADMIN_SEARCH = "stealthnet:open-admin-search";
export function openAdminSearch() { window.dispatchEvent(new Event(OPEN_ADMIN_SEARCH)); }
