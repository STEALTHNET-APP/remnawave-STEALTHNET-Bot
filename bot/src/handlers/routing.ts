export type CallbackDomain =
  | "admin"
  | "start"
  | "tariffs"
  | "subscriptions"
  | "profile"
  | "gifts"
  | "payments"
  | "support";

export function resolveCallbackDomain(data: string): CallbackDomain | null {
  if (data.startsWith("yk_recpt:")) return "payments";
  if (data === "welcome:continue") return "start";
  if (data.startsWith("admin:")) return "admin";
  if (data === "check_subscribe") return "start";
  if (data === "menu:main") return "start";
  if (data === "menu:support") return "support";
  if (data === "menu:docs") return "start";
  if (data.startsWith("loc:") || data.startsWith("menu:locations:")) return "start";
  if (data === "menu:tg_proxy") return "start";
  if (data === "menu:video_instructions") return "start";
  if (data.startsWith("vinstr:")) return "start";
  if (data === "menu:video_instructions_fresh") return "start";
  if (data === "menu:roulette") return "start";
  if (data === "menu:tariffs") return "tariffs";
  if (data.startsWith("cat_tariffs:")) return "tariffs";
  if (data === "menu:proxy") return "tariffs";
  if (data.startsWith("cat_proxy:")) return "tariffs";
  if (data === "menu:singbox") return "tariffs";
  if (data.startsWith("cat_singbox:")) return "tariffs";
  if (data.startsWith("singbox:conf:")) return "subscriptions";
  if (data === "menu:my_singbox") return "tariffs";
  if (data === "menu:my_proxy") return "tariffs";
  if (data === "menu:extra_options") return "tariffs";
  if (data.startsWith("extra_opt_pick:")) return "tariffs";
  if (data.startsWith("extra_opt_setsub:")) return "tariffs";
  if (data.startsWith("topt:")) return "tariffs";
  if (data.startsWith("pay_ext_keep:") || data.startsWith("pay_ext_drop:")) return "tariffs";
  if (data.startsWith("tdev:")) return "tariffs";
  if (data === "trialrepl:next") return "tariffs";
  if (data === "convx:toggle") return "tariffs";
  if (data.startsWith("pay_ext_pickt:")) return "tariffs";
  if (data.startsWith("pay_tariff_ext:")) return "subscriptions";
  if (data === "menu:renew" || data.startsWith("renew_pick:")) return "subscriptions";
  if (data === "menu:vpn") return "subscriptions";
  if (data === "menu:my_subs") return "subscriptions";
  if (data.startsWith("sub:")) return "subscriptions";
  if (data === "menu:devices" || data.startsWith("dev:") || data.startsWith("devices:delete:")) return "subscriptions";
  if (data === "menu:profile") return "profile";
  if (data === "profile:lang") return "profile";
  if (data.startsWith("set_lang:")) return "profile";
  if (data === "profile:currency") return "profile";
  if (data.startsWith("set_currency:")) return "profile";
  if (data.startsWith("profile:autorenew:")) return "profile";
  if (data === "menu:balance") return "profile";
  if (data === "menu:referral") return "profile";
  if (data.startsWith("withdraw:")) return "profile";
  if (data === "menu:promocode") return "profile";
  if (data === "menu:topup") return "payments";
  if (data.startsWith("topup")) return "payments";
  if (data.startsWith("pay_proxy_") || data.startsWith("pay_singbox_")) return "payments";
  if (data.startsWith("pay_proxy:") || data.startsWith("pay_singbox:")) return "payments";
  if (data.startsWith("pay_tariff_")) return "payments";
  if (data.startsWith("pay_tariff:")) return "payments";
  if (data.startsWith("pay_option_")) return "payments";
  if (data.startsWith("pay_option:")) return "payments";
  if (data === "menu:cloudtrial") return "payments";
  if (data === "menu:trial") return "payments";
  if (data.startsWith("trial:activate:") || data.startsWith("trial:buy:") || data === "trial:confirm") return "payments";
  if (data === "menu:gift") return "gifts";
  if (data.startsWith("gift_")) return "gifts";
  if (data.startsWith("gift:")) return "gifts";
  return null;
}
