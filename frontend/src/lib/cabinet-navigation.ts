export function cabinetSection(pathname: string): string {
  if (pathname.startsWith("/cabinet/tickets") || pathname.startsWith("/cabinet/documents/")) return "/cabinet/help";
  if (pathname === "/cabinet/subscribe") return "/cabinet/dashboard";
  return pathname.replace(/\/$/, "");
}

export function cabinetSubscriptionUnavailable(input: {
  requestFailed: boolean;
  subscription: unknown;
  message?: string | null;
  offlineSnapshot?: boolean;
}): boolean {
  return input.requestFailed || input.offlineSnapshot === true || Boolean(
    input.message && !input.subscription && input.message !== "Подписка не привязана"
  );
}
