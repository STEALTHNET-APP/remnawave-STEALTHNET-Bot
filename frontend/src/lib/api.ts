const API_BASE = "/api";

/** Вызывается при 401: возвращает новый access token или null. Устанавливается из AuthProvider. */
let tokenRefreshFn: (() => Promise<string | null>) | null = null;
export function setTokenRefreshFn(fn: (() => Promise<string | null>) | null) {
  tokenRefreshFn = fn;
}

export interface Admin {
  id: string;
  email: string;
  mustChangePassword: boolean;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  admin: Admin;
}

export interface AuthState {
  admin: Admin | null;
  accessToken: string | null;
  refreshToken: string | null;
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string; _retry?: boolean } = {}
): Promise<T> {
  const { token, _retry, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(res.statusText || "Request failed");
  }

  if (res.status === 401 && token && !_retry && tokenRefreshFn && !path.startsWith("/auth/")) {
    const newToken = await tokenRefreshFn();
    if (newToken) {
      return request<T>(path, { ...options, token: newToken, _retry: true });
    }
  }

  if (!res.ok) {
    const message = (data as { message?: string })?.message ?? res.statusText;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  async login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: string; admin: Admin }> {
    return request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  },

  async logout(refreshToken: string | null) {
    if (refreshToken) {
      await request("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    }
  },

  async changePassword(
    currentPassword: string,
    newPassword: string,
    token: string
  ): Promise<{ success: boolean; message: string; admin: Admin }> {
    return request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
      token,
    });
  },

  async getMe(token: string): Promise<Admin> {
    return request<Admin>("/admin/me", { token });
  },

  async getRemnaStatus(token: string): Promise<{ configured: boolean }> {
    return request("/admin/remna/status", { token });
  },

  async getDashboardStats(token: string): Promise<DashboardStats> {
    return request("/admin/dashboard/stats", { token });
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getAnalytics(token: string): Promise<any> {
    return request("/admin/analytics", { token });
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getSalesReport(token: string, params?: { from?: string; to?: string; provider?: string; page?: number; limit?: number }): Promise<any> {
    const search = new URLSearchParams();
    if (params?.from) search.set("from", params.from);
    if (params?.to) search.set("to", params.to);
    if (params?.provider) search.set("provider", params.provider);
    if (params?.page) search.set("page", String(params.page));
    if (params?.limit) search.set("limit", String(params.limit));
    const q = search.toString();
    return request(`/admin/sales-report${q ? `?${q}` : ""}`, { token });
  },

  async getRemnaSystemStats(token: string): Promise<RemnaSystemStats> {
    return request("/admin/remna/system/stats", { token });
  },

  async getRemnaNodes(token: string): Promise<RemnaNodesResponse> {
    return request("/admin/remna/nodes", { token });
  },

  async remnaNodeEnable(token: string, nodeUuid: string): Promise<unknown> {
    return request(`/admin/remna/nodes/${nodeUuid}/enable`, { method: "POST", token });
  },

  async remnaNodeDisable(token: string, nodeUuid: string): Promise<unknown> {
    return request(`/admin/remna/nodes/${nodeUuid}/disable`, { method: "POST", token });
  },

  async remnaNodeRestart(token: string, nodeUuid: string): Promise<unknown> {
    return request(`/admin/remna/nodes/${nodeUuid}/restart`, { method: "POST", token });
  },

  async getClients(
    token: string,
    page = 1,
    limit = 20,
    params?: { search?: string; isBlocked?: boolean }
  ): Promise<{ items: ClientRecord[]; total: number; page: number; limit: number }> {
    const sp = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (params?.search?.trim()) sp.set("search", params.search.trim());
    if (params?.isBlocked === true) sp.set("isBlocked", "true");
    if (params?.isBlocked === false) sp.set("isBlocked", "false");
    return request(`/admin/clients?${sp.toString()}`, { token });
  },

  async getClient(token: string, id: string): Promise<ClientRecord> {
    return request(`/admin/clients/${id}`, { token });
  },

  async updateClient(token: string, id: string, data: UpdateClientPayload): Promise<ClientRecord> {
    return request(`/admin/clients/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async setClientPassword(token: string, clientId: string, newPassword: string): Promise<{ success: boolean; message?: string }> {
    return request(`/admin/clients/${clientId}/password`, {
      method: "PATCH",
      body: JSON.stringify({ newPassword }),
      token,
    });
  },

  async deleteClient(token: string, id: string): Promise<{ success: boolean }> {
    return request(`/admin/clients/${id}`, { method: "DELETE", token });
  },

  async getClientRemna(token: string, clientId: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna`, { token });
  },

  async updateClientRemna(token: string, clientId: string, data: UpdateClientRemnaPayload): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async clientRemnaRevokeSubscription(token: string, clientId: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/revoke-subscription`, { method: "POST", token });
  },

  async clientRemnaDisable(token: string, clientId: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/disable`, { method: "POST", token });
  },

  async clientRemnaEnable(token: string, clientId: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/enable`, { method: "POST", token });
  },

  async clientRemnaResetTraffic(token: string, clientId: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/reset-traffic`, { method: "POST", token });
  },

  async clientRemnaSquadAdd(token: string, clientId: string, squadUuid: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/squads/add`, { method: "POST", body: JSON.stringify({ squadUuid }), token });
  },

  async clientRemnaSquadRemove(token: string, clientId: string, squadUuid: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/squads/remove`, { method: "POST", body: JSON.stringify({ squadUuid }), token });
  },

  async getRemnaSubscriptionTemplates(token: string): Promise<unknown> {
    return request("/admin/remna/subscription-templates", { token });
  },

  async getRemnaSquadsInternal(token: string): Promise<unknown> {
    return request("/admin/remna/squads/internal", { token });
  },

  async getSettings(token: string): Promise<AdminSettings> {
    return request("/admin/settings", { token });
  },

  /** Базовый конфиг страницы подписки для визуального редактора (subpage-*.json) */
  async getDefaultSubscriptionPageConfig(token: string): Promise<SubscriptionPageConfig | null> {
    return request("/admin/default-subscription-page-config", { token });
  },

  async updateSettings(token: string, data: UpdateSettingsPayload): Promise<AdminSettings> {
    return request("/admin/settings", { method: "PATCH", body: JSON.stringify(data), token });
  },

  async syncFromRemna(token: string): Promise<SyncResult> {
    return request("/admin/sync/from-remna", { method: "POST", token });
  },

  async syncToRemna(token: string): Promise<SyncToRemnaResult> {
    return request("/admin/sync/to-remna", { method: "POST", token });
  },

  async syncCreateRemnaForMissing(token: string): Promise<SyncCreateRemnaForMissingResult> {
    return request("/admin/sync/create-remna-for-missing", { method: "POST", token });
  },

  /** Создать бэкап БД (скачать SQL) */
  async createBackup(token: string): Promise<{ blob: Blob; filename: string }> {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/backup/create`, { headers });
    if (res.status === 401 && token && tokenRefreshFn) {
      const newToken = await tokenRefreshFn();
      if (newToken) return api.createBackup(newToken);
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const d = JSON.parse(text);
        if (d.message) msg = d.message;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const filename = match ? match[1].trim() : `stealthnet-backup-${new Date().toISOString().slice(0, 10)}.sql`;
    return { blob, filename };
  },

  /** Список сохранённых на сервере бэкапов */
  async getBackupList(token: string): Promise<{ items: { path: string; filename: string; date: string; size: number }[] }> {
    return request("/admin/backup/list", { token });
  },

  /** Скачать бэкап с сервера по пути (path из списка) */
  async downloadBackup(token: string, path: string): Promise<{ blob: Blob; filename: string }> {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/backup/download?path=${encodeURIComponent(path)}`, { headers });
    if (res.status === 401 && token && tokenRefreshFn) {
      const newToken = await tokenRefreshFn();
      if (newToken) return api.downloadBackup(newToken, path);
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const d = JSON.parse(text);
        if (d.message) msg = d.message;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const filename = match ? match[1].trim() : path.split("/").pop() || "backup.sql";
    return { blob, filename };
  },

  /** Восстановить БД из бэкапа на сервере (path из списка) */
  async restoreBackupFromServer(token: string, path: string): Promise<{ message: string }> {
    return request("/admin/backup/restore", {
      method: "POST",
      body: JSON.stringify({ confirm: "RESTORE", path }),
      token,
    });
  },

  /** Восстановить БД из загруженного SQL-файла */
  async restoreBackup(token: string, file: File): Promise<{ message: string }> {
    const form = new FormData();
    form.append("file", file);
    form.append("confirm", "RESTORE");
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/backup/restore`, { method: "POST", body: form, headers });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      throw new Error(res.statusText || "Request failed");
    }
    if (res.status === 401 && token && tokenRefreshFn) {
      const newToken = await tokenRefreshFn();
      if (newToken) return api.restoreBackup(newToken, file);
    }
    if (!res.ok) {
      const message = (data as { message?: string })?.message ?? res.statusText;
      throw new Error(message);
    }
    return data as { message: string };
  },

  async getTariffCategories(token: string): Promise<{ items: TariffCategoryWithTariffs[] }> {
    return request("/admin/tariff-categories", { token });
  },

  async createTariffCategory(token: string, data: { name: string; sortOrder?: number; emojiKey?: string | null }): Promise<TariffCategoryRecord> {
    return request("/admin/tariff-categories", { method: "POST", body: JSON.stringify(data), token });
  },

  async updateTariffCategory(token: string, id: string, data: { name?: string; sortOrder?: number; emojiKey?: string | null }): Promise<TariffCategoryRecord> {
    return request(`/admin/tariff-categories/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deleteTariffCategory(token: string, id: string): Promise<{ success: boolean }> {
    return request(`/admin/tariff-categories/${id}`, { method: "DELETE", token });
  },

  async getTariffs(token: string, categoryId?: string): Promise<{ items: TariffRecord[] }> {
    const q = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : "";
    return request(`/admin/tariffs${q}`, { token });
  },

  async createTariff(token: string, data: CreateTariffPayload): Promise<TariffRecord> {
    return request("/admin/tariffs", { method: "POST", body: JSON.stringify(data), token });
  },

  async updateTariff(token: string, id: string, data: UpdateTariffPayload): Promise<TariffRecord> {
    return request(`/admin/tariffs/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deleteTariff(token: string, id: string): Promise<{ success: boolean }> {
    return request(`/admin/tariffs/${id}`, { method: "DELETE", token });
  },

  // ——— Кабинет клиента (клиентский API) ———
  async clientLogin(email: string, password: string): Promise<ClientAuthResponse> {
    return request("/client/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  async clientRegister(data: ClientRegisterPayload): Promise<ClientAuthResponse | { message: string; requiresVerification: true }> {
    return request("/client/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async clientVerifyEmail(token: string): Promise<ClientAuthResponse> {
    return request("/client/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },

  /** Авторизация по initData из Telegram Mini App (Web App) */
  async clientAuthByTelegramMiniapp(initData: string): Promise<ClientAuthResponse> {
    return request("/client/auth/telegram-miniapp", {
      method: "POST",
      body: JSON.stringify({ initData }),
    });
  },

  async clientMe(token: string): Promise<ClientProfile> {
    return request("/client/auth/me", { token });
  },

  async clientSubscription(token: string): Promise<{ subscription: unknown; message?: string }> {
    return request("/client/subscription", { token });
  },

  async clientPayments(token: string): Promise<{ items: ClientPayment[] }> {
    return request("/client/payments", { token });
  },

  async clientCreatePlategaPayment(
    token: string,
    data: { amount: number; currency: string; paymentMethod: number; description?: string; tariffId?: string; promoCode?: string }
  ): Promise<{ paymentUrl: string; orderId: string; paymentId: string; discountApplied?: boolean; finalAmount?: number }> {
    return request("/client/payments/platega", { method: "POST", body: JSON.stringify(data), token });
  },

  async getPublicTariffs(): Promise<{ items: PublicTariffCategory[] }> {
    return request("/public/tariffs");
  },

  async getPublicConfig(): Promise<PublicConfig> {
    return request("/public/config");
  },

  /** Конфиг страницы подписки (приложения по платформам) для /cabinet/subscribe */
  async getPublicSubscriptionPageConfig(): Promise<SubscriptionPageConfig | null> {
    return request("/public/subscription-page");
  },

  async clientPayByBalance(
    token: string,
    data: { tariffId: string; promoCode?: string }
  ): Promise<{ message: string; paymentId: string; newBalance: number }> {
    return request("/client/payments/balance", { method: "POST", body: JSON.stringify(data), token });
  },

  async getYoomoneyAuthUrl(token: string): Promise<{ url: string }> {
    return request("/client/yoomoney/auth-url", { token });
  },
  /** Форма перевода ЮMoney (оплата картой). Пополнение баланса или покупка тарифа (tariffId опционально). */
  async yoomoneyCreateFormPayment(
    token: string,
    data: { amount: number; paymentType: "PC" | "AC"; tariffId?: string }
  ): Promise<{ paymentId: string; paymentUrl: string; form: { receiver: string; sum: number; label: string; paymentType: string; successURL: string }; successURL: string }> {
    return request("/client/yoomoney/create-form-payment", { method: "POST", body: JSON.stringify(data), token });
  },
  async yoomoneyFormPaymentParams(token: string, paymentId: string): Promise<{ receiver: string; sum: number; label: string; paymentType: string; successURL: string }> {
    return request(`/client/yoomoney/form-payment/${encodeURIComponent(paymentId)}`, { token });
  },
  async yoomoneyRequestTopup(token: string, amount: number): Promise<{ paymentId: string; request_id: string; money_source: Record<string, unknown>; contract_amount?: number }> {
    return request("/client/yoomoney/request-topup", { method: "POST", body: JSON.stringify({ amount }), token });
  },
  async yoomoneyProcessPayment(
    token: string,
    data: { paymentId: string; request_id: string; money_source?: string; csc?: string }
  ): Promise<{ message: string; newBalance: number }> {
    return request("/client/yoomoney/process-payment", { method: "POST", body: JSON.stringify(data), token });
  },

  async clientActivateTrial(token: string): Promise<{ message: string; client: ClientProfile | null }> {
    return request("/client/trial", { method: "POST", token });
  },

  async clientUpdateProfile(token: string, data: { preferredLang?: string; preferredCurrency?: string }): Promise<ClientProfile> {
    return request("/client/profile", { method: "PATCH", body: JSON.stringify(data), token });
  },

  async getClientReferralStats(token: string): Promise<ClientReferralStats> {
    return request("/client/referral-stats", { token });
  },

  // ——— Промо-группы (админ) ———
  async getPromoGroups(token: string): Promise<PromoGroup[]> {
    return request("/admin/promo-groups", { token });
  },

  async getPromoGroup(token: string, id: string): Promise<PromoGroupDetail> {
    return request(`/admin/promo-groups/${id}`, { token });
  },

  async createPromoGroup(token: string, data: CreatePromoGroupPayload): Promise<PromoGroup> {
    return request("/admin/promo-groups", { method: "POST", body: JSON.stringify(data), token });
  },

  async updatePromoGroup(token: string, id: string, data: UpdatePromoGroupPayload): Promise<PromoGroup> {
    return request(`/admin/promo-groups/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deletePromoGroup(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/admin/promo-groups/${id}`, { method: "DELETE", token });
  },

  // ——— Промокоды (админ) ———
  async getPromoCodes(token: string): Promise<PromoCodeRecord[]> {
    return request("/admin/promo-codes", { token });
  },

  async getPromoCode(token: string, id: string): Promise<PromoCodeDetail> {
    return request(`/admin/promo-codes/${id}`, { token });
  },

  async createPromoCode(token: string, data: CreatePromoCodePayload): Promise<PromoCodeRecord> {
    return request("/admin/promo-codes", { method: "POST", body: JSON.stringify(data), token });
  },

  async updatePromoCode(token: string, id: string, data: UpdatePromoCodePayload): Promise<PromoCodeRecord> {
    return request(`/admin/promo-codes/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deletePromoCode(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/admin/promo-codes/${id}`, { method: "DELETE", token });
  },

  // ——— Промокоды (клиент) ———
  async clientCheckPromoCode(token: string, code: string): Promise<{ type: string; discountPercent?: number | null; discountFixed?: number | null; durationDays?: number | null; name: string }> {
    return request("/client/promo-code/check", { method: "POST", body: JSON.stringify({ code }), token });
  },

  async clientActivatePromoCode(token: string, code: string): Promise<{ message: string }> {
    return request("/client/promo-code/activate", { method: "POST", body: JSON.stringify({ code }), token });
  },
};

export interface ClientReferralStats {
  referralCode: string | null;
  referralPercent: number;
  referralPercentLevel2: number;
  referralPercentLevel3: number;
  referralCount: number;
  totalEarnings: number;
}

export interface SyncResult {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface SyncToRemnaResult {
  ok: boolean;
  updated: number;
  errors: string[];
}

export interface SyncCreateRemnaForMissingResult {
  ok: boolean;
  created: number;
  linked: number;
  errors: string[];
}

export type UpdateSettingsPayload = {
  activeLanguages?: string;
  activeCurrencies?: string;
  defaultLanguage?: string;
  defaultCurrency?: string;
  defaultReferralPercent?: number;
  referralPercentLevel2?: number;
  referralPercentLevel3?: number;
  trialDays?: number;
  trialSquadUuid?: string | null;
  trialDeviceLimit?: number | null;
  trialTrafficLimitBytes?: number | null;
  serviceName?: string;
  logo?: string | null;
  favicon?: string | null;
  remnaClientUrl?: string | null;
  smtpHost?: string | null;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  smtpFromEmail?: string | null;
  smtpFromName?: string | null;
  publicAppUrl?: string | null;
  telegramBotToken?: string | null;
  telegramBotUsername?: string | null;
  plategaMerchantId?: string | null;
  plategaSecret?: string | null;
  plategaMethods?: string | null;
  yoomoneyClientId?: string | null;
  yoomoneyClientSecret?: string | null;
  yoomoneyReceiverWallet?: string | null;
  yoomoneyNotificationSecret?: string | null;
  botButtons?: string | null;
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | string | null;
  botBackLabel?: string | null;
  botMenuTexts?: string | null;
  botInnerButtonStyles?: string | null;
  subscriptionPageConfig?: string | null;
  supportLink?: string | null;
  agreementLink?: string | null;
  offerLink?: string | null;
  instructionsLink?: string | null;
  themeAccent?: string;
  forceSubscribeEnabled?: boolean;
  forceSubscribeChannelId?: string | null;
  forceSubscribeMessage?: string | null;
};

export interface ClientRecord {
  id: string;
  email: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  preferredLang: string;
  preferredCurrency: string;
  balance: number;
  referralCode: string | null;
  remnawaveUuid: string | null;
  trialUsed: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  referralPercent: number | null;
  createdAt: string;
  /** Количество приглашённых рефералов (приходит с бэкенда) */
  _count?: { referrals: number };
}

export type UpdateClientPayload = {
  email?: string | null;
  preferredLang?: string;
  preferredCurrency?: string;
  balance?: number;
  isBlocked?: boolean;
  blockReason?: string | null;
  referralPercent?: number | null;
};

export type UpdateClientRemnaPayload = {
  trafficLimitBytes?: number;
  trafficLimitStrategy?: "NO_RESET" | "DAY" | "WEEK" | "MONTH";
  hwidDeviceLimit?: number | null;
  expireAt?: string;
  activeInternalSquads?: string[];
  status?: "ACTIVE" | "DISABLED";
};

export interface AdminSettings {
  activeLanguages: string[];
  activeCurrencies: string[];
  defaultLanguage?: string;
  defaultCurrency?: string;
  defaultReferralPercent: number;
  referralPercentLevel2: number;
  referralPercentLevel3: number;
  trialDays: number;
  trialSquadUuid?: string | null;
  trialDeviceLimit?: number | null;
  trialTrafficLimitBytes?: number | null;
  serviceName: string;
  logo?: string | null;
  favicon?: string | null;
  remnaClientUrl?: string | null;
  smtpHost?: string | null;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  smtpFromEmail?: string | null;
  smtpFromName?: string | null;
  publicAppUrl?: string | null;
  telegramBotToken?: string | null;
  telegramBotUsername?: string | null;
  plategaMerchantId?: string | null;
  plategaSecret?: string | null;
  plategaMethods?: { id: number; enabled: boolean; label: string }[];
  yoomoneyClientId?: string | null;
  yoomoneyClientSecret?: string | null;
  yoomoneyReceiverWallet?: string | null;
  yoomoneyNotificationSecret?: string | null;
  /** Кнопки главного меню бота: порядок, видимость, текст, стиль, ключ эмодзи (TRIAL, PACKAGE, …) */
  botButtons?: { id: string; visible: boolean; label: string; order: number; style?: string; emojiKey?: string }[];
  /** Эмодзи по ключам: Unicode и/или TG custom emoji ID (премиум). Ключи: TRIAL, PACKAGE, CARD, LINK, SERVERS, … */
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }>;
  /** Текст кнопки «В меню» */
  botBackLabel?: string | null;
  /** Тексты главного меню бота (приветствие, подписи) */
  botMenuTexts?: Record<string, string> | null;
  /** Стили внутренних кнопок бота (тарифы, пополнение, «Назад» и т.д.) */
  botInnerButtonStyles?: Record<string, string> | null;
  /** JSON конфиг страницы подписки (приложения, тексты) */
  subscriptionPageConfig?: string | null;
  /** Ссылки раздела «Поддержка» в боте (если пусто — кнопка не показывается) */
  supportLink?: string | null;
  agreementLink?: string | null;
  offerLink?: string | null;
  instructionsLink?: string | null;
  /** Глобальная цветовая тема */
  themeAccent?: string;
  /** Принудительная подписка на канал/группу */
  forceSubscribeEnabled?: boolean;
  forceSubscribeChannelId?: string | null;
  forceSubscribeMessage?: string | null;
}

/** Конфиг страницы подписки (формат как sub.stealthnet.app) */
export type SubscriptionPageConfig = {
  locales?: string[];
  version?: string;
  uiConfig?: { subscriptionInfoBlockType?: string; installationGuidesBlockType?: string };
  platforms?: Record<
    string,
    {
      apps?: {
        name: string;
        featured?: boolean;
        blocks?: {
          title?: Record<string, string>;
          description?: Record<string, string>;
          buttons?: { link: string; text: Record<string, string>; type: string; svgIconKey?: string }[];
          svgIconKey?: string;
          svgIconColor?: string;
        }[];
      }[];
      displayName?: Record<string, string>;
      svgIconKey?: string;
    }
  >;
  translations?: Record<string, Record<string, string>>;
  brandingSettings?: { title?: string; logoUrl?: string; supportUrl?: string };
} | null;

export interface DashboardStats {
  users: {
    total: number;
    withRemna: number;
    newLast7Days: number;
    newLast30Days: number;
  };
  sales: {
    totalAmount: number;
    totalCount: number;
    last7DaysAmount: number;
    last7DaysCount: number;
    last30DaysAmount: number;
    last30DaysCount: number;
  };
}

export interface RemnaNode {
  uuid: string;
  name: string;
  address: string;
  port?: number | null;
  isConnected: boolean;
  isDisabled: boolean;
  isConnecting: boolean;
  lastStatusChange?: string | null;
  lastStatusMessage?: string | null;
  xrayVersion?: string | null;
  nodeVersion?: string | null;
  xrayUptime?: string;
  isTrafficTrackingActive?: boolean;
  /** Онлайн пользователей на ноде */
  usersOnline?: number | null;
  /** Трафик использовано (байты) */
  trafficUsedBytes?: number | null;
  /** Лимит трафика (байты) */
  trafficLimitBytes?: number | null;
  /** Ядер CPU */
  cpuCount?: number | null;
  /** Модель CPU */
  cpuModel?: string | null;
  /** Всего RAM (строка, напр. "2.06 GB") */
  totalRam?: string | null;
}

export type RemnaNodesResponse = { response?: RemnaNode[] };

export type RemnaSystemStats = {
  response?: {
    users?: { totalUsers?: number; statusCounts?: Record<string, number> };
    cpu?: { cores?: number; physicalCores?: number };
    memory?: { total?: number; used?: number; free?: number };
    uptime?: number;
  };
};

export interface TariffCategoryRecord {
  id: string;
  name: string;
  emojiKey: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TariffCategoryWithTariffs extends TariffCategoryRecord {
  tariffs: TariffRecord[];
}

export interface TariffRecord {
  id: string;
  categoryId: string;
  name: string;
  durationDays: number;
  internalSquadUuids: string[];
  trafficLimitBytes: number | null;
  deviceLimit: number | null;
  price: number;
  currency: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateTariffPayload = {
  categoryId: string;
  name: string;
  durationDays: number;
  internalSquadUuids: string[];
  trafficLimitBytes?: number | null;
  deviceLimit?: number | null;
  price?: number;
  currency?: string;
  sortOrder?: number;
};

export type UpdateTariffPayload = {
  name?: string;
  durationDays?: number;
  internalSquadUuids?: string[];
  trafficLimitBytes?: number | null;
  deviceLimit?: number | null;
  price?: number;
  currency?: string;
  sortOrder?: number;
};

// ——— Кабинет клиента ———
export interface ClientProfile {
  id: string;
  email: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  preferredLang: string;
  preferredCurrency: string;
  balance: number;
  referralCode: string | null;
  remnawaveUuid: string | null;
  trialUsed: boolean;
  isBlocked: boolean;
  /** Кошелёк ЮMoney подключён (токен сохранён) */
  yoomoneyConnected?: boolean;
}

export interface ClientAuthResponse {
  token: string;
  client: ClientProfile;
}

export type ClientRegisterPayload = {
  email?: string;
  password?: string;
  telegramId?: string;
  telegramUsername?: string;
  preferredLang?: string;
  preferredCurrency?: string;
  referralCode?: string;
};

export interface ClientPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

export interface PublicTariffCategory {
  id: string;
  name: string;
  emojiKey: string | null;
  emoji: string;
  tariffs: { id: string; name: string; durationDays: number; price: number; currency: string; trafficLimitBytes: number | null; deviceLimit: number | null }[];
}

// ——— Промо-группы ———
export interface PromoGroup {
  id: string;
  name: string;
  code: string;
  squadUuid: string;
  trafficLimitBytes: string;
  deviceLimit: number | null;
  durationDays: number;
  maxActivations: number;
  isActive: boolean;
  activationsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromoActivation {
  id: string;
  promoGroupId: string;
  clientId: string;
  createdAt: string;
  client: {
    id: string;
    email: string | null;
    telegramId: string | null;
    telegramUsername: string | null;
    createdAt: string;
    remnawaveUuid: string | null;
  };
}

export interface PromoGroupDetail extends PromoGroup {
  activations: PromoActivation[];
}

export type CreatePromoGroupPayload = {
  name: string;
  squadUuid: string;
  trafficLimitBytes: string | number;
  deviceLimit?: number | null;
  durationDays: number;
  maxActivations: number;
  isActive?: boolean;
};

export type UpdatePromoGroupPayload = Partial<CreatePromoGroupPayload>;

// ——— Промокоды (скидки / бесплатные дни) ———
export interface PromoCodeRecord {
  id: string;
  code: string;
  name: string;
  type: "DISCOUNT" | "FREE_DAYS";
  discountPercent: number | null;
  discountFixed: number | null;
  squadUuid: string | null;
  trafficLimitBytes: string | null;
  deviceLimit: number | null;
  durationDays: number | null;
  maxUses: number;
  maxUsesPerClient: number;
  isActive: boolean;
  expiresAt: string | null;
  usagesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromoCodeUsage {
  id: string;
  promoCodeId: string;
  clientId: string;
  createdAt: string;
  client: {
    id: string;
    email: string | null;
    telegramId: string | null;
    telegramUsername: string | null;
    createdAt: string;
    remnawaveUuid: string | null;
  };
}

export interface PromoCodeDetail extends PromoCodeRecord {
  usages: PromoCodeUsage[];
}

export type CreatePromoCodePayload = {
  code: string;
  name: string;
  type: "DISCOUNT" | "FREE_DAYS";
  discountPercent?: number | null;
  discountFixed?: number | null;
  squadUuid?: string | null;
  trafficLimitBytes?: string | number | null;
  deviceLimit?: number | null;
  durationDays?: number | null;
  maxUses: number;
  maxUsesPerClient: number;
  isActive?: boolean;
  expiresAt?: string | null;
};

export type UpdatePromoCodePayload = Partial<CreatePromoCodePayload>;

export interface PublicConfig {
  activeLanguages: string[];
  activeCurrencies: string[];
  defaultLanguage?: string;
  defaultCurrency?: string;
  serviceName: string;
  logo?: string | null;
  favicon?: string | null;
  remnaClientUrl?: string | null;
  publicAppUrl?: string | null;
  telegramBotUsername?: string | null;
  plategaMethods?: { id: number; label: string }[];
  yoomoneyEnabled?: boolean;
  trialEnabled?: boolean;
  trialDays?: number;
  themeAccent?: string;
}
