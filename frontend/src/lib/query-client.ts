/**
 * TanStack Query — единый QueryClient для всего фронтенда.
 *
 * Политики:
 *  - queries: staleTime 30s (данные кабинета меняются нечасто; повторные
 *    монтирования компонентов не рефетчат), refetchOnWindowFocus off
 *    (кабинет не должен «мигать» при alt-tab), retry 1 (быстрый отказ).
 *  - mutations: retry 0 (оплата/активация — не ретраим автоматически).
 *  - 401 не ретраится никогда: это сигнал «перелогинься».
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: 0,
    },
  },
});

/** Ключи кеша — централизованно, чтобы invalidate не расходился со схемой. */
export const qk = {
  publicConfig: ["public-config"] as const,
  landing: (lang: string) => ["landing", lang] as const,
  client: {
    me: (token: string | null) => ["client", "me", token] as const,
    subscription: (token: string | null) => ["client", "subscription", token] as const,
    allSubscriptions: (token: string | null) => ["client", "all-subscriptions", token] as const,
    payments: (token: string | null) => ["client", "payments", token] as const,
    devices: (token: string | null) => ["client", "devices", token] as const,
    myDevices: (token: string | null) => ["client", "my-devices", token] as const,
    referralStats: (token: string | null) => ["client", "referral-stats", token] as const,
    availableTrials: (token: string | null) => ["client", "available-trials", token] as const,
    publicTariffs: () => ["tariffs", "public"] as const,
  },
  admin: {
    dashboardStats: () => ["admin", "dashboard-stats"] as const,
    serverStats: () => ["admin", "server-stats"] as const,
    analytics: (period?: number) => ["admin", "analytics", period ?? null] as const,
    giftAnalytics: () => ["admin", "gift-analytics"] as const,
    remnaNodes: () => ["admin", "remna-nodes"] as const,
    remnaSystemStats: () => ["admin", "remna-system-stats"] as const,
    remnaMetrics: () => ["admin", "remna-metrics"] as const,
    remnaRecap: () => ["admin", "remna-recap"] as const,
    remnaBandwidth: () => ["admin", "remna-bandwidth"] as const,
    remnaHwidStats: () => ["admin", "remna-hwid-stats"] as const,
    remnaHwidTop: () => ["admin", "remna-hwid-top"] as const,
    remnaTorrentReports: () => ["admin", "remna-torrent-reports"] as const,
    remnaTorrentStats: () => ["admin", "remna-torrent-stats"] as const,
    remnaConfigProfiles: () => ["admin", "remna-config-profiles"] as const,
    remnaSquads: () => ["admin", "remna-squads"] as const,
    remnaHosts: () => ["admin", "remna-hosts"] as const,
    remnaSubTemplates: () => ["admin", "remna-sub-templates"] as const,
    remnaHostTags: () => ["admin", "remna-host-tags"] as const,
    remnaSubTemplate: (id: string) => ["admin", "remna-sub-template", id] as const,
    remnaInfraProviders: () => ["admin", "remna-infra-providers"] as const,
    remnaInfraBillingNodes: () => ["admin", "remna-infra-billing-nodes"] as const,
    remnaSubSettings: () => ["admin", "remna-sub-settings"] as const,
    remnaPubKey: () => ["admin", "remna-pub-key"] as const,
    settings: () => ["admin", "settings"] as const,
    sshConfig: () => ["admin", "ssh-config"] as const,
    languages: () => ["admin", "languages"] as const,
    autoRenewStats: () => ["admin", "auto-renew-stats"] as const,
    subscriptionPageConfig: () => ["admin", "subscription-page-config"] as const,
    remnaStatus: () => ["admin", "remna-status"] as const,
    notificationCounters: () => ["admin", "notification-counters"] as const,
    clients: (params: string) => ["admin", "clients", params] as const,
    clientDetail: (id: string) => ["admin", "client-detail", id] as const,
    clientServices: (id: string) => ["admin", "client-services", id] as const,
    clientOnline: (ids: string) => ["admin", "client-online", ids] as const,
    clientRemna: (id: string) => ["admin", "client-remna", id] as const,
    clientRemnaUsage: (id: string) => ["admin", "client-remna-usage", id] as const,
    clientSubscriptionsList: (id: string) => ["admin", "client-subscriptions-list", id] as const,
    clientDevices: (id: string) => ["admin", "client-devices", id] as const,
    clientSubsOverview: (id: string) => ["admin", "client-subs-overview", id] as const,
    clientAudit: (id: string) => ["admin", "client-audit", id] as const,
    tariffs: () => ["admin", "tariffs"] as const,
    tariffCategories: () => ["admin", "tariff-categories"] as const,
    proxyNodes: () => ["admin", "proxy-nodes"] as const,
    proxyCategories: () => ["admin", "proxy-categories"] as const,
    proxyTariffs: () => ["admin", "proxy-tariffs"] as const,
    proxySlots: (params: string) => ["admin", "proxy-slots", params] as const,
    singboxNodes: () => ["admin", "singbox-nodes"] as const,
    singboxCategories: () => ["admin", "singbox-categories"] as const,
    singboxTariffs: () => ["admin", "singbox-tariffs"] as const,
    singboxNodeDetail: (id: string) => ["admin", "singbox-node-detail", id] as const,
    videoInstructions: () => ["admin", "video-instructions"] as const,
    adminsList: () => ["admin", "admins-list"] as const,
    withdrawals: (status: string) => ["admin", "withdrawals", status] as const,
    apiKeys: () => ["admin", "api-keys"] as const,
    apiKeyUsage: (id: string) => ["admin", "api-key-usage", id] as const,
    backupList: () => ["admin", "backup-list"] as const,
    adminPermissionActions: () => ["admin", "admin-permission-actions"] as const,
    secondarySubscriptions: (filters?: unknown) => ["admin", "secondary-subscriptions", filters ?? null] as const,
    secondarySubscription: (id: string) => ["admin", "secondary-subscription", id] as const,
    referralNetwork: () => ["admin", "referral-network"] as const,
    referralLookup: (q: string) => ["admin", "referral-lookup", q] as const,
    referralDetail: (clientId: string) => ["admin", "referral-detail", clientId] as const,
    languageKeys: () => ["admin", "language-keys"] as const,
    languagePack: (code: string) => ["admin", "language-pack", code] as const,
    balanceSales: (params: string) => ["admin", "balance-sales", params] as const,
    salesReport: (params: string) => ["admin", "sales-report", params] as const,
    broadcastRecipients: () => ["admin", "broadcast-recipients"] as const,
    broadcastHistory: () => ["admin", "broadcast-history"] as const,
    autoBroadcastRules: () => ["admin", "auto-broadcast-rules"] as const,
    autoBroadcastEligible: () => ["admin", "auto-broadcast-eligible-counts"] as const,
    contests: () => ["admin", "contests"] as const,
    contestDetail: (id: string) => ["admin", "contest-detail", id] as const,
    contestParticipantsPreview: (id: string) => ["admin", "contest-participants-preview", id] as const,
    promoGroups: () => ["admin", "promo-groups"] as const,
    promoGroupDetail: (id: string) => ["admin", "promo-group-detail", id] as const,
    promoCodes: () => ["admin", "promo-codes"] as const,
    promoCodeDetail: (id: string) => ["admin", "promo-code-detail", id] as const,
    trials: () => ["admin", "trials"] as const,
    autoRenewNotifications: () => ["admin", "auto-renew-notifications"] as const,
    gramadsStatus: () => ["admin", "gramads-status"] as const,
    gramadsWallet: () => ["admin", "gramads-wallet"] as const,
    gramadsPosts: (filter: string) => ["admin", "gramads-posts", filter] as const,
    gramadsPostStats: (postId: number) => ["admin", "gramads-post-stats", postId] as const,
    tourSteps: () => ["admin", "tour-steps"] as const,
    tourMascots: () => ["admin", "tour-mascots"] as const,
    landingBlocks: () => ["admin", "landing-blocks"] as const,
    landingDraftsStatus: () => ["admin", "landing-drafts-status"] as const,
    landingStatus: () => ["admin", "landing-status"] as const,
    landingSnapshots: () => ["admin", "landing-snapshots"] as const,
  },
} as const;
