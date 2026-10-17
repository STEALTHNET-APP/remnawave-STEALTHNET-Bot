const paths = new Set([
  "/cabinet/dashboard", "/cabinet/tariffs", "/cabinet/profile", "/cabinet/referral",
  "/cabinet/subscribe", "/cabinet/tickets", "/cabinet/proxy", "/cabinet/singbox",
  "/cabinet/gifts", "/cabinet/roulette", "/cabinet/extra-options",
  ...["devices", "topup", "trial", "promocode", "support", "tg-proxy"].map(section => `/cabinet/menu/${section}`),
]);

export function clientMenuReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/cabinet/")) return "/cabinet/dashboard";
  try {
    const url = new URL(value, "https://cabinet.invalid");
    if (url.origin !== "https://cabinet.invalid" || !paths.has(url.pathname)) return "/cabinet/dashboard";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/cabinet/dashboard";
  }
}
