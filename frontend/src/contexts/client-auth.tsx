import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ClientProfile, ClientAuthResponse } from "@/lib/api";
import { api, ApiError, setClientTokenRefreshFn } from "@/lib/api";

const STORAGE_TOKEN = "stealthnet_client_token";
const STORAGE_CLIENT = "stealthnet_client_profile";

/**
 * Проверяет, что JWT ещё «живой» по полю exp (с запасом 10с).
 * Используется на старте, чтобы НЕ грузить протухший токен из localStorage:
 * иначе миниаппка не переобменивала бы initData и ловила 401 на каждом запросе
 * («Invalid or expired token» на вкладке Поддержка и др.).
 */
function isJwtFresh(token: string | null): boolean {
  if (!token) return false;
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    if (typeof json.exp !== "number") return true; // нет exp — считаем пригодным
    return json.exp * 1000 > Date.now() + 10_000;
  } catch {
    return false;
  }
}

type ClientAuthState = {
  token: string | null;
  client: ClientProfile | null;
  /** Идёт авторизация по Telegram Mini App (initData) */
  miniappAuthLoading: boolean;
  /** Попытка входа по initData уже была (успех или ошибка) */
  miniappAuthAttempted: boolean;
  /** Включена 2FA: после пароля/Telegram нужен ввод кода. Временный токен для POST /client/auth/2fa-login */
  pending2FAToken: string | null;
  isNewTelegramUser: boolean;
};

type ClientAuthValue = {
  state: ClientAuthState;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password?: string; preferredLang?: string; preferredCurrency?: string; referralCode?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string }) => Promise<{ requiresVerification: true } | void>;
  registerByTelegram: (data: { telegramId: string; telegramUsername?: string; preferredLang?: string; preferredCurrency?: string; referralCode?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string }) => Promise<void>;
  loginByGoogle: (idToken: string) => Promise<void>;
  loginByApple: (idToken: string) => Promise<void>;
  /** Авторизация через deep-link (tg:// протокол). Принимает ответ от telegram-login-check */
  loginByTelegramDeepLink: (res: { token?: string; client?: ClientProfile; requires2FA?: boolean; tempToken?: string }) => void;
  /** "already_verified" — ссылка уже использована; сессия не выдаётся, нужно войти. */
  verifyEmail: (token: string) => Promise<"already_verified" | void>;
  /** Подтвердить привязку email по токену из письма */
  verifyLinkEmail: (verificationToken: string) => Promise<void>;
  /** Ввести код 2FA после ответа requires2FA (пароль/Telegram уже проверены) */
  submit2FACode: (code: string) => Promise<void>;
  /** Отменить шаг 2FA и вернуться к форме входа */
  clearPending2FA: () => void;
  clearNewTelegramUser: () => void;
  logout: () => void;
  refreshProfile: () => Promise<void>;
};

const ClientAuthContext = createContext<ClientAuthValue | null>(null);

function loadState(): Pick<ClientAuthState, "token" | "client"> {
  const stored = localStorage.getItem(STORAGE_TOKEN);
  // протухший токен не используем — отдаём null, чтобы сработал
  // переобмен initData (миниаппка) или редирект на логин (браузер).
  const token = isJwtFresh(stored) ? stored : null;
  if (!token && stored) localStorage.removeItem(STORAGE_TOKEN);
  const raw = localStorage.getItem(STORAGE_CLIENT);
  try {
    const client = raw ? JSON.parse(raw) : null;
    if (client !== null && (typeof client !== "object" || typeof client.id !== "string")) throw new Error("Invalid saved client");
    return { token, client: client as ClientProfile | null };
  } catch {
    saveState(null, null);
    return { token: null, client: null };
  }
}

function saveState(token: string | null, client: ClientProfile | null) {
  if (token) localStorage.setItem(STORAGE_TOKEN, token);
  else localStorage.removeItem(STORAGE_TOKEN);
  if (client) localStorage.setItem(STORAGE_CLIENT, JSON.stringify(client));
  else localStorage.removeItem(STORAGE_CLIENT);
}

function isAuthResponse(res: any): res is ClientAuthResponse {
  return !!res && typeof res.token === "string" && !!res.client;
}

export function ClientAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ClientAuthState>(() => ({ ...loadState(), miniappAuthLoading: false, miniappAuthAttempted: false, pending2FAToken: null, isNewTelegramUser: false }));
  const miniappAttemptedRef = useRef(false);

  // Сразу раскрываем Mini App на весь экран (до авторизации)
  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready?.();
      window.Telegram.WebApp.expand?.();
    }
  }, []);

  // КЛИЕНТСКИЙ refresh: при 401 на /client/* api-слой дёрнет эту функцию —
  // переобмениваем СВЕЖИЙ Telegram initData на новый JWT. Лечит протухший токен
  // прямо в полёте, без видимой пользователю ошибки. Вне миниаппки (нет initData)
  // возвращаем null → запрос честно падает 401 (юзер на логин).
  useEffect(() => {
    setClientTokenRefreshFn(async () => {
      const initData = typeof window !== "undefined" ? window.Telegram?.WebApp?.initData : null;
      if (!initData?.trim()) return null;
      try {
        const res = await api.clientAuthByTelegramMiniapp(initData);
        if (isAuthResponse(res)) {
          setState((prev) => ({ ...prev, token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: null }));
          saveState(res.token, res.client);
          return res.token;
        }
      } catch {
        /* initData протух/невалиден — null, запрос упадёт штатно */
      }
      return null;
    });
    return () => setClientTokenRefreshFn(null);
  }, []);

  useEffect(() => {
    if (state.token || miniappAttemptedRef.current || typeof window === "undefined") return;
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData?.trim()) return;
    miniappAttemptedRef.current = true;
    setState((prev) => (prev.miniappAuthLoading ? prev : { ...prev, miniappAuthLoading: true, miniappAuthAttempted: true }));
    api
      .clientAuthByTelegramMiniapp(initData)
      .then((res) => {
      if ("requires2FA" in res && res.requires2FA) {
        setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: res.tempToken }));
        return;
      }
      if (isAuthResponse(res)) {
        setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: null, isNewTelegramUser: false });
        saveState(res.token, res.client);
      }
      })
      .catch(() => {
        setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true }));
      });
  }, [state.token]);

  const refreshProfile = useCallback(async () => {
    if (!state.token) return;
    try {
      const client = await api.clientMe(state.token);
      setState((prev) => {
        if (prev.token !== state.token) return prev;
        const next = { ...prev, client };
        saveState(prev.token, client);
        return next;
      });
    } catch (error) {
      if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) return;
      setState((prev) => {
        if (prev.token !== state.token) return prev;
        miniappAttemptedRef.current = false;
        saveState(null, null);
        return { token: null, client: null, miniappAuthLoading: false, miniappAuthAttempted: false, pending2FAToken: null, isNewTelegramUser: false };
      });
    }
  }, [state.token]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.clientLogin(email, password);
    if ("requires2FA" in res && res.requires2FA) {
      setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: res.tempToken }));
      return;
    }
    if (isAuthResponse(res)) {
      setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: null, isNewTelegramUser: false });
      saveState(res.token, res.client);
    }
  }, []);

  const register = useCallback(
    async (data: { email: string; password?: string; preferredLang?: string; preferredCurrency?: string; referralCode?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string }) => {
      const res = await api.clientRegister({
        email: data.email,
        password: data.password,
        preferredLang: data.preferredLang ?? "ru",
        preferredCurrency: data.preferredCurrency ?? "usd",
        referralCode: data.referralCode,
        utm_source: data.utm_source,
        utm_medium: data.utm_medium,
        utm_campaign: data.utm_campaign,
        utm_content: data.utm_content,
        utm_term: data.utm_term,
      });
      if ("requiresVerification" in res && res.requiresVerification) {
        return { requiresVerification: true as const };
      }
      if ("requires2FA" in res && res.requires2FA) {
        setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: res.tempToken }));
        return;
      }
      if (isAuthResponse(res)) {
        setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: null, isNewTelegramUser: true });
        saveState(res.token, res.client);
      }
    },
    []
  );

  const registerByTelegram = useCallback(
    async (data: { telegramId: string; telegramUsername?: string; preferredLang?: string; preferredCurrency?: string; referralCode?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string }) => {
      const res = await api.clientRegister({
        telegramId: data.telegramId,
        telegramUsername: data.telegramUsername,
        preferredLang: data.preferredLang ?? "ru",
        preferredCurrency: data.preferredCurrency ?? "usd",
        referralCode: data.referralCode,
        utm_source: data.utm_source,
        utm_medium: data.utm_medium,
        utm_campaign: data.utm_campaign,
        utm_content: data.utm_content,
        utm_term: data.utm_term,
      });
      if ("requires2FA" in res && res.requires2FA) {
        setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: res.tempToken }));
        return;
      }
      if (isAuthResponse(res)) {
        const justCreated = res.client && res.client.createdAt && (Date.now() - new Date(res.client.createdAt).getTime()) < 15000;
        setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: null, isNewTelegramUser: !!justCreated });
        saveState(res.token, res.client);
      }
    },
    []
  );

  const loginByGoogle = useCallback(async (idToken: string) => {
    const res = await api.clientGoogleAuth(idToken);
    if ("requires2FA" in res && res.requires2FA) {
      setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: res.tempToken }));
      return;
    }
    if (isAuthResponse(res)) {
      setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: null, isNewTelegramUser: false });
      saveState(res.token, res.client);
    }
  }, []);

  const loginByApple = useCallback(async (idToken: string) => {
    const res = await api.clientAppleAuth(idToken);
    if ("requires2FA" in res && res.requires2FA) {
      setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: res.tempToken }));
      return;
    }
    if (isAuthResponse(res)) {
      setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: null, isNewTelegramUser: false });
      saveState(res.token, res.client);
    }
  }, []);

  const loginByTelegramDeepLink = useCallback((res: { token?: string; client?: ClientProfile; requires2FA?: boolean; tempToken?: string; justCreated?: boolean }) => {
    if (res.requires2FA && res.tempToken) {
      setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: res.tempToken! }));
      return;
    }
    if (res.token && res.client) {
      setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: null, isNewTelegramUser: !!res.justCreated });
      saveState(res.token, res.client);
    }
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    const res = await api.clientVerifyEmail(token);
    if ("alreadyVerified" in res && res.alreadyVerified) return "already_verified";
    if ("requires2FA" in res && res.requires2FA) {
      setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: res.tempToken }));
      return;
    }
    if (isAuthResponse(res)) {
      setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: null, isNewTelegramUser: true });
      saveState(res.token, res.client);
    }
  }, []);

  const verifyLinkEmail = useCallback(async (verificationToken: string) => {
    const res = await api.clientVerifyLinkEmail(verificationToken);
    if ("requires2FA" in res && res.requires2FA) {
      setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: res.tempToken }));
      return;
    }
    if (isAuthResponse(res)) {
      setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true, pending2FAToken: null, isNewTelegramUser: false });
      saveState(res.token, res.client);
    }
  }, []);

  const submit2FACode = useCallback(async (code: string) => {
    const tempToken = state.pending2FAToken;
    if (!tempToken?.trim()) return;
    const res = await api.client2FALogin(tempToken, code.trim());
    setState((prev) => ({ ...prev, token: res.token, client: res.client, pending2FAToken: null }));
    saveState(res.token, res.client);
  }, [state.pending2FAToken]);

  const clearPending2FA = useCallback(() => {
    setState((prev) => ({ ...prev, pending2FAToken: null }));
  }, []);

  const clearNewTelegramUser = useCallback(() => {
    setState(prev => ({ ...prev, isNewTelegramUser: false }));
  }, []);

  const logout = useCallback(() => {
    // позволяем эффекту обмена initData снова авторизовать миниаппку после ручного выхода/сброса.
    miniappAttemptedRef.current = false;
    setState({ token: null, client: null, miniappAuthLoading: false, miniappAuthAttempted: false, pending2FAToken: null, isNewTelegramUser: false });
    saveState(null, null);
  }, []);

  const value: ClientAuthValue = {
    state,
    login,
    register,
    registerByTelegram,
    loginByGoogle,
    loginByApple,
    loginByTelegramDeepLink,
    verifyEmail,
    verifyLinkEmail,
    submit2FACode,
    clearPending2FA,
    clearNewTelegramUser,
    logout,
    refreshProfile,
  };

  return <ClientAuthContext.Provider value={value}>{children}</ClientAuthContext.Provider>;
}

export function useClientAuth() {
  const ctx = useContext(ClientAuthContext);
  if (!ctx) throw new Error("useClientAuth must be used within ClientAuthProvider");
  return ctx;
}
