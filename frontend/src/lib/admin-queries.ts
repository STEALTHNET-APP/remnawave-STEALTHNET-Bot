/**
 * Query-хуки админ-панели — замена ручным useEffect+useState каскадам.
 *
 * Конвенции:
 *  - enabled: !!token (+ условия доступа), чтобы хуки не дёргали сеть до логина.
 *  - queryFn «null-tolerant»: некритичные данные .catch(() => null), страница
 *    рендерится без них.
 *  - Мутации живут в страницах (useMutation) — здесь только query + ключи.
 */
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { qk } from "./query-client";
import { api, type AdminListItem, type ApiKeyListItem, type ApiKeyUsageItem, type AdminSecondarySubscriptionFilters } from "./api";
import { adminPermissionsApi, type ActionDef } from "./admin-extras-api";
import { landingEditorApi } from "./landing-editor-api";

export type DashboardStats = Awaited<ReturnType<typeof api.getDashboardStats>>;
export type ServerStats = NonNullable<Awaited<ReturnType<typeof api.getServerStats>>>;
export type AnalyticsResponse = Awaited<ReturnType<typeof api.getAnalytics>>;
export type GiftAnalytics = NonNullable<Awaited<ReturnType<typeof api.getGiftAnalytics>>>;
export type AdminSettings = Awaited<ReturnType<typeof api.getSettings>>;
export type TariffCategoriesResponse = Awaited<ReturnType<typeof api.getTariffCategories>>;
export type ProxyNodesResponse = Awaited<ReturnType<typeof api.getProxyNodes>>;
export type SingboxNodesResponse = Awaited<ReturnType<typeof api.getSingboxNodes>>;

/* ── Dashboard ─────────────────────────────────────────────────────────── */

export function useAdminDashboardStats(token: string | null) {
  return useQuery({
    queryKey: qk.admin.dashboardStats(),
    queryFn: () => api.getDashboardStats(token!),
    enabled: !!token,
  });
}

export function useAdminServerStats(token: string | null) {
  return useQuery({
    queryKey: qk.admin.serverStats(),
    queryFn: () => api.getServerStats(token!).catch(() => null),
    enabled: !!token,
  });
}

export function useAdminAnalytics(token: string | null) {
  return useQuery({
    queryKey: qk.admin.analytics(),
    queryFn: () => api.getAnalytics(token!).catch(() => null),
    enabled: !!token,
  });
}

export function useAdminGiftAnalytics(token: string | null) {
  return useQuery({
    queryKey: qk.admin.giftAnalytics(),
    queryFn: () => api.getGiftAnalytics(token!).catch(() => null),
    enabled: !!token,
  });
}

export function useAdminSettings(token: string | null) {
  return useQuery({
    queryKey: qk.admin.settings(),
    queryFn: () => api.getSettings(token!),
    enabled: !!token,
  });
}

export function useAdminNotificationCounters(token: string | null) {
  return useQuery({
    queryKey: qk.admin.notificationCounters(),
    queryFn: () => api.getAdminNotificationCounters(token!).catch(() => null),
    enabled: !!token,
  });
}

/* ── Remna ─────────────────────────────────────────────────────────────── */

export function useRemnaNodes(token: string | null, enabled = true, refetchInterval?: number | false) {
  return useQuery({
    queryKey: qk.admin.remnaNodes(),
    queryFn: () => api.getRemnaNodes(token!).catch(() => ({ response: [] })),
    enabled: !!token && enabled,
    refetchInterval,
  });
}

export function useRemnaSystemStats(token: string | null, refetchInterval?: number | false) {
  return useQuery({
    queryKey: qk.admin.remnaSystemStats(),
    queryFn: () => api.getRemnaSystemStats(token!).catch(() => null),
    enabled: !!token,
    refetchInterval,
  });
}

export function useRemnaSquadsInternal(token: string | null) {
  return useQuery({
    queryKey: qk.admin.remnaSquads(),
    queryFn: () => api.getRemnaSquadsInternal(token!).catch(() => null),
    enabled: !!token,
  });
}

export function useRemnaConfigProfiles(token: string | null) {
  return useQuery({
    queryKey: qk.admin.remnaConfigProfiles(),
    queryFn: () => api.getRemnaConfigProfiles(token!).catch(() => null),
    enabled: !!token,
  });
}

export function useRemnaHosts(token: string | null) {
  return useQuery({
    queryKey: qk.admin.remnaHosts(),
    queryFn: () => api.getRemnaHosts(token!).catch(() => null),
    enabled: !!token,
  });
}

export function useRemnaSubTemplates(token: string | null) {
  return useQuery({
    queryKey: qk.admin.remnaSubTemplates(),
    queryFn: () => api.getRemnaSubTemplates(token!).catch(() => null),
    enabled: !!token,
  });
}

export function useRemnaBandwidth(token: string | null, refetchInterval?: number | false) {
  return useQuery({
    queryKey: qk.admin.remnaBandwidth(),
    queryFn: () => api.getRemnaBandwidthStats(token!).catch(() => null),
    enabled: !!token,
    refetchInterval,
  });
}

/* ── Tariffs / Proxy / Singbox ─────────────────────────────────────────── */

export function useTariffCategories(token: string | null) {
  return useQuery({
    queryKey: qk.admin.tariffCategories(),
    queryFn: () => api.getTariffCategories(token!),
    enabled: !!token,
  });
}

export function useProxyNodes(token: string | null) {
  return useQuery({
    queryKey: qk.admin.proxyNodes(),
    queryFn: () => api.getProxyNodes(token!),
    enabled: !!token,
  });
}

export function useProxyCategories(token: string | null) {
  return useQuery({
    queryKey: qk.admin.proxyCategories(),
    queryFn: () => api.getProxyCategories(token!),
    enabled: !!token,
  });
}

export function useProxyTariffs(token: string | null) {
  return useQuery({
    queryKey: qk.admin.proxyTariffs(),
    queryFn: () => api.getProxyTariffs(token!),
    enabled: !!token,
  });
}

export function useSingboxNodes(token: string | null) {
  return useQuery({
    queryKey: qk.admin.singboxNodes(),
    queryFn: () => api.getSingboxNodes(token!),
    enabled: !!token,
  });
}

export function useSingboxCategories(token: string | null) {
  return useQuery({
    queryKey: qk.admin.singboxCategories(),
    queryFn: () => api.getSingboxCategories(token!),
    enabled: !!token,
  });
}

export function useSingboxTariffs(token: string | null) {
  return useQuery({
    queryKey: qk.admin.singboxTariffs(),
    queryFn: () => api.getSingboxTariffs(token!),
    enabled: !!token,
  });
}

/* ── Misc ──────────────────────────────────────────────────────────────── */

export function useLanguages(token: string | null) {
  return useQuery({
    queryKey: qk.admin.languages(),
    queryFn: () => api.getLanguages(token!),
    enabled: !!token,
  });
}

export function useAutoRenewStats(token: string | null) {
  return useQuery({
    queryKey: qk.admin.autoRenewStats(),
    queryFn: () => api.getAutoRenewStats(token!),
    enabled: !!token,
  });
}

export function useVideoInstructions(token: string | null) {
  return useQuery({
    queryKey: qk.admin.videoInstructions(),
    queryFn: () => api.getVideoInstructions(token!),
    enabled: !!token,
  });
}

export function useSshConfig(token: string | null) {
  return useQuery({
    queryKey: qk.admin.sshConfig(),
    queryFn: () => api.getSshConfig(token!),
    enabled: !!token,
  });
}

/** Отчёт продаж (sales-report.tsx). params — сериализованные фильтры/пагинация; без фильтров — "{}". */
export function useAdminSalesReport(token: string | null, params: string) {
  return useQuery({
    queryKey: qk.admin.salesReport(params),
    queryFn: () => api.getSalesReport(token!, JSON.parse(params)),
    enabled: !!token,
  });
}

/** Продажи через баланс (balance-sales.tsx). params — сериализованные фильтры/пагинация; без фильтров — "{}". */
export function useAdminBalanceSales(token: string | null, params: string) {
  return useQuery({
    queryKey: qk.admin.balanceSales(params),
    queryFn: () => api.getBalanceSales(token!, JSON.parse(params)),
    enabled: !!token,
  });
}

/* ── Sing-box: детали ноды + CRUD ──────────────────────────────────────── */

export function useSingboxNodeDetail(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.singboxNodeDetail(id ?? "none"),
    queryFn: () => api.getSingboxNode(token!, id!),
    enabled: !!token && !!id,
  });
}

function useInvalidateAdmin() {
  const qc = useQueryClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (...keys: readonly any[]) => {
    for (const key of keys) void qc.invalidateQueries({ queryKey: key, exact: false });
  };
}

export function useCreateSingboxNodeMutation(token: string | null) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (data?: { name?: string; protocol?: string; port?: number; tlsEnabled?: boolean }) =>
      api.createSingboxNode(token!, data),
    onSuccess: () => invalidate(qk.admin.singboxNodes()),
  });
}

export function useUpdateSingboxNodeMutation(token: string | null) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (args: { id: string; data: Parameters<typeof api.updateSingboxNode>[2] }) =>
      api.updateSingboxNode(token!, args.id, args.data),
    onSuccess: (_res, args) => invalidate(qk.admin.singboxNodes(), qk.admin.singboxNodeDetail(args.id)),
  });
}

export function useDeleteSingboxNodeMutation(token: string | null) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (id: string) => api.deleteSingboxNode(token!, id),
    onSuccess: () => invalidate(qk.admin.singboxNodes()),
  });
}

export function useCreateSingboxCategoryMutation(token: string | null) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (data: { name: string; sortOrder?: number }) => api.createSingboxCategory(token!, data),
    onSuccess: () => invalidate(qk.admin.singboxCategories()),
  });
}

export function useUpdateSingboxCategoryMutation(token: string | null) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (args: { id: string; data: Parameters<typeof api.updateSingboxCategory>[2] }) =>
      api.updateSingboxCategory(token!, args.id, args.data),
    onSuccess: () => invalidate(qk.admin.singboxCategories()),
  });
}

export function useDeleteSingboxCategoryMutation(token: string | null) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (id: string) => api.deleteSingboxCategory(token!, id),
    onSuccess: () => invalidate(qk.admin.singboxCategories()),
  });
}

export function useCreateSingboxTariffMutation(token: string | null) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createSingboxTariff>[1]) => api.createSingboxTariff(token!, data),
    onSuccess: () => invalidate(qk.admin.singboxCategories(), qk.admin.singboxTariffs()),
  });
}

export function useUpdateSingboxTariffMutation(token: string | null) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (args: { id: string; data: Parameters<typeof api.updateSingboxTariff>[2] }) =>
      api.updateSingboxTariff(token!, args.id, args.data),
    onSuccess: () => invalidate(qk.admin.singboxCategories(), qk.admin.singboxTariffs()),
  });
}

export function useDeleteSingboxTariffMutation(token: string | null) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (id: string) => api.deleteSingboxTariff(token!, id),
    onSuccess: () => invalidate(qk.admin.singboxCategories(), qk.admin.singboxTariffs()),
  });
}

export function useRemnaSubTemplate(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.remnaSubTemplate(id ?? ""),
    queryFn: () => api.getRemnaSubTemplate(token!, id!).catch(() => null),
    enabled: !!token && !!id,
  });
}

export function useRemnaSubSettings(token: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.admin.remnaSubSettings(),
    queryFn: () => api.getRemnaSubSettings(token!).catch(() => null),
    enabled: !!token && enabled,
  });
}

export function useRemnaHostTags(token: string | null) {
  return useQuery({
    queryKey: qk.admin.remnaHostTags(),
    queryFn: () => api.getRemnaHostTags(token!).catch(() => null),
    enabled: !!token,
  });
}

export function useAdminTariffs(token: string | null) {
  return useQuery({
    queryKey: qk.admin.tariffs(),
    queryFn: () => api.getTariffs(token!).catch(() => ({ items: [] })),
    enabled: !!token,
  });
}

/* ── Broadcast / Auto-broadcast ────────────────────────────────────────── */

export function useAdminBroadcastRecipients(token: string | null) {
  return useQuery({
    queryKey: qk.admin.broadcastRecipients(),
    queryFn: () => api.broadcastRecipientsCount(token!),
    enabled: !!token,
  });
}

export function useAdminBroadcastHistory(token: string | null, limit = 100) {
  return useQuery({
    queryKey: qk.admin.broadcastHistory(),
    queryFn: () => api.getBroadcastHistory(token!, limit, 0),
    enabled: !!token,
  });
}

export function useAdminAutoBroadcastRules(token: string | null) {
  return useQuery({
    queryKey: qk.admin.autoBroadcastRules(),
    queryFn: () => api.getAutoBroadcastRules(token!),
    enabled: !!token,
  });
}

export function useAdminAutoBroadcastEligibleCounts(token: string | null, ruleIds: string[]) {
  return useQuery({
    queryKey: qk.admin.autoBroadcastEligible(),
    queryFn: async () => {
      const entries = await Promise.all(
        ruleIds.map((id) =>
          api.getAutoBroadcastEligibleCount(token!, id).then(({ count }) => [id, count] as const)
            .catch(() => [id, 0] as const)
        )
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: !!token && ruleIds.length > 0,
  });
}

/* ── Settings page extras ──────────────────────────────────────────────── */

/** Дефолтная конфигурация страницы подписки (эталон для редактора в settings.tsx). */
export function useAdminSubscriptionPageConfig(token: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.admin.subscriptionPageConfig(),
    queryFn: () => api.getDefaultSubscriptionPageConfig(token!).catch(() => null),
    enabled: !!token && enabled,
  });
}

/** Статус подключения Remna (configured) — settings.tsx, tariffs.tsx. */
export function useRemnaStatus(token: string | null) {
  return useQuery({
    queryKey: qk.admin.remnaStatus(),
    queryFn: () => api.getRemnaStatus(token!).catch(() => ({ configured: false })),
    enabled: !!token,
  });
}

/* ── Clients page (clients.tsx) ────────────────────────────────────────── */

/** Список клиентов с search/filter/pagination. `paramsJson` = JSON.stringify объекта параметров. */
export function useAdminClients(
  token: string | null,
  paramsJson: string,
  page: number,
  params: { search?: string; isBlocked?: boolean },
) {
  return useQuery({
    queryKey: qk.admin.clients(paramsJson),
    queryFn: () => api.getClients(token!, page, 20, params),
    enabled: !!token,
    placeholderData: (prev) => prev,
  });
}

/** Поллинг онлайн-статусов (remnawaveUuid → onlineAt), 30 c — как прежний setInterval. */
export function useAdminClientsOnlineStatuses(token: string | null, uuids: string[]) {
  return useQuery({
    queryKey: qk.admin.clientOnline(JSON.stringify(uuids)),
    queryFn: () => api.getClientsOnlineStatuses(token!, uuids).catch(() => ({}) as Record<string, { onlineAt: string | null }>),
    enabled: !!token && uuids.length > 0,
    refetchInterval: 30_000,
  });
}

/** Детальная карточка клиента (с реферером). */
export function useAdminClientDetail(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.clientDetail(id ?? ""),
    queryFn: () => api.getClientDetail(token!, id!).catch(() => null),
    enabled: !!token && !!id,
  });
}

/** Услуги клиента (доп. устройства по подпискам). */
export function useAdminClientServices(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.clientServices(id ?? ""),
    queryFn: () => api.getClientServices(token!, id!).catch(() => null),
    enabled: !!token && !!id,
  });
}

/** Все HWID-устройства со всех подписок клиента. */
export function useAdminClientAllDevices(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.clientDevices(id ?? ""),
    queryFn: () => api.getClientAllDevices(token!, id!).catch(() => null),
    enabled: !!token && !!id,
  });
}

/** Сводка по всем подпискам клиента. */
export function useAdminClientSubsOverview(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.clientSubsOverview(id ?? ""),
    queryFn: () => api.getClientSubsOverview(token!, id!).catch(() => null),
    enabled: !!token && !!id,
  });
}

/** Список подписок клиента (primary + secondary). */
export function useAdminClientSubscriptionsList(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.clientSubscriptionsList(id ?? ""),
    queryFn: () => api.getClientSubscriptionsList(token!, id!).catch(() => null),
    enabled: !!token && !!id,
  });
}

/** Полный пользователь Remnawave для карточки клиента. */
export function useAdminClientRemna(token: string | null, id: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.admin.clientRemna(id ?? ""),
    queryFn: () => api.getClientRemna(token!, id!).catch(() => null),
    enabled: !!token && !!id && enabled,
  });
}

/** Usage-статистика Remnawave за 30 дней. */
export function useAdminClientRemnaUsage(token: string | null, id: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.admin.clientRemnaUsage(id ?? ""),
    queryFn: () => api.getClientRemnaUsage(token!, id!, 30).catch(() => null),
    enabled: !!token && !!id && enabled,
  });
}

/** Аудит БД vs Remnawave для карточки клиента (запускается вручную). */
export function useAdminClientAudit(token: string | null, id: string | null, enabled = false) {
  return useQuery({
    queryKey: qk.admin.clientAudit(id ?? ""),
    queryFn: () => api.clientAudit(token!, id!).catch(() => null),
    enabled: !!token && !!id && enabled,
  });
}

/** Слоты прокси-доступов (proxy.tsx). params — сериализованные фильтры/пагинация; без фильтров — "{}". */
export function useProxySlotsAdmin(token: string | null, params: string, enabled = true) {
  return useQuery({
    queryKey: qk.admin.proxySlots(params),
    queryFn: () => api.getProxySlotsAdmin(token!),
    enabled: !!token && enabled,
  });
}

/* ── Remna nodes page (remna-nodes.tsx) ────────────────────────────────── */

export function useRemnaMetrics(token: string | null, refetchInterval?: number | false) {
  return useQuery({
    queryKey: qk.admin.remnaMetrics(),
    queryFn: () => api.getRemnaNodesMetrics(token!).catch(() => null),
    enabled: !!token,
    refetchInterval,
  });
}

export function useRemnaRecap(token: string | null) {
  return useQuery({
    queryKey: qk.admin.remnaRecap(),
    queryFn: () => api.getRemnaRecap(token!).catch(() => null),
    enabled: !!token,
  });
}

export function useRemnaPubKey(token: string | null) {
  return useQuery({
    queryKey: qk.admin.remnaPubKey(),
    queryFn: () => api.getRemnaPubKey(token!).catch(() => ({ response: { pubKey: "" } })),
    enabled: !!token,
  });
}

export function useRemnaHwidStats(token: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.admin.remnaHwidStats(),
    queryFn: () => api.getRemnaHwidStats(token!).catch(() => null),
    enabled: !!token && enabled,
  });
}

export function useRemnaHwidTop(token: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.admin.remnaHwidTop(),
    queryFn: () => api.getRemnaHwidTopUsers(token!).catch(() => null),
    enabled: !!token && enabled,
  });
}

export function useRemnaTorrentStats(token: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.admin.remnaTorrentStats(),
    queryFn: () => api.getRemnaTorrentStats(token!).catch(() => null),
    enabled: !!token && enabled,
  });
}

export function useRemnaTorrentReports(token: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.admin.remnaTorrentReports(),
    queryFn: () => api.getRemnaTorrentReports(token!).catch(() => null),
    enabled: !!token && enabled,
  });
}

export function useRemnaInfraProviders(token: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.admin.remnaInfraProviders(),
    queryFn: () => api.getRemnaInfraProviders(token!).catch(() => null),
    enabled: !!token && enabled,
  });
}

export function useRemnaInfraBillingNodes(token: string | null) {
  return useQuery({
    queryKey: qk.admin.remnaInfraBillingNodes(),
    queryFn: () => api.getRemnaInfraBillingNodes(token!).catch(() => null),
    enabled: !!token,
  });
}

export function useRemnaNodePlugins(token: string | null, enabled = true, nodeUuid = "all") {
  return useQuery({
    queryKey: ["admin", "node-plugins", nodeUuid] as const,
    queryFn: () => api.getRemnaNodePlugins(token!).catch(() => null),
    enabled: !!token && enabled,
  });
}

export function useRemnaNodeUsersUsage(token: string | null, uuid: string | null, days = 7) {
  return useQuery({
    queryKey: ["admin", "node-users-usage", uuid, days] as const,
    queryFn: () => api.getRemnaNodeUsersUsage(token!, uuid!, days).catch(() => null),
    enabled: !!token && !!uuid,
  });
}

/* ── Contests ──────────────────────────────────────────────────────────── */

export function useAdminContests(token: string | null) {
  return useQuery({
    queryKey: qk.admin.contests(),
    queryFn: () => api.getContests(token!),
    enabled: !!token,
  });
}

export function useAdminContestDetail(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.contestDetail(id ?? ""),
    queryFn: () => api.getContest(token!, id!),
    enabled: !!token && !!id,
  });
}

export function useAdminContestParticipantsPreview(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.contestParticipantsPreview(id ?? ""),
    queryFn: () => api.getContestParticipantsPreview(token!, id!),
    enabled: !!token && !!id,
  });
}

/* ── Promo groups / promo codes ────────────────────────────────────────── */

export function useAdminPromoGroups(token: string | null) {
  return useQuery({
    queryKey: qk.admin.promoGroups(),
    queryFn: () => api.getPromoGroups(token!),
    enabled: !!token,
  });
}

export function useAdminPromoGroupDetail(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.promoGroupDetail(id ?? ""),
    queryFn: () => api.getPromoGroup(token!, id!),
    enabled: !!token && !!id,
  });
}

export function useAdminPromoCodes(token: string | null) {
  return useQuery({
    queryKey: qk.admin.promoCodes(),
    queryFn: () => api.getPromoCodes(token!),
    enabled: !!token,
  });
}

export function useAdminPromoCodeDetail(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.promoCodeDetail(id ?? ""),
    queryFn: () => api.getPromoCode(token!, id!),
    enabled: !!token && !!id,
  });
}

/* ── Trials ────────────────────────────────────────────────────────────── */

export function useAdminTrials(token: string | null) {
  return useQuery({
    queryKey: qk.admin.trials(),
    queryFn: () => api.getTrials(token!),
    enabled: !!token,
  });
}

/* ── Auto-renew notifications ──────────────────────────────────────────── */

export function useAdminAutoRenewNotifications(token: string | null) {
  return useQuery({
    queryKey: qk.admin.autoRenewNotifications(),
    queryFn: () => api.getAutoRenewNotifications(token!),
    enabled: !!token,
  });
}

/* ── Gramads ───────────────────────────────────────────────────────────── */

export function useGramadsStatus(token: string | null) {
  return useQuery({
    queryKey: qk.admin.gramadsStatus(),
    queryFn: async () => {
      try {
        const r = await api.gramadsStatus(token!);
        return { configured: r.configured, valid: r.valid, error: r.error };
      } catch (e) {
        return { configured: false, valid: false, error: e instanceof Error ? e.message : "error" };
      }
    },
    enabled: !!token,
  });
}

export function useGramadsPosts(token: string | null, filter: "active" | "archived" | "all", enabled: boolean) {
  return useQuery({
    queryKey: qk.admin.gramadsPosts(filter),
    queryFn: async () => {
      const args: Parameters<typeof api.gramadsGetMyPosts>[1] = { count: 100, pageIndex: 0 };
      if (filter === "archived") args.isArchived = true;
      else if (filter === "active") { args.isArchived = false; args.activeOnly = true; }
      else args.isArchived = false;
      try {
        return await api.gramadsGetMyPosts(token!, args);
      } catch {
        return null;
      }
    },
    enabled: !!token && enabled,
  });
}

export function useGramadsPostStats(token: string | null, postId: number | null) {
  return useQuery({
    queryKey: qk.admin.gramadsPostStats(postId ?? 0),
    queryFn: () => api.gramadsGetStatistics(token!, postId!, 30).catch(() => null),
    enabled: !!token && postId != null,
  });
}

/* ── Small pages (W5-4: admins/languages/backup/marketing/withdrawals/api-keys/…) ── */

/** Список админов/менеджеров (admins.tsx). */
export function useAdminsList(token: string | null) {
  return useQuery({
    queryKey: qk.admin.adminsList(),
    queryFn: () => api.getAdmins(token!).catch(() => [] as AdminListItem[]),
    enabled: !!token,
  });
}

/** Каталог критических action-прав (admins.tsx). */
export function useAdminPermissionActions(token: string | null) {
  return useQuery({
    queryKey: qk.admin.adminPermissionActions(),
    queryFn: () => adminPermissionsApi.actions(token!).catch(() => ({ actions: [] as ActionDef[] })),
    enabled: !!token,
  });
}

/** Список сохранённых бэкапов (backup.tsx). */
export function useBackupList(token: string | null) {
  return useQuery({
    queryKey: qk.admin.backupList(),
    queryFn: () => api.getBackupList(token!).catch(() => ({ items: [] })),
    enabled: !!token,
  });
}

/** Заявки на вывод USDT TRC20 (withdrawals.tsx). */
export function useWithdrawals(
  token: string | null,
  status?: "PENDING" | "APPROVED" | "REJECTED",
) {
  return useQuery({
    queryKey: qk.admin.withdrawals(status ?? "ALL"),
    queryFn: () => api.getWithdrawals(token!, status),
    enabled: !!token,
  });
}

/** API-ключи (api-keys.tsx). */
export function useApiKeysList(token: string | null) {
  return useQuery({
    queryKey: qk.admin.apiKeys(),
    queryFn: () => api.getApiKeys(token!).catch(() => [] as ApiKeyListItem[]),
    enabled: !!token,
  });
}

/** Лог использования API-ключа (модалка в api-keys.tsx). */
export function useApiKeyUsage(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.apiKeyUsage(id ?? ""),
    queryFn: () => api.getApiKeyUsage(token!, id!, 100).catch(() => [] as ApiKeyUsageItem[]),
    enabled: !!token && !!id,
  });
}

/** Список доп. подписок с фильтрами (admin-secondary-subscriptions.tsx). */
export function useSecondarySubscriptions(token: string | null, filters: AdminSecondarySubscriptionFilters) {
  return useQuery({
    queryKey: qk.admin.secondarySubscriptions(filters),
    queryFn: () => api.getSecondarySubscriptions(token!, filters),
    enabled: !!token,
    placeholderData: (prev) => prev,
  });
}

/** Детальная карточка доп. подписки (диалог в admin-secondary-subscriptions.tsx). */
export function useSecondarySubscriptionDetail(token: string | null, id: string | null) {
  return useQuery({
    queryKey: qk.admin.secondarySubscription(id ?? ""),
    queryFn: () => api.getSecondarySubscription(token!, id!).catch(() => null),
    enabled: !!token && !!id,
  });
}

/** Обзор реферальной сети: топ-рефереры + статистика (admin-referrals.tsx). */
export function useReferralNetworkOverview(token: string | null) {
  return useQuery({
    queryKey: qk.admin.referralNetwork(),
    queryFn: () => api.getReferralNetwork(token!).catch(() => null),
    enabled: !!token,
  });
}

/** Живой поиск клиента по рефералке (debounce снаружи, 280мс). */
export function useReferralLookup(token: string | null, query: string) {
  return useQuery({
    queryKey: qk.admin.referralLookup(query),
    queryFn: () => api.lookupReferralClient(token!, query).catch(() => ({ clients: [] as LookupClientShape[] })),
    enabled: !!token && query.trim().length >= 2,
  });
}

/** Детальная карточка рефералки. */
export function useReferralDetail(token: string | null, clientId: string | null) {
  return useQuery({
    queryKey: qk.admin.referralDetail(clientId ?? ""),
    queryFn: () => api.getReferralDetail(token!, clientId!).catch(() => null),
    enabled: !!token && !!clientId,
  });
}


type LookupClientShape = {
  id: string;
  telegramId: string | null;
  telegramUsername?: string | null;
  email?: string | null;
  referralCode?: string | null;
  _count: { referrals: number; referralCredits: number };
};

/* ── Tour constructor (tour-constructor.tsx) ───────────────────────────── */

export function useAdminTourSteps(token: string | null) {
  return useQuery({
    queryKey: qk.admin.tourSteps(),
    queryFn: () => api.getTourSteps(token!),
    enabled: !!token,
  });
}

export function useAdminTourMascots(token: string | null) {
  return useQuery({
    queryKey: qk.admin.tourMascots(),
    queryFn: () => api.getTourMascots(token!),
    enabled: !!token,
  });
}

/* ── Landing editor (landing-editor.tsx) — api из lib/landing-editor-api ── */

export function useAdminLandingBlocks(token: string | null) {
  return useQuery({
    queryKey: qk.admin.landingBlocks(),
    queryFn: () => landingEditorApi.listBlocks(token!),
    enabled: !!token,
  });
}

export function useAdminLandingDraftsStatus(token: string | null) {
  return useQuery({
    queryKey: qk.admin.landingDraftsStatus(),
    queryFn: () => landingEditorApi.draftsStatus(token!),
    enabled: !!token,
  });
}

export function useAdminLandingStatus(token: string | null) {
  return useQuery({
    queryKey: qk.admin.landingStatus(),
    queryFn: () => landingEditorApi.getStatus(token!),
    enabled: !!token,
  });
}

export function useAdminLandingSnapshots(token: string | null, open: boolean) {
  return useQuery({
    queryKey: qk.admin.landingSnapshots(),
    queryFn: () => landingEditorApi.listSnapshots(token!),
    enabled: !!token && open,
  });
}
