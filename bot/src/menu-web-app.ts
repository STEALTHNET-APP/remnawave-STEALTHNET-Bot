const routes: Record<string, string> = {
  tariffs: "tariffs",
  proxy: "proxy",
  my_proxy: "proxy",
  singbox: "singbox",
  my_singbox: "singbox",
  profile: "profile",
  devices: "menu/devices",
  topup: "menu/topup",
  referral: "referral",
  trial: "menu/trial",
  vpn: "subscribe",
  support: "menu/support",
  promocode: "menu/promocode",
  extra_options: "extra-options",
  gift: "gifts",
  roulette: "roulette",
  my_subs: "dashboard",
  tg_proxy: "menu/tg-proxy",
  cabinet: "dashboard",
  tickets: "tickets",
};

export function menuWebAppUrl(base: string, buttonId: string): string | null {
  if (!Object.hasOwn(routes, buttonId)) return null;
  try {
    const url = new URL(base.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/cabinet/${routes[buttonId]}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
