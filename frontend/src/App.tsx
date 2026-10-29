import { AdminDialogHost } from "@/components/admin/admin-dialog-host";
import { lazyPage } from "@/lib/lazy-page";
const CabinetDesignEditorPage = lazyPage(() => import("@/pages/cabinet-design-editor").then(module => ({ default: module.CabinetDesignEditorPage })));
const CabinetDesignPreviewPage = lazyPage(() => import("@/pages/cabinet-design-preview").then(module => ({ default: module.CabinetDesignPreviewPage })));
import { CabinetDesignRuntime } from "@/components/cabinet-design/runtime";
import { CabinetConfigProvider } from "@/contexts/cabinet-config";
import { ClientHistoryPage } from "@/pages/cabinet/client-history";
import { ClientWalletPage } from "@/pages/cabinet/client-wallet";
import { ClientHelpPage } from "@/pages/cabinet/client-help";
import { MaintenanceGate } from "@/components/maintenance-gate";
import { clientMenuReturnTo } from "@/lib/client-menu-return";
import { ClientBotMenuPage } from "@/pages/cabinet/client-bot-menu";
import { needsClientOnboarding } from "@/lib/client-onboarding";
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

const routerFutureFlags = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};
import { AuthProvider, useAuth } from "@/contexts/auth";
import { ClientAuthProvider, useClientAuth } from "@/contexts/client-auth";
import { ThemeProvider } from "@/contexts/theme";
import { AnimatedBackground } from "@/components/animated-background";
import { PwaUpdatePrompt } from "@/components/pwa/pwa-update-prompt";
import { LoginPage } from "@/pages/login";
import { ChangePasswordPage } from "@/pages/change-password";
const DashboardPage = lazyPage(() => import("@/pages/dashboard").then(module => ({ default: module.DashboardPage })));
const ClientsPage = lazyPage(() => import("@/pages/clients").then(module => ({ default: module.ClientsPage })));
const TariffsPage = lazyPage(() => import("@/pages/tariffs").then(module => ({ default: module.TariffsPage })));
const TrialsPage = lazyPage(() => import("@/pages/trials").then(module => ({ default: module.TrialsPage }))); // T15 (11.05.2026)
const WithdrawalsPage = lazyPage(() => import("@/pages/withdrawals").then(module => ({ default: module.WithdrawalsPage }))); // T6 (11.05.2026)
const AutoRenewPage = lazyPage(() => import("@/pages/auto-renew").then(module => ({ default: module.AutoRenewPage }))); // T-autorenew (12.05.2026)
const SettingsPage = lazyPage(() => import("@/pages/settings").then(module => ({ default: module.SettingsPage })));
const LandingEditorPage = lazyPage(() => import("@/pages/landing-editor").then(module => ({ default: module.LandingEditorPage })));
const LandingPreviewPage = lazyPage(() => import("@/pages/landing-preview").then(module => ({ default: module.LandingPreviewPage })));
const AdminAuditPage = lazyPage(() => import("@/pages/admin-audit").then(module => ({ default: module.AdminAuditPage })));
const AdminWebhookInboxPage = lazyPage(() => import("@/pages/admin-webhook-inbox").then(module => ({ default: module.AdminWebhookInboxPage })));
const AdminDiagnosticsPage = lazyPage(() => import("@/pages/admin-diagnostics").then(module => ({ default: module.AdminDiagnosticsPage })));
const AdminBusinessAnalyticsPage = lazyPage(() => import("@/pages/admin-business-analytics").then(module => ({ default: module.AdminBusinessAnalyticsPage })));
const AdminAntiFraudPage = lazyPage(() => import("@/pages/admin-anti-fraud").then(module => ({ default: module.AdminAntiFraudPage })));
const AdminEmailTemplatesPage = lazyPage(() => import("@/pages/admin-email-templates").then(module => ({ default: module.AdminEmailTemplatesPage })));
const AdminBotMessagesPage = lazyPage(() => import("@/pages/admin-bot-messages").then(module => ({ default: module.AdminBotMessagesPage })));
const AdminBotConversationsPage = lazyPage(() => import("@/pages/admin-bot-conversations").then(module => ({ default: module.AdminBotConversationsPage })));
import { CmdKPalette } from "@/components/cmd-k-palette";
const PromoPage = lazyPage(() => import("@/pages/promo").then(module => ({ default: module.PromoPage })));
const PromoCodesPage = lazyPage(() => import("@/pages/promo-codes").then(module => ({ default: module.PromoCodesPage })));
const RemnaNodesPage = lazyPage(() => import("@/pages/remna-nodes").then(module => ({ default: module.RemnaNodesPage })));
const RemnaSquadsPage = lazyPage(() => import("@/pages/remna-squads").then(module => ({ default: module.RemnaSquadsPage })));
const RemnaHostsPage = lazyPage(() => import("@/pages/remna-hosts").then(module => ({ default: module.RemnaHostsPage })));
const RemnaProfilesPage = lazyPage(() => import("@/pages/remna-profiles").then(module => ({ default: module.RemnaProfilesPage })));
const RemnaSubTemplatesPage = lazyPage(() => import("@/pages/remna-sub-templates").then(module => ({ default: module.RemnaSubTemplatesPage })));
const AnalyticsPage = lazyPage(() => import("@/pages/analytics").then(module => ({ default: module.AnalyticsPage })));
const MarketingPage = lazyPage(() => import("@/pages/marketing").then(module => ({ default: module.MarketingPage })));
const AdminsPage = lazyPage(() => import("@/pages/admins").then(module => ({ default: module.AdminsPage })));
const SalesReportPage = lazyPage(() => import("@/pages/sales-report").then(module => ({ default: module.SalesReportPage })));
const BalanceSalesPage = lazyPage(() => import("@/pages/balance-sales").then(module => ({ default: module.BalanceSalesPage })));
const VideoInstructionsPage = lazyPage(() => import("@/pages/video-instructions").then(module => ({ default: module.VideoInstructionsPage })));
const BackupPage = lazyPage(() => import("@/pages/backup").then(module => ({ default: module.BackupPage })));
const ContestsPage = lazyPage(() => import("@/pages/contests").then(module => ({ default: module.ContestsPage })));
const AdminTicketsPage = lazyPage(() => import("@/pages/admin-tickets").then(module => ({ default: module.AdminTicketsPage })));
const BroadcastPage = lazyPage(() => import("@/pages/broadcast").then(module => ({ default: module.BroadcastPage })));
const AutoBroadcastPage = lazyPage(() => import("@/pages/auto-broadcast").then(module => ({ default: module.AutoBroadcastPage })));
const ReferralNetworkPage = lazyPage(() => import("@/pages/referral-network").then(module => ({ default: module.ReferralNetworkPage })));
const AdminReferralsPage = lazyPage(() => import("@/pages/admin-referrals").then(module => ({ default: module.AdminReferralsPage })));
const GramadsPromoPage = lazyPage(() => import("@/pages/gramads-promo").then(module => ({ default: module.GramadsPromoPage })));
const TrafficAbusePage = lazyPage(() => import("@/pages/traffic-abuse").then(module => ({ default: module.TrafficAbusePage })));
const AntiAbusePage = lazyPage(() => import("@/pages/anti-abuse").then(module => ({ default: module.AntiAbusePage })));
const ApiKeysPage = lazyPage(() => import("@/pages/api-keys").then(module => ({ default: module.ApiKeysPage })));
const AntibotPage = lazyPage(() => import("@/pages/antibot").then(module => ({ default: module.AntibotPage })));
const ApiDocsPage = lazyPage(() => import("@/pages/api-docs").then(module => ({ default: module.ApiDocsPage })));
const AdminSecondarySubscriptionsPage = lazyPage(() => import("@/pages/admin-secondary-subscriptions").then(module => ({ default: module.AdminSecondarySubscriptionsPage })));
const ProxyPage = lazyPage(() => import("@/pages/proxy").then(module => ({ default: module.ProxyPage })));
const SingboxPage = lazyPage(() => import("@/pages/singbox").then(module => ({ default: module.SingboxPage })));
const LanguagesPage = lazyPage(() => import("@/pages/languages"));
const TourConstructorPage = lazyPage(() => import("@/pages/tour-constructor").then(module => ({ default: module.TourConstructorPage })));
import { MarketplaceLayout } from "@/pages/marketplace/marketplace-layout";
import { MarketplaceBrowsePage } from "@/pages/marketplace/marketplace-browse";
import { MarketplaceMyListingsPage } from "@/pages/marketplace/marketplace-my";
import { MarketplaceEditListingPage } from "@/pages/marketplace/marketplace-edit";
import { MarketplaceHubInstallationsPage } from "@/pages/marketplace/marketplace-hub-installations";
import { MarketplaceHubReportsPage } from "@/pages/marketplace/marketplace-hub-reports";
import { MarketplaceHubCategoriesPage } from "@/pages/marketplace/marketplace-hub-categories";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { CabinetLayout } from "@/pages/cabinet/cabinet-layout";
import { ClientLoginPage } from "@/pages/cabinet/client-login";
import { ClientRegisterPage } from "@/pages/cabinet/client-register";
import { ClientForgotPasswordPage } from "@/pages/cabinet/client-forgot-password";
import { ClientResetPasswordPage } from "@/pages/cabinet/client-reset-password";
import { ClientPaymentWaitPage } from "@/pages/cabinet/client-payment-wait";
import { ClientOnboardingPage } from "@/pages/cabinet/client-onboarding";
import { ClientVerifyEmailPage } from "@/pages/cabinet/client-verify-email";
import { ClientVerifyLinkEmailPage } from "@/pages/cabinet/client-verify-link-email";
import { ClientDashboardPage } from "@/pages/cabinet/client-dashboard";
import { ClientTariffsPage } from "@/pages/cabinet/client-tariffs";
import { ClientProfilePage } from "@/pages/cabinet/client-profile";
import { ClientReferralPage } from "@/pages/cabinet/client-referral";
import { ClientSubscribePage } from "@/pages/cabinet/client-subscribe";
import { ClientYooMoneyPayPage } from "@/pages/cabinet/client-yoomoney-pay";
import { ClientExtraOptionsPage } from "@/pages/cabinet/client-extra-options";
import { ClientProxyPage } from "@/pages/cabinet/client-proxy";
import { ClientSingboxPage } from "@/pages/cabinet/client-singbox";
import { ClientTicketsPage } from "@/pages/cabinet/client-tickets";
import { ClientCustomBuildPage } from "@/pages/cabinet/client-custom-build";
import { ClientGiftsPage } from "@/pages/cabinet/client-gifts";
import { ClientRoulettePage } from "@/pages/cabinet/client-roulette";
import { ClientLegalDocsPage } from "@/pages/cabinet/client-legal-docs";
import { GiftActivatePage } from "@/pages/gift-activate";
import { LandingPage } from "@/pages/landing";
import type { PublicConfig } from "@/lib/api";
import { getPublicConfigCached } from "@/lib/public-config";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const hasToken = Boolean(state.accessToken);

  if (!hasToken) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

function ForceChangePassword({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (state.admin?.mustChangePassword) {
    return <Navigate to="/admin/change-password" replace />;
  }
  return <>{children}</>;
}

function RequireClientAuth({ children }: { children: React.ReactNode }) {
  const { state } = useClientAuth();
  const location = useLocation();
  const inTelegram = typeof window !== "undefined" && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
  const showMiniappLoading = state.miniappAuthLoading || (inTelegram && !state.token && !state.miniappAuthAttempted);
  if (showMiniappLoading) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-muted/20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Загрузка кабинета…</p>
      </div>
    );
  }
  if (!state.token) {
    return <Navigate to="/cabinet/login" replace />;
  }
  // Проверяем серверный флаг onboardingCompleted ИЛИ эфемерный isNewTelegramUser
  const needsOnboarding = needsClientOnboarding(state.client, state.isNewTelegramUser);
  if (needsOnboarding && location.pathname !== "/cabinet/onboarding") {
    return <Navigate to="/cabinet/onboarding" replace state={{ returnTo: location.pathname + location.search + location.hash }} />;
  }
  return <>{children}</>;
}

function RequireOnboarding({ children }: { children: React.ReactNode }) {
  const { state } = useClientAuth();
  const location = useLocation();
  const needsOnboarding = needsClientOnboarding(state.client, state.isNewTelegramUser);
  if (!needsOnboarding) {
    return <Navigate to={clientMenuReturnTo(location.state?.returnTo)} replace />;
  }
  return <>{children}</>;
}

function CabinetIndexRedirect() {
  const { state } = useClientAuth();
  const inTelegram = typeof window !== "undefined" && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
  const showMiniappLoading = state.miniappAuthLoading || (inTelegram && !state.token && !state.miniappAuthAttempted);
  if (showMiniappLoading) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-muted/20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Загрузка кабинета…</p>
      </div>
    );
  }
  return <Navigate to={state.token ? "/cabinet/dashboard" : "/cabinet/login"} replace />;
}

function RootRoute() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  // Лендинг грузим ПАРАЛЛЕЛЬНО с конфигом: два последовательных лоадера
  // (сначала «Загрузка…» из-за config, потом слейтовый спиннер из-за landing) выглядели как «два лоадера подряд».
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // Язык лендинга неизвестен до конфига — грузим с дефолтом «ru»; если дефолт другой,
    // LandingPage перезагрузит контент внутри себя (старое поведение, редкий кейс).
    // Module-level promise: StrictMode (mount→cleanup→mount) не порождает второй fetch.
    getPublicConfigCached()
      .then((c) => { if (alive) setConfig(c); })
      .catch(() => { if (alive) setConfig(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-muted/20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Загрузка…</p>
      </div>
    );
  }

  if (config?.landingEnabled) {
    return <LandingPage config={config} />;
  }

  return <Navigate to="/cabinet" replace />;
}

function AppRoutes() {
  const { state, refreshAccess } = useAuth();

  useEffect(() => {
    if (!state.accessToken && state.refreshToken) {
      refreshAccess();
    }
  }, []);

  return (
    <MaintenanceGate><CabinetDesignRuntime /><Routes>
      {/* Главная: лендинг (если включён в настройках) или редирект в кабинет */}
      <Route path="/" element={<RootRoute />} />

      <Route path="/admin/landing-preview" element={<RequireAuth><ForceChangePassword><LandingPreviewPage /></ForceChangePassword></RequireAuth>} />
      <Route path="/cabinet-design-preview" element={<RequireAuth><CabinetDesignPreviewPage /></RequireAuth>} />
      <Route path="/admin/landing-editor" element={<RequireAuth><ForceChangePassword><LandingEditorPage /></ForceChangePassword></RequireAuth>} />
      {/* Админка */}
      <Route path="/admin/login" element={state.accessToken ? <Navigate to="/admin" replace /> : <LoginPage />} />
      <Route
        path="/admin/change-password"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <>
              <CmdKPalette />
              <DashboardLayout />
            </>
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <ForceChangePassword>
              <DashboardPage />
            </ForceChangePassword>
          }
        />
        <Route path="clients" element={<ForceChangePassword><ClientsPage /></ForceChangePassword>} />
        <Route path="tariffs" element={<ForceChangePassword><TariffsPage /></ForceChangePassword>} />
        {/* T15 (11.05.2026) */}
        <Route path="trials" element={<ForceChangePassword><TrialsPage /></ForceChangePassword>} />
        {/* T6 (11.05.2026) */}
        <Route path="withdrawals" element={<ForceChangePassword><WithdrawalsPage /></ForceChangePassword>} />
        {/* T-autorenew (12.05.2026) */}
        <Route path="auto-renew" element={<ForceChangePassword><AutoRenewPage /></ForceChangePassword>} />
        <Route path="cabinet-design" element={<ForceChangePassword><CabinetDesignEditorPage /></ForceChangePassword>} />
        <Route path="settings" element={<ForceChangePassword><SettingsPage /></ForceChangePassword>} />


        <Route path="audit" element={<ForceChangePassword><AdminAuditPage /></ForceChangePassword>} />
        <Route path="webhook-inbox" element={<ForceChangePassword><AdminWebhookInboxPage /></ForceChangePassword>} />
        <Route path="diagnostics" element={<ForceChangePassword><AdminDiagnosticsPage /></ForceChangePassword>} />
        <Route path="business-analytics" element={<ForceChangePassword><AdminBusinessAnalyticsPage /></ForceChangePassword>} />
        <Route path="anti-fraud" element={<ForceChangePassword><AdminAntiFraudPage /></ForceChangePassword>} />
        <Route path="email-templates" element={<ForceChangePassword><AdminEmailTemplatesPage /></ForceChangePassword>} />
        <Route path="bot-messages" element={<ForceChangePassword><AdminBotMessagesPage /></ForceChangePassword>} />
        <Route path="bot-conversations" element={<ForceChangePassword><AdminBotConversationsPage /></ForceChangePassword>} />
        <Route path="promo" element={<ForceChangePassword><PromoPage /></ForceChangePassword>} />
        <Route path="promo-codes" element={<ForceChangePassword><PromoCodesPage /></ForceChangePassword>} />
        <Route path="remna-nodes" element={<ForceChangePassword><RemnaNodesPage /></ForceChangePassword>} />
        <Route path="remna-squads" element={<ForceChangePassword><RemnaSquadsPage /></ForceChangePassword>} />
        <Route path="remna-hosts" element={<ForceChangePassword><RemnaHostsPage /></ForceChangePassword>} />
        <Route path="remna-profiles" element={<ForceChangePassword><RemnaProfilesPage /></ForceChangePassword>} />
        <Route path="remna-sub-templates" element={<ForceChangePassword><RemnaSubTemplatesPage /></ForceChangePassword>} />
        <Route path="analytics" element={<ForceChangePassword><AnalyticsPage /></ForceChangePassword>} />
        <Route path="marketing" element={<ForceChangePassword><MarketingPage /></ForceChangePassword>} />
        <Route path="admins" element={<ForceChangePassword><AdminsPage /></ForceChangePassword>} />
        <Route path="sales-report" element={<ForceChangePassword><SalesReportPage /></ForceChangePassword>} />
        <Route path="balance-sales" element={<ForceChangePassword><BalanceSalesPage /></ForceChangePassword>} />
        <Route path="video-instructions" element={<ForceChangePassword><VideoInstructionsPage /></ForceChangePassword>} />
        <Route path="broadcast" element={<ForceChangePassword><BroadcastPage /></ForceChangePassword>} />
        <Route path="auto-broadcast" element={<ForceChangePassword><AutoBroadcastPage /></ForceChangePassword>} />
        <Route path="proxy" element={<ForceChangePassword><ProxyPage /></ForceChangePassword>} />
        <Route path="singbox" element={<ForceChangePassword><SingboxPage /></ForceChangePassword>} />
        <Route path="backup" element={<ForceChangePassword><BackupPage /></ForceChangePassword>} />
        <Route path="contests" element={<ForceChangePassword><ContestsPage /></ForceChangePassword>} />
        <Route path="tickets" element={<ForceChangePassword><AdminTicketsPage /></ForceChangePassword>} />
        <Route path="referral-network" element={<ForceChangePassword><ReferralNetworkPage /></ForceChangePassword>} />
        <Route path="referrals" element={<ForceChangePassword><AdminReferralsPage /></ForceChangePassword>} />
        <Route path="traffic-abuse" element={<ForceChangePassword><TrafficAbusePage /></ForceChangePassword>} />
        <Route path="anti-abuse" element={<ForceChangePassword><AntiAbusePage /></ForceChangePassword>} />
        <Route path="api-keys" element={<ForceChangePassword><ApiKeysPage /></ForceChangePassword>} />
        <Route path="antibot" element={<ForceChangePassword><AntibotPage /></ForceChangePassword>} />
        <Route path="languages" element={<ForceChangePassword><LanguagesPage /></ForceChangePassword>} />
        <Route path="api-docs" element={<ForceChangePassword><ApiDocsPage /></ForceChangePassword>} />
        <Route path="secondary-subscriptions" element={<ForceChangePassword><AdminSecondarySubscriptionsPage /></ForceChangePassword>} />
        <Route path="tour-constructor" element={<ForceChangePassword><TourConstructorPage /></ForceChangePassword>} />
        <Route path="promo-vpn" element={<ForceChangePassword><GramadsPromoPage /></ForceChangePassword>} />
        <Route path="marketplace" element={<ForceChangePassword><MarketplaceLayout /></ForceChangePassword>}>
          <Route index element={<MarketplaceBrowsePage />} />
          <Route path="my" element={<MarketplaceMyListingsPage />} />
          <Route path="my/new" element={<MarketplaceEditListingPage />} />
          <Route path="my/:id/edit" element={<MarketplaceEditListingPage />} />
          <Route path="hub/installations" element={<MarketplaceHubInstallationsPage />} />
          <Route path="hub/reports" element={<MarketplaceHubReportsPage />} />
          <Route path="hub/categories" element={<MarketplaceHubCategoriesPage />} />
        </Route>
      </Route>
      {/* Онбординг — вне CabinetLayout (без навбара) */}
      <Route
        path="/cabinet/onboarding"
        element={
          <ClientAuthProvider>
            <RequireClientAuth>
              <RequireOnboarding>
                <CabinetConfigProvider><ClientOnboardingPage /></CabinetConfigProvider>
              </RequireOnboarding>
            </RequireClientAuth>
          </ClientAuthProvider>
        }
      />

      {/* Публичная страница подарка — без auth */}
      <Route
        path="/gift/:code"
        element={
          <ClientAuthProvider>
            <GiftActivatePage />
          </ClientAuthProvider>
        }
      />

      <Route
        path="/cabinet"
        element={
          <ClientAuthProvider>
            <CabinetLayout />
          </ClientAuthProvider>
        }
      >
        <Route index element={<CabinetIndexRedirect />} />
        <Route path="history" element={<RequireClientAuth><ClientHistoryPage /></RequireClientAuth>} />
        <Route path="wallet" element={<RequireClientAuth><ClientWalletPage /></RequireClientAuth>} />
        <Route path="help" element={<RequireClientAuth><ClientHelpPage /></RequireClientAuth>} />
        <Route path="login" element={<ClientLoginPage />} />
        <Route path="register" element={<ClientRegisterPage />} />
        <Route path="forgot-password" element={<ClientForgotPasswordPage />} />
        <Route path="reset-password" element={<ClientResetPasswordPage />} />
        <Route path="verify-email" element={<ClientVerifyEmailPage />} />
        {/* issue #112/#127: legal-документы — публичные (до auth-гейта), redirect на external link из настроек */}
        <Route path="documents/privacy" element={<ClientLegalDocsPage kind="privacy" />} />
        <Route path="documents/offer" element={<ClientLegalDocsPage kind="offer" />} />
        <Route path="documents/refund" element={<ClientLegalDocsPage kind="refund" />} />
        <Route path="verify-link-email" element={<ClientVerifyLinkEmailPage />} />
        <Route path="menu/:section" element={<RequireClientAuth><ClientBotMenuPage /></RequireClientAuth>} />
        <Route
          path="dashboard"
          element={
            <RequireClientAuth>
              <ClientDashboardPage />
            </RequireClientAuth>
          }
        />
        {/* T-pay-wait (портировано из WolfVPN): страница ожидания оплаты (polling) — return_url платёжек ведёт сюда */}
        <Route
          path="payment-wait"
          element={
            <RequireClientAuth>
              <ClientPaymentWaitPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="tariffs"
          element={
            <RequireClientAuth>
              <ClientTariffsPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="profile"
          element={
            <RequireClientAuth>
              <ClientProfilePage />
            </RequireClientAuth>
          }
        />
        <Route
          path="referral"
          element={
            <RequireClientAuth>
              <ClientReferralPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="tickets"
          element={
            <RequireClientAuth>
              <ClientTicketsPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="subscribe"
          element={
            <RequireClientAuth>
              <ClientSubscribePage />
            </RequireClientAuth>
          }
        />
        <Route
          path="yoomoney-pay"
          element={
            <RequireClientAuth>
              <ClientYooMoneyPayPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="custom-build"
          element={
            <RequireClientAuth>
              <ClientCustomBuildPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="extra-options"
          element={
            <RequireClientAuth>
              <ClientExtraOptionsPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="proxy"
          element={
            <RequireClientAuth>
              <ClientProxyPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="singbox"
          element={
            <RequireClientAuth>
              <ClientSingboxPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="gifts"
          element={
            <RequireClientAuth>
              <ClientGiftsPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="roulette"
          element={
            <RequireClientAuth>
              <ClientRoulettePage />
            </RequireClientAuth>
          }
        />
      </Route>
      {/* Всё неизвестное тоже ведём в кабинет */}
      <Route path="*" element={<Navigate to="/cabinet" replace />} />
    </Routes></MaintenanceGate>
  );
}

function TitleAndThemeSync() {
  const location = useLocation();
  const [config, setConfig] = useState<{ serviceName: string; serviceDescription: string | null; favicon: string | null } | null>(null);

  // Подтягиваем конфиг при смене маршрута (в т.ч. после сохранения настроек), чтобы favicon обновился.
  // Кеш: повторные переходы НЕ дёргают HTTP — берём тот же закешированный promise.
  useEffect(() => {
    let alive = true;
    getPublicConfigCached()
      .then((cfg) => {
        if (!alive) return;
        setConfig({
          serviceName: cfg.serviceName ?? "",
          serviceDescription: cfg.serviceDescription ?? null,
          favicon: cfg.favicon ?? null,
        });
        // Глобальная тема из настроек
      })
      .catch(() => {
        if (alive) setConfig({ serviceName: "", serviceDescription: null, favicon: null });
      });
    return () => { alive = false; };
  }, [location.pathname]);

  // Title и favicon
  useEffect(() => {
    if (!config) return;
    const base = config.serviceName ?? "";
    let suffix = "";
    if (location.pathname.startsWith("/admin")) suffix = " — Admin";
    else if (location.pathname.startsWith("/cabinet")) suffix = " — Кабинет";
    if (location.pathname !== "/") document.title = (base + suffix).trim() || suffix.replace(/^ — /, "").trim();

    // Custom favicon: убираем все статические <link rel="icon"> из index.html
    // (svg, 32px, 16px, apple-touch и иконки PWA-манифеста), потому что
    // браузер выбирает «лучший» по размеру, и PWA-иконка может перебить
    // пользовательский favicon. Помечаем добавленные нами линки атрибутом
    // data-custom-favicon, чтобы при обновлении не плодить дубли.
    //
    // Также подменяем <link rel="manifest"> на динамический эндпоинт
    // /api/public/manifest.webmanifest когда есть custom favicon — иначе
    // PWA install/Add-to-home-screen покажет дефолтную иконку сборки.
    if (config.serviceDescription && location.pathname !== "/") {
      let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "description";
        document.head.appendChild(meta);
      }
      meta.content = config.serviceDescription;
    }
    const favicon = config.favicon ?? null;
    const existingCustom = document.querySelectorAll<HTMLLinkElement>('link[data-custom-favicon="1"]');
    const builtin = document.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"]:not([data-custom-favicon]), link[rel="apple-touch-icon"]:not([data-custom-favicon]), link[rel="shortcut icon"]:not([data-custom-favicon]), link[rel="mask-icon"]:not([data-custom-favicon])'
    );

    if (favicon) {
      // Убираем дефолтные иконки сборки (favicon-16/32, apple-touch, svg).
      builtin.forEach((el) => el.remove());
      existingCustom.forEach((el) => el.remove());

      const detectType = (src: string): string => {
        if (src.startsWith("data:image/")) {
          const m = src.match(/data:image\/(\w+)/);
          return m ? `image/${m[1].toLowerCase()}` : "image/png";
        }
        if (/\.svg(\?|$)/i.test(src)) return "image/svg+xml";
        if (/\.png(\?|$)/i.test(src)) return "image/png";
        if (/\.(jpg|jpeg)(\?|$)/i.test(src)) return "image/jpeg";
        if (/\.webp(\?|$)/i.test(src)) return "image/webp";
        if (/\.ico(\?|$)/i.test(src)) return "image/x-icon";
        return "image/png";
      };
      const type = detectType(favicon);

      // Главный favicon — без sizes, чтобы браузер не пытался выбрать «другой подходящий»
      const main = document.createElement("link");
      main.rel = "icon";
      main.type = type;
      main.href = favicon;
      main.setAttribute("data-custom-favicon", "1");
      document.head.appendChild(main);

      // apple-touch-icon — отдельной иконкой, чтобы home-screen на iOS тоже взял пользовательский favicon
      const apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      apple.href = favicon;
      apple.setAttribute("data-custom-favicon", "1");
      document.head.appendChild(apple);
    } else {
      // Сбросили favicon в админке — возвращаем дефолтные если их вдруг убрали custom-логикой раньше
      existingCustom.forEach((el) => el.remove());
      if (document.querySelectorAll('link[rel="icon"]').length === 0) {
        const def = document.createElement("link");
        def.rel = "icon";
        def.type = "image/svg+xml";
        def.href = "/favicon.svg";
        document.head.appendChild(def);
      }
    }

    // Манифест: при custom favicon переключаем на динамический эндпоинт.
    // Когда favicon пустой — оставляем статический манифест (дефолтное брендирование).
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const dynamicManifestUrl = "/api/public/manifest.webmanifest";
    const staticManifestUrl = "/manifest.webmanifest";
    const wantUrl = favicon ? dynamicManifestUrl : staticManifestUrl;
    if (manifestLink && manifestLink.getAttribute("href") !== wantUrl) {
      manifestLink.href = wantUrl;
    } else if (!manifestLink) {
      const ml = document.createElement("link");
      ml.rel = "manifest";
      ml.href = wantUrl;
      document.head.appendChild(ml);
    }
  }, [location.pathname, config]);

  return null;
}

export default function App() {

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={routerFutureFlags}>
        <ThemeProvider>
          <AuthProvider>
            <AdminDialogHost />
            <AnimatedBackground />
            <TitleAndThemeSync  />
            <AppRoutes />
            <PwaUpdatePrompt />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
