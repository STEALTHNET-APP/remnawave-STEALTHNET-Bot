/**
 * Query-хуки данных кабинета — замена ручным useEffect+useState каскадам
 * (раньше каждый экран кабинета сам дёргал api.* в Promise.all и держал
 * loading/error/refreshKey в локальном состоянии).
 *
 * Все хуки включены только при живом токене (enabled), так что на /login
 * они не дёргают сеть. Инвалидация после мутаций — через qk-ключи.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { qk } from "./query-client";

/** Ответ /client/subscription: основная подписка + тариф + ссылка. */
export type ClientSubscriptionResponse = Awaited<ReturnType<typeof api.clientSubscription>>;

/** Профиль клиента (кэш 60s, refetch после мутаций профиля вручную). */
export function useClientMe(token: string | null) {
  return useQuery({
    queryKey: qk.client.me(token),
    queryFn: () => api.clientMe(token!),
    enabled: !!token,
    staleTime: 60_000,
  });
}

/** Основная подписка + тариф + ссылка. */
export function useClientSubscription(token: string | null) {
  return useQuery({
    queryKey: qk.client.subscription(token),
    queryFn: () => api.clientSubscription(token!),
    enabled: !!token,
  });
}

/** Все подписки (root + secondary). */
export function useClientAllSubscriptions(token: string | null) {
  return useQuery({
    queryKey: qk.client.allSubscriptions(token),
    queryFn: () => api.clientAllSubscriptions(token!),
    enabled: !!token,
  });
}

/** История платежей. */
export function useClientPayments(token: string | null) {
  return useQuery({
    queryKey: qk.client.payments(token),
    queryFn: () => api.clientPayments(token!),
    enabled: !!token,
  });
}

/** Публичные тарифы (общий кеш между кабинетом/ботом-витриной). */
export function usePublicTariffs() {
  return useQuery({
    queryKey: qk.client.publicTariffs(),
    queryFn: () => api.getPublicTariffs(),
    staleTime: 60_000,
  });
}

/** Статистика рефералки. */
export function useReferralStats(token: string | null) {
  return useQuery({
    queryKey: qk.client.referralStats(token),
    queryFn: () => api.getClientReferralStats(token!),
    enabled: !!token,
  });
}

/** Доступные триалы (количество). */
export function useAvailableTrials(token: string | null) {
  return useQuery({
    queryKey: qk.client.availableTrials(token),
    queryFn: () => api.getClientAvailableTrials(token!),
    enabled: !!token,
  });
}

/**
 * Инвалидация всех клиентских данных (после оплаты/активации/редакта профиля).
 * me не инвалилидим здесь — refreshProfile и так тянет клиент; подзывайте отдельно.
 */
/** Инвалидация всех клиентских данных (после оплаты/активации/редакта профиля). */
export function useInvalidateClientData() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["client"], exact: false });
    void qc.invalidateQueries({ queryKey: qk.client.publicTariffs() });
  };
}
