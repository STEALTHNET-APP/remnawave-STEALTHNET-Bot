import { CloudPaymentsSubscriptions } from "@/components/cabinet/cloudpayments-subscriptions";
import { PasswordHint } from "@/components/password-hint";
import { useEffect, useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { User, Wallet, Copy, Check, CreditCard, Loader2, Shield, KeyRound, Monitor, Trash2, Zap } from "lucide-react";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthProfile } from "@/pages/cabinet/stealth/stealth-profile";
import { AuroraProfile } from "@/pages/cabinet/aurora/aurora-profile";
import { QRCodeSVG } from "qrcode.react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { PayNowPanel } from "@/components/payment/pay-now-panel";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { ClientPayment } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPublicConfigCached } from "@/lib/public-config";
function formatDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("ru-RU");
  } catch {
    return s;
  }
}

import { formatCabinetMoney as formatMoney } from "@/lib/cabinet-format";

function formatPaymentStatus(status: string, t: (key: string) => string): string {
  const s = (status || "").toLowerCase();
  if (s === "paid") return t("cabinet.profile.payment_paid");
  if (s === "pending") return t("cabinet.profile.payment_pending");
  if (s === "failed") return t("cabinet.profile.payment_failed");
  if (s === "refunded") return t("cabinet.profile.payment_refunded");
  return status || "—";
}

export function ClientProfilePage() {
  const design = useCabinetDesign();
  const { state } = useClientAuth();
  const location = useLocation();
  if (design === "classic" && location.hash === "#topup") return <Navigate to="/cabinet/wallet" replace />;
  return <>{design === "stealth" ? <StealthProfile /> : design === "aurora" ? <AuroraProfile /> : <ClassicProfilePage accountOnly />}{state.token && <CloudPaymentsSubscriptions token={state.token}/>}</>;
}

export function ClassicProfilePage({ aurora = false, topupOnly = false, accountOnly = false }: { aurora?: boolean; topupOnly?: boolean; accountOnly?: boolean }) {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const [payments, setPayments] = useState<ClientPayment[]>([]);
  const [plategaMethods, setPlategaMethods] = useState<{ id: number; label: string }[]>([]);
  const [yoomoneyEnabled, setYoomoneyEnabled] = useState(false);
  const [yookassaEnabled, setYookassaEnabled] = useState(false);
  const [telegramStarsEnabled, setTelegramStarsEnabled] = useState(false);
  const [cryptopayEnabled, setCryptopayEnabled] = useState(false);
  const [heleketEnabled, setHeleketEnabled] = useState(false);
  const [rollypayEnabled, setRollypayEnabled] = useState(false);
  const [paritypayEnabled, setParitypayEnabled] = useState(false);
  const [cloudpaymentsEnabled, setCloudpaymentsEnabled] = useState(false);
  const [lavaEnabled, setLavaEnabled] = useState(false);
  // Lava.top removed from balance top-up — оставлен только для тарифов (см. client-tariffs.tsx)
  const [overpayEnabled, setOverpayEnabled] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [paymentProviders, setPaymentProviders] = useState<{ id: string; label: string; sortOrder: number }[]>([]);
  const [publicAppUrl, setPublicAppUrl] = useState<string | null>(null);
  const [yookassaRecurringEnabled, setYookassaRecurringEnabled] = useState(false);
  const [unlinkingPayment, setUnlinkingPayment] = useState(false);
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpModalOpen, setTopUpModalOpen] = useState(false);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (location.hash === "#devices") document.getElementById("devices")?.scrollIntoView({ block: "start" });
  }, [location.hash, state.client]);
  const [readyUrl, setReadyUrl] = useState<{ url: string; provider: string; paymentId?: string } | null>(null);
  const [linkTelegramCode, setLinkTelegramCode] = useState<string | null>(null);
  const [linkTelegramLoading, setLinkTelegramLoading] = useState(false);
  const [linkTelegramError, setLinkTelegramError] = useState<string | null>(null);
  const [linkEmailValue, setLinkEmailValue] = useState("");
  const [linkEmailLoading, setLinkEmailLoading] = useState(false);
  const [linkEmailSent, setLinkEmailSent] = useState(false);
  const [linkEmailError, setLinkEmailError] = useState<string | null>(null);
  const [paymentsHistoryOpen, setPaymentsHistoryOpen] = useState(false);
  const [devices, setDevices] = useState<import("@/lib/api").ClientDeviceItem[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [deletingHwid, setDeletingHwid] = useState<string | null>(null);
  const [twoFaEnableOpen, setTwoFaEnableOpen] = useState(false);
  const [twoFaDisableOpen, setTwoFaDisableOpen] = useState(false);
  const [twoFaSetupData, setTwoFaSetupData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [twoFaStep, setTwoFaStep] = useState<1 | 2>(1);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false);
  // Установка пароля (для юзеров без пароля — зарегистрировались через Telegram/Google/Apple).
  const [setPasswordOpen, setSetPasswordOpen] = useState(false);
  const [setPasswordNew, setSetPasswordNew] = useState("");
  const [setPasswordConfirm, setSetPasswordConfirm] = useState("");
  const [setPasswordLoading, setSetPasswordLoading] = useState(false);
  const [setPasswordError, setSetPasswordError] = useState<string | null>(null);
  const [setPasswordSuccess, setSetPasswordSuccess] = useState(false);

  const client = state.client;
  const token = state.token;
  const currency = (client?.preferredCurrency ?? "usd").toLowerCase();

  useEffect(() => {
    if (token) {
      refreshProfile().catch(() => { });
    }
  }, [token, refreshProfile]);

  useEffect(() => {
    if (token && !topupOnly && !accountOnly) {
      api.clientPayments(token).then((r) => setPayments(r.items ?? [])).catch(() => { });
    }
  }, [token]);

  // T-devices-multi (27.05.2026, WolfVPN): грузим устройства ВСЕХ подписок (root + secondary).
  // Бэк уже исключает дубли (root vs Subscription с тем же remnawaveUuid).
  useEffect(() => {
    if (!token || topupOnly) return;
    setDevicesLoading(true);
    setDevicesError(null);
    api.getMyAllDevices(token)
      .then((r) => setDevices(r.items ?? []))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Подписка не привязана")) {
          setDevicesError("NO_SUBSCRIPTION");
        } else {
          setDevicesError(t("cabinet.profile.devices_error_load"));
        }
        setDevices([]);
      })
      .finally(() => setDevicesLoading(false));
  }, [token]);

  async function deleteDevice(hwid: string, subscriptionType: "root" | "secondary", subscriptionId: string) {
    if (!token) return;
    setDeletingHwid(hwid);
    try {
      await api.deleteClientDevice(token, hwid, { type: subscriptionType, id: subscriptionId });
      // Удаляем именно ту запись (hwid может встречаться в разных подписках теоретически).
      setDevices((prev) => prev.filter((d) => !(d.hwid === hwid && d.subscriptionId === subscriptionId)));
    } catch {
      setDevicesError(t("cabinet.profile.devices_error_disconnect"));
    } finally {
      setDeletingHwid(null);
    }
  }

  async function openTwoFaEnable() {
    if (!token) return;
    setTwoFaError(null);
    setTwoFaSetupData(null);
    setTwoFaStep(1);
    setTwoFaCode("");
    setTwoFaEnableOpen(true);
    setTwoFaLoading(true);
    try {
      const data = await api.client2FASetup(token);
      setTwoFaSetupData(data);
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : t("cabinet.profile.2fa_error_setup"));
    } finally {
      setTwoFaLoading(false);
    }
  }
  function closeTwoFaEnable() {
    setTwoFaEnableOpen(false);
    setTwoFaSetupData(null);
    setTwoFaStep(1);
    setTwoFaCode("");
    setTwoFaError(null);
  }
  async function confirmTwoFaEnable() {
    if (!token || !twoFaCode.trim() || twoFaCode.length !== 6) {
      setTwoFaError(t("cabinet.profile.2fa_error_enter_code"));
      return;
    }
    setTwoFaError(null);
    setTwoFaLoading(true);
    try {
      await api.client2FAConfirm(token, twoFaCode.trim());
      refreshProfile();
      closeTwoFaEnable();
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : t("cabinet.profile.2fa_error_invalid"));
    } finally {
      setTwoFaLoading(false);
    }
  }
  async function openTwoFaDisable() {
    setTwoFaDisableOpen(true);
    setTwoFaCode("");
    setTwoFaError(null);
  }
  async function confirmTwoFaDisable() {
    if (!token || !twoFaCode.trim() || twoFaCode.length !== 6) {
      setTwoFaError(t("cabinet.profile.2fa_error_enter_code"));
      return;
    }
    setTwoFaError(null);
    setTwoFaLoading(true);
    try {
      await api.client2FADisable(token, twoFaCode.trim());
      refreshProfile();
      setTwoFaDisableOpen(false);
      setTwoFaCode("");
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : t("cabinet.profile.2fa_error_invalid"));
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function submitChangePassword() {
    if (!token) return;
    if (!currentPassword.trim()) {
      setChangePasswordError(t("cabinet.profile.change_password_error_current"));
      return;
    }
    if (newPassword.length < 6) {
      setChangePasswordError(t("cabinet.profile.change_password_error_min"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError(t("cabinet.profile.change_password_error_mismatch"));
      return;
    }
    setChangePasswordError(null);
    setChangePasswordLoading(true);
    try {
      await api.clientChangePassword(token, {
        currentPassword: currentPassword,
        newPassword: newPassword,
      });
      setChangePasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setChangePasswordOpen(false);
        setChangePasswordSuccess(false);
      }, 2000);
    } catch (e) {
      setChangePasswordError(e instanceof Error ? e.message : t("cabinet.profile.change_password_error"));
    } finally {
      setChangePasswordLoading(false);
    }
  }

  function closeChangePassword() {
    setChangePasswordOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setChangePasswordError(null);
    setChangePasswordSuccess(false);
  }

  async function submitSetPassword() {
    if (!token) return;
    if (setPasswordNew.length < 6) {
      setSetPasswordError(t("cabinet.profile.change_password_error_min"));
      return;
    }
    if (setPasswordNew !== setPasswordConfirm) {
      setSetPasswordError(t("cabinet.profile.change_password_error_mismatch"));
      return;
    }
    setSetPasswordError(null);
    setSetPasswordLoading(true);
    try {
      await api.clientSetPassword(token, { newPassword: setPasswordNew });
      setSetPasswordSuccess(true);
      await refreshProfile().catch(() => {});
      setTimeout(() => {
        setSetPasswordOpen(false);
        setSetPasswordSuccess(false);
        setSetPasswordNew("");
        setSetPasswordConfirm("");
      }, 1500);
    } catch (e) {
      setSetPasswordError(e instanceof Error ? e.message : t("cabinet.profile.change_password_error"));
    } finally {
      setSetPasswordLoading(false);
    }
  }

  function closeSetPassword() {
    setSetPasswordOpen(false);
    setSetPasswordNew("");
    setSetPasswordConfirm("");
    setSetPasswordError(null);
    setSetPasswordSuccess(false);
  }

  useEffect(() => {
    let active = true;
    setConfigLoading(true);
    setConfigError(false);
    getPublicConfigCached().then((c) => {
      if (!active) return;
      setPlategaMethods(c.plategaMethods ?? []);
      setYoomoneyEnabled(Boolean(c.yoomoneyEnabled));
      setYookassaEnabled(Boolean(c.yookassaEnabled));
      setCryptopayEnabled(Boolean(c.cryptopayEnabled));
      setTelegramStarsEnabled(Boolean(c.telegramStarsEnabled));
      setHeleketEnabled(Boolean(c.heleketEnabled));
      setRollypayEnabled(Boolean(c.rollypayEnabled));
      setParitypayEnabled(Boolean(c.paritypayEnabled));
      setCloudpaymentsEnabled(Boolean(c.cloudpaymentsEnabled));
      setLavaEnabled(Boolean(c.lavaEnabled));
      setOverpayEnabled(Boolean(c.overpayEnabled));
      setPaymentProviders(c.paymentProviders ?? []);
      setPublicAppUrl(c.publicAppUrl ?? null);
      setTelegramBotUsername(c.telegramBotUsername ?? null);
      setYookassaRecurringEnabled(Boolean(c.yookassaRecurringEnabled));
    }).catch(() => { if (active) setConfigError(true); }).finally(() => { if (active) setConfigLoading(false); });
    return () => { active = false; };
  }, [configAttempt]);

  useEffect(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (params.get("yoomoney") === "connected" || params.get("yoomoney_form") === "success" || params.get("yookassa") === "success" || params.get("heleket") === "success" || params.get("rollypay") === "success" || params.get("paritypay") === "success") {
      refreshProfile().catch(() => { });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshProfile]);

  async function startTopUp(methodId: number) {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.clientCreatePlategaPayment(token, {
        amount,
        currency,
        paymentMethod: methodId,
        description: t("cabinet.profile.top_up_description"),
      });
      if (res.paymentUrl) setReadyUrl({ url: res.paymentUrl, provider: "Platega", paymentId: res.paymentId });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpYoomoneyForm(paymentType: "PC" | "AC") {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount_rub"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.yoomoneyCreateFormPayment(token, { amount, paymentType });
      if (res.paymentUrl) {
        setReadyUrl({ url: res.paymentUrl, provider: "ЮMoney", paymentId: res.paymentId });
      } else if (res.form) {
        const f = res.form;
        const yoomoneyUrl = `https://yoomoney.ru/quickpay/confirm.xml?quickpay-form=shop&receiver=${encodeURIComponent(f.receiver)}&sum=${f.sum}&label=${encodeURIComponent(f.label)}&paymentType=${f.paymentType}&successURL=${encodeURIComponent(f.successURL)}`;
        setReadyUrl({ url: yoomoneyUrl, provider: "ЮMoney" });
      }
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpYookassa() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount_rub"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.yookassaCreatePayment(token, { amount, currency: "RUB" });
      if (res.confirmationUrl) setReadyUrl({ url: res.confirmationUrl, provider: "ЮKassa", paymentId: res.paymentId });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpCryptopay(stars = false) {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await (stars ? api.starsCreatePayment : api.cryptopayCreatePayment)(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: stars ? "Telegram Stars" : "Crypto Bot", paymentId: res.paymentId });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpHeleket() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.heleketCreatePayment(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Heleket", paymentId: res.paymentId });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpRollypay() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.rollypayCreatePayment(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "RollyPay", paymentId: res.paymentId });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }
async function startTopUpParitypay() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.paritypayCreatePayment(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "ParityPay", paymentId: res.paymentId });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }
async function startTopUpCloudpayments() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.cloudpaymentsCreatePayment(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "CloudPayments", paymentId: res.paymentId });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpLava() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.lavaCreatePayment(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "LAVA", paymentId: res.paymentId });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  // Lava.top — только subscription для тарифов, не для top-up. Кнопка отсутствует, функция оставлена закомменченной для возможного будущего использования.
  // async function startTopUpLavatop() { ... }

  async function startTopUpOverpay() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.overpayCreatePayment(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Overpay", paymentId: res.paymentId });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function requestLinkTelegramCode() {
    if (!token) return;
    setLinkTelegramLoading(true);
    setLinkTelegramCode(null);
    setLinkTelegramError(null);
    try {
      const res = await api.clientLinkTelegramRequest(token);
      setLinkTelegramCode(res.code);
    } catch (err) {
      setLinkTelegramCode(null);
      setLinkTelegramError(err instanceof Error ? err.message : t("cabinet.profile.link_telegram_code_error"));
    } finally {
      setLinkTelegramLoading(false);
    }
  }

  async function linkTelegramFromMiniapp() {
    if (!token) return;
    const initData = (window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData;
    if (!initData?.trim()) return;
    setLinkTelegramLoading(true);
    setLinkTelegramError(null);
    try {
      const res = await api.clientLinkTelegram(token, { initData });
      if (res.client) {
        refreshProfile();
        setLinkTelegramCode(null);
      }
    } catch (err) {
      setLinkTelegramError(err instanceof Error ? err.message : t("cabinet.profile.link_telegram_error"));
    } finally {
      setLinkTelegramLoading(false);
    }
  }

  async function sendLinkEmailRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !linkEmailValue.trim()) return;
    setLinkEmailError(null);
    setLinkEmailSent(false);
    setLinkEmailLoading(true);
    try {
      await api.clientLinkEmailRequest(token, { email: linkEmailValue.trim() });
      setLinkEmailSent(true);
      setLinkEmailValue("");
    } catch (err) {
      setLinkEmailError(err instanceof Error ? err.message : t("cabinet.profile.link_email_error"));
    } finally {
      setLinkEmailLoading(false);
    }
  }

  async function handleUnlinkPaymentMethod() {
    if (!token) return;
    setUnlinkingPayment(true);
    try {
      await api.yookassaUnlinkPaymentMethod(token);
      await refreshProfile();
    } catch (err) {
      console.error("Ошибка отвязки способа оплаты:", err);
    } finally {
      setUnlinkingPayment(false);
    }
  }

  const baseUrl = publicAppUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  const referralLinkSite =
    client?.referralCode && baseUrl
      ? `${String(baseUrl).replace(/\/$/, "")}/cabinet/register?ref=${encodeURIComponent(client.referralCode)}`
      : "";
  const referralLinkBot =
    client?.referralCode && telegramBotUsername
      ? `https://t.me/${telegramBotUsername.replace(/^@/, "")}?start=ref_${client.referralCode}`
      : "";
  const hasReferralLinks = Boolean(referralLinkSite || referralLinkBot);
  const isMiniapp = useCabinetMiniapp();
  if (!client) return null;
  // Реальный miniapp (TG WebApp) — только если доступен initData
  const isTgMiniapp = isMiniapp && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData?.trim());

  const topupCard = (plategaMethods.length > 0 || yoomoneyEnabled || yookassaEnabled || telegramStarsEnabled || cryptopayEnabled || heleketEnabled || rollypayEnabled || paritypayEnabled || cloudpaymentsEnabled || lavaEnabled || overpayEnabled) && (
          <div id="topup" className="relative flex flex-col rounded-[2rem] shadow-[0_8px_40px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.3)]">
            <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl">
              <div className="absolute -top-32 -left-32 h-64 w-64 rounded-full bg-primary/20 blur-[80px] pointer-events-none" />
            </div>

            <div className="relative p-6 sm:p-8 flex flex-col h-full">
              <div className="flex items-center gap-4 mb-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner shrink-0">
                  <CreditCard className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-foreground">{t("cabinet.profile.top_up_balance")}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{t("cabinet.profile.top_up_opens_tab")}</p>
                </div>
              </div>

              <div className="space-y-6 mt-auto">
                <div className="relative flex h-32 w-full items-center justify-center rounded-3xl border border-border/50 bg-background/50 shadow-sm transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                  <Input
                    aria-label={t("cabinet.wallet.amount_label")}
                    type="number"
                    min={1}
                    step={0.01}
                    placeholder="0"
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    className="absolute inset-0 h-full w-full border-0 bg-transparent px-20 text-center text-5xl sm:text-6xl font-extrabold tracking-tighter shadow-none focus-visible:ring-0"
                    style={{ WebkitAppearance: "none", MozAppearance: "textfield" }}
                  />
                  <span className="pointer-events-none absolute right-[12%] top-1/2 -translate-y-1/2 text-2xl sm:text-3xl font-bold text-muted-foreground uppercase opacity-80">
                    {currency.toUpperCase()}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[100, 300, 500, 1000].map((n) => {
                    const isActive = topUpAmount === String(n);
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => setTopUpAmount(String(n))}
                        className={cn(
                          "flex items-center justify-center rounded-2xl py-3 text-sm font-bold transition-all duration-300",
                          isActive
                            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-105"
                            : "bg-muted/60 text-foreground hover:bg-muted hover:scale-105"
                        )}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>

                {topUpError && (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-center text-sm font-medium text-destructive">
                    {topUpError}
                  </div>
                )}

                <Button
                  className="group relative w-full overflow-hidden rounded-2xl py-7 text-lg font-bold shadow-xl transition-all duration-300 hover:scale-[1.02] hover:shadow-primary/25"
                  onClick={() => {
                    const amount = Number(topUpAmount?.replace(",", "."));
                    if (!Number.isFinite(amount) || amount < 1) {
                      setTopUpError(t("cabinet.profile.top_up_min"));
                      return;
                    }
                    setTopUpError(null);
                    setTopUpModalOpen(true);
                  }}
                >
                  <div className="absolute inset-0 bg-white/20 translate-y-full transition-transform duration-300 group-hover:translate-y-0" />
                  <span className="relative flex items-center justify-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    {t("cabinet.profile.top_up_pay")} {topUpAmount ? `${topUpAmount} ${currency.toUpperCase()}` : ""}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        );
  const topupDialog = (<Dialog
        open={topUpModalOpen}
        onOpenChange={(open) => {
          if (topUpLoading) return;
          setTopUpModalOpen(open);
          if (!open) setReadyUrl(null);
        }}
      >
        <DialogContent className="max-w-md p-6 rounded-3xl border border-border/50 bg-card/60 backdrop-blur-3xl shadow-2xl" showCloseButton={!topUpLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader className="mb-4 text-center sm:text-left">
            <DialogTitle className="text-2xl font-bold flex items-center justify-center sm:justify-start gap-2">
              <div className="p-2 bg-primary/10 rounded-xl">
                <Wallet className="h-6 w-6 text-primary" />
              </div>
              {t("cabinet.profile.payment_method")}
            </DialogTitle>
            <DialogDescription className="text-base font-medium mt-2">
              <div className="flex flex-col gap-2 mt-4 bg-background/50 p-4 rounded-2xl border border-border/50 text-left relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex justify-between items-center relative z-10">
                  <span className="text-muted-foreground">{t("cabinet.profile.top_up_to_pay")}</span>
                  <span className="font-bold text-xl text-primary">
                    {topUpAmount ? formatMoney(Number(topUpAmount.replace(",", ".")), currency.toUpperCase()) : "—"}
                  </span>
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>

          {topUpError && (
            <div className="p-3 mb-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center font-medium animate-in fade-in slide-in-from-top-2">
              {topUpError}
            </div>
          )}

          {readyUrl ? (
            <PayNowPanel
              url={readyUrl.url}
              provider={readyUrl.provider}
              onBack={() => setReadyUrl(null)}
              onPaid={() => {
                const pid = readyUrl.paymentId;
                const u = readyUrl.url, prov = readyUrl.provider;
                setTopUpModalOpen(false); setReadyUrl(null);
                if (pid) navigate(`/cabinet/payment-wait?id=${encodeURIComponent(pid)}&kind=topup`, { state: { url: u, provider: prov } });
              }}
            />
          ) : (
          <div className="flex flex-col gap-3">
            {(() => {
              const providerLabel = (id: string, fallback: string) => paymentProviders.find((p) => p.id === id)?.label || fallback;
              const btnCls = cn("w-full", isMiniapp ? "justify-start gap-4 px-6 h-16 rounded-2xl border-white/5 bg-card/40 hover:bg-card/60" : "gap-3 hover:bg-background/80 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-xl h-14 border-border/50 group justify-center px-6 relative");

              const colorMap: Record<string, { bg10: string; bg20: string; text: string }> = {
                cryptopay: { bg10: "bg-yellow-500/10", bg20: "group-hover:bg-yellow-500/20", text: "text-yellow-500" },
                heleket: { bg10: "bg-orange-500/10", bg20: "group-hover:bg-orange-500/20", text: "text-orange-500" },
                rollypay: { bg10: "bg-sky-500/10", bg20: "group-hover:bg-sky-500/20", text: "text-sky-500" },
                paritypay: { bg10: "bg-sky-500/10", bg20: "group-hover:bg-sky-500/20", text: "text-sky-500" },
                cloudpayments: { bg10: "bg-sky-500/10", bg20: "group-hover:bg-sky-500/20", text: "text-sky-500" },
                yookassa: { bg10: "bg-green-500/10", bg20: "group-hover:bg-green-500/20", text: "text-green-500" },
                yoomoney: { bg10: "bg-green-500/10", bg20: "group-hover:bg-green-500/20", text: "text-green-500" },
                lava: { bg10: "bg-sky-500/10", bg20: "group-hover:bg-sky-500/20", text: "text-sky-500" },
                overpay: { bg10: "bg-indigo-500/10", bg20: "group-hover:bg-indigo-500/20", text: "text-indigo-500" },
              };

              type ProviderEntry = { id: string; enabled: boolean; onClick: () => void; label: string; icon: "crypto" | "card" };
              const providers: ProviderEntry[] = [
                { id: "telegram_stars", enabled: Boolean(telegramStarsEnabled) && currency.toUpperCase() === "RUB", onClick: () => startTopUpCryptopay(true), label: "⭐ Telegram Stars", icon: "crypto" },
                { id: "cryptopay", enabled: cryptopayEnabled, onClick: () => startTopUpCryptopay(), label: providerLabel("cryptopay", "Crypto Bot"), icon: "crypto" },
                { id: "heleket", enabled: heleketEnabled, onClick: () => startTopUpHeleket(), label: providerLabel("heleket", "Heleket"), icon: "crypto" },
                { id: "rollypay", enabled: rollypayEnabled, onClick: () => startTopUpRollypay(), label: providerLabel("rollypay", "RollyPay"), icon: "card" },
                { id: "paritypay", enabled: paritypayEnabled, onClick: () => startTopUpParitypay(), label: providerLabel("paritypay", "ParityPay"), icon: "card" },
                { id: "cloudpayments", enabled: cloudpaymentsEnabled, onClick: () => startTopUpCloudpayments(), label: providerLabel("cloudpayments", "CloudPayments"), icon: "card" },
                { id: "yookassa", enabled: yookassaEnabled, onClick: () => startTopUpYookassa(), label: providerLabel("yookassa", t("cabinet.tariffs.sbp_cards_ru")), icon: "card" },
                { id: "yoomoney", enabled: yoomoneyEnabled, onClick: () => startTopUpYoomoneyForm("AC"), label: providerLabel("yoomoney", t("cabinet.tariffs.yoomoney_cards")), icon: "card" },
                { id: "lava", enabled: lavaEnabled && currency.toLowerCase() === "rub", onClick: () => startTopUpLava(), label: providerLabel("lava", "LAVA"), icon: "card" },
                // Lava.top — только subscription для тарифов, не для top-up баланса
                { id: "overpay", enabled: overpayEnabled, onClick: () => startTopUpOverpay(), label: providerLabel("overpay", "Overpay"), icon: "card" },
              ];

              const sortedProviders = paymentProviders.length > 0
                ? paymentProviders.map((pp) => providers.find((p) => p.id === pp.id)).filter((p): p is ProviderEntry => !!p)
                : providers;

              return (
                <>
                  {sortedProviders.filter((p) => p.enabled).map((p) => {
                    const c = colorMap[p.id] ?? colorMap.yookassa;
                    return (
                    <Button key={p.id} size="lg" variant="outline" onClick={p.onClick} disabled={topUpLoading} className={btnCls}>
                      {isMiniapp ? (
                        <>
                          <div className={cn("p-2 rounded-xl", c.bg10)}>
                            {topUpLoading ? <Loader2 className={cn("h-6 w-6 animate-spin", c.text)} /> : p.icon === "crypto" ? <Zap className={cn("h-6 w-6", c.text)} /> : <CreditCard className={cn("h-6 w-6", c.text)} />}
                          </div>
                          <span className="text-base font-bold">{p.label}</span>
                        </>
                      ) : (
                        <>
                          <div className={cn("absolute left-6 p-1.5 rounded-lg transition-colors", c.bg10, c.bg20)}>
                            {topUpLoading ? <Loader2 className={cn("h-5 w-5 animate-spin", c.text)} /> : p.icon === "crypto" ? <Zap className={cn("h-5 w-5", c.text)} /> : <CreditCard className={cn("h-5 w-5", c.text)} />}
                          </div>
                          <span className="text-base font-medium">{p.label}</span>
                        </>
                      )}
                    </Button>
                    );
                  })}
                  {plategaMethods.map((m) => (
                    <Button key={m.id} size="lg" variant="outline" onClick={() => startTopUp(m.id)} disabled={topUpLoading} className={btnCls}>
                      {isMiniapp ? (
                        <>
                          <div className="p-2 rounded-xl bg-green-500/10">
                            {topUpLoading ? <Loader2 className="h-6 w-6 animate-spin text-green-500" /> : <CreditCard className="h-6 w-6 text-green-500" />}
                          </div>
                          <span className="text-base font-bold">{m.label}</span>
                        </>
                      ) : (
                        <>
                          <div className="absolute left-6 p-1.5 rounded-lg bg-green-500/10 group-hover:bg-green-500/20 transition-colors">
                            {topUpLoading ? <Loader2 className="h-5 w-5 animate-spin text-green-500" /> : <CreditCard className="h-5 w-5 text-green-500" />}
                          </div>
                          <span className="text-base font-medium">{m.label}</span>
                        </>
                      )}
                    </Button>
                  ))}
                </>
              );
            })()}
          </div>
          )}
          {!readyUrl && (
          <DialogFooter className="mt-4 sm:justify-center border-t border-border/50 pt-4">
            <Button variant="ghost" onClick={() => setTopUpModalOpen(false)} disabled={topUpLoading} className="rounded-xl hover:bg-background/50 hover:text-foreground text-muted-foreground transition-colors">
              {t("cabinet.profile.cancel")}
            </Button>
          </DialogFooter>
          )}
        </DialogContent>
      </Dialog>);
  if (topupOnly) return <div className="space-y-4">{configLoading ? <p role="status" className="cabinet-surface cabinet-empty">{t("cabinet.wallet.methods_loading")}</p> : configError ? <div role="alert" className="cabinet-surface cabinet-empty"><p>{t("cabinet.wallet.methods_error")}</p><Button variant="outline" onClick={() => setConfigAttempt(value => value + 1)}>{t("cabinet.wallet.retry")}</Button></div> : topupCard || <p className="cabinet-surface">{t("cabinet.wallet.methods_unavailable")}</p>}{topupDialog}</div>;

  return (
    <div className="cabinet-profile space-y-6 w-full min-w-0 pb-10">
      {aurora ? <div className="au-profile">
        <div className="au-profile-title"><div className="au-avatar"><User size={26}/></div><div><h1>Мой профиль</h1><p>{client.telegramUsername ? `@${client.telegramUsername}` : client.email || "Личный кабинет"}</p></div></div>
        <section id="topup" className="au-balance-card" aria-label="Баланс">
          <div className="au-balance-heading"><Wallet size={21}/><span>Мой баланс</span></div>
          <strong className="au-balance-amount">{formatMoney(client.balance, client.preferredCurrency)}</strong>
          <label className="au-amount-label" htmlFor="au-topup">Сумма пополнения, {currency.toUpperCase()}</label>
          <input id="au-topup" type="number" inputMode="decimal" min="1" step="0.01" placeholder="Введите сумму" value={topUpAmount} onChange={e=>setTopUpAmount(e.target.value)}/>
          <div className="au-amount-presets">{[100,300,500,1000].map(n=><button key={n} aria-pressed={topUpAmount===String(n)} onClick={()=>setTopUpAmount(String(n))}>{n}</button>)}</div>
          <button className="au-balance-pay" onClick={()=>{const amount=Number(topUpAmount.replace(",","."));if(!Number.isFinite(amount)||amount<1){setTopUpError(t("cabinet.profile.top_up_min"));return;}setTopUpError(null);setTopUpModalOpen(true);}} disabled={!(plategaMethods.length || yoomoneyEnabled || yookassaEnabled || telegramStarsEnabled || cryptopayEnabled || heleketEnabled || rollypayEnabled || paritypayEnabled || cloudpaymentsEnabled || lavaEnabled || overpayEnabled)}><CreditCard size={18}/>Пополнить баланс</button>
          {topUpError&&<p role="alert">{topUpError}</p>}
          {!(plategaMethods.length || yoomoneyEnabled || yookassaEnabled || telegramStarsEnabled || cryptopayEnabled || heleketEnabled || rollypayEnabled || paritypayEnabled || cloudpaymentsEnabled || lavaEnabled || overpayEnabled)&&<p>Пополнение сейчас недоступно</p>}
        </section>
        <button className="au-profile-action" onClick={()=>setPaymentsHistoryOpen(true)}><Wallet size={20}/><span>История операций<small>{payments.length ? `${payments.length} операций` : "Платежей пока нет"}</small></span><span aria-hidden="true">→</span></button>
        <section className="au-profile-section"><h2>Мои устройства <span>{devices.length}</span></h2>
          {devicesLoading ? <p>Загружаем устройства…</p> : devicesError && devicesError!=="NO_SUBSCRIPTION" ? <p role="alert">{devicesError}</p> : !devices.length ? <div className="au-empty"><Monitor size={26}/><p>{t("cabinet.profile.no_devices_title")}</p><small>{t(devicesError==="NO_SUBSCRIPTION"?"cabinet.profile.devices_no_sub_hint":"cabinet.profile.devices_empty_hint")}</small></div> : devices.map(d=><div className="au-device" key={`${d.subscriptionId}:${d.hwid}`}><Monitor size={22}/><div><strong>{[d.platform,d.deviceModel].filter(Boolean).join(" · ") || d.hwid.slice(0,12)}</strong><small>{d.tariffName || `Подписка #${d.subscriptionIndex}`}{d.appName?` · ${d.appName}`:""}</small></div><button aria-label={`Отключить ${d.deviceModel || d.platform || "устройство"}`} disabled={deletingHwid===d.hwid} onClick={()=>deleteDevice(d.hwid,d.subscriptionType,d.subscriptionId)}>{deletingHwid===d.hwid?<Loader2 size={18} className="animate-spin"/>:<Trash2 size={18}/>}</button></div>)}
        </section>
        <section className="au-profile-section"><h2>Аккаунт</h2><dl className="au-account-data"><div><dt>ID</dt><dd>{client.id}</dd></div><div><dt>Email</dt><dd>{client.email || "Не привязан"}</dd></div><div><dt>Telegram</dt><dd>{client.telegramUsername?`@${client.telegramUsername}`:client.telegramId || "Не привязан"}</dd></div>{client.createdAt&&<div><dt>Регистрация</dt><dd>{new Date(client.createdAt).toLocaleDateString("ru-RU")}</dd></div>}</dl>
          {!client.email&&<form className="au-link-form" onSubmit={sendLinkEmailRequest}><label htmlFor="au-email">Привязать email</label><Input id="au-email" type="email" placeholder="email@example.com" value={linkEmailValue} onChange={e=>setLinkEmailValue(e.target.value)} disabled={linkEmailLoading}/><button disabled={linkEmailLoading||!linkEmailValue.trim()}>{linkEmailLoading?"Отправляем…":"Отправить ссылку"}</button>{linkEmailSent&&<p role="status">{t("cabinet.profile.link_email_sent")}</p>}{linkEmailError&&<p role="alert">{linkEmailError}</p>}</form>}
          {!client.telegramId&&<div className="au-link-form"><button disabled={linkTelegramLoading||!!linkTelegramCode} onClick={isTgMiniapp?linkTelegramFromMiniapp:requestLinkTelegramCode}>{linkTelegramLoading?"Подключаем…":"Привязать Telegram"}</button>{linkTelegramCode&&<><p>Код: <strong>{linkTelegramCode}</strong></p>{telegramBotUsername&&<a href={`https://t.me/${telegramBotUsername.replace(/^@/,"")}?start=link_${linkTelegramCode}`} target="_blank" rel="noopener noreferrer">Открыть бота</a>}<p>{t("cabinet.profile.link_code_expires")}</p></>}{linkTelegramError&&<p role="alert">{linkTelegramError}</p>}</div>}
        </section>
        <section className="au-profile-section"><h2>Безопасность</h2><button className="au-profile-action" onClick={client.totpEnabled?openTwoFaDisable:openTwoFaEnable}><Shield size={20}/><span>Двухэтапная защита<small>{client.totpEnabled?"Включена · отключить":"Отключена · включить"}</small></span><span aria-hidden="true">→</span></button><button className="au-profile-action" onClick={()=>client.hasPassword===false&&client.email?setSetPasswordOpen(true):setChangePasswordOpen(true)}><KeyRound size={20}/><span>{client.hasPassword===false&&client.email?"Установить пароль":"Изменить пароль"}</span><span aria-hidden="true">→</span></button>{yookassaRecurringEnabled&&client.yookassaPaymentMethodTitle&&<button className="au-profile-action" disabled={unlinkingPayment} onClick={handleUnlinkPaymentMethod}><CreditCard size={20}/><span>Отвязать способ оплаты<small>{client.yookassaPaymentMethodTitle}</small></span></button>}</section>
      </div> : <>
      <header className="cabinet-page-heading"><h1>{t("cabinet.profile.title")}</h1><p>{t("cabinet.profile.subtitle")}</p></header>
      <section className="cabinet-settings-section" data-tour="profile-settings">
        <header><h2>{t("cabinet.profile.data_heading")}</h2><p>{t("cabinet.profile.contact_info")}</p></header>
        <div className="cabinet-settings-rows">
          <div className="cabinet-setting-row"><div><span>{t("cabinet.profile.account_id")}</span><p className="font-mono">{client.id}</p></div></div>
          <div className="cabinet-setting-row"><div><span>Email</span><p>{client.email || t("cabinet.profile.email_not_linked")}</p></div>
            {!client.email && <form onSubmit={sendLinkEmailRequest} className="cabinet-inline-form"><Input aria-label="Email" type="email" placeholder="email@example.com" value={linkEmailValue} onChange={e => setLinkEmailValue(e.target.value)} disabled={linkEmailLoading} /><Button type="submit" variant="outline" disabled={linkEmailLoading || !linkEmailValue.trim()}>{t("cabinet.profile.link_email")}</Button></form>}
          </div>
          {linkEmailSent && <p role="status">{t("cabinet.profile.link_email_sent")}</p>}{linkEmailError && <p role="alert">{linkEmailError}</p>}
          <div className="cabinet-setting-row"><div><span>Telegram</span><p>{client.telegramUsername ? `@${client.telegramUsername}` : client.telegramId || t("cabinet.profile.telegram_not_linked")}</p></div>
            {!client.telegramId && <Button variant="outline" disabled={linkTelegramLoading || !!linkTelegramCode} onClick={isTgMiniapp ? linkTelegramFromMiniapp : requestLinkTelegramCode}>{linkTelegramLoading ? <Loader2 size={16} className="animate-spin" /> : t(isTgMiniapp ? "cabinet.profile.link_current" : "cabinet.profile.get_code")}</Button>}
          </div>
          {linkTelegramCode && <div className="cabinet-setting-detail"><p>{t("cabinet.profile.link_code")}: <strong className="font-mono">{linkTelegramCode}</strong></p>{telegramBotUsername && <a className="cabinet-text-link" href={`https://t.me/${telegramBotUsername.replace(/^@/, "")}?start=link_${linkTelegramCode}`} target="_blank" rel="noopener noreferrer">{t("cabinet.profile.link_open_bot")}</a>}<p>{t("cabinet.profile.link_code_hint")} <code>/link {linkTelegramCode}</code></p><p>{t("cabinet.profile.link_code_expires")}</p></div>}
          {linkTelegramError && <p role="alert">{linkTelegramError}</p>}
          {client.createdAt && <div className="cabinet-setting-row"><div><span>{t("cabinet.profile.registration_date")}</span><p>{new Date(client.createdAt).toLocaleDateString(i18n.language, {day:"numeric",month:"long",year:"numeric"})}</p></div></div>}
          <div className="cabinet-setting-row"><div><span>{t("cabinet.profile.balance_label")}</span><p>{formatMoney(client.balance, client.preferredCurrency)}</p></div><Button variant="outline" onClick={() => accountOnly ? navigate("/cabinet/wallet") : document.getElementById("topup")?.scrollIntoView({behavior:"smooth"})}>{t("cabinet.profile.top_up")}</Button></div>
          {hasReferralLinks && !accountOnly && <div className="cabinet-setting-row"><div><span>{t("cabinet.profile.referral_program")}</span><p>{t("cabinet.profile.referral_invite_hint")}</p></div><Button variant="outline" onClick={()=>navigate("/cabinet/referral")}>{t("cabinet.journey.referral_details")}</Button></div>}
        </div>
      </section>
      <section className="cabinet-settings-section" data-tour="password-change">
        <header><h2>{t("cabinet.profile.security_heading")}</h2><p>{t("cabinet.profile.security_subtitle")}</p></header>
        <div className="cabinet-settings-rows">
          <div className="cabinet-setting-row"><div><span>{t("cabinet.profile.2fa_label")}</span><p>{t(client.totpEnabled ? "cabinet.profile.2fa_enabled" : "cabinet.profile.2fa_multi_level")}</p></div><Button variant="outline" onClick={client.totpEnabled ? openTwoFaDisable : openTwoFaEnable}>{t(client.totpEnabled ? "cabinet.profile.2fa_disable" : "cabinet.profile.2fa_enable")}</Button></div>
          <div className="cabinet-setting-row"><div><span>{t("cabinet.profile.password_label")}</span><p>{t(client.hasPassword === false ? "cabinet.profile.password_not_set" : "cabinet.profile.password_change_account")}</p></div><Button variant="outline" onClick={()=>client.hasPassword === false && client.email ? setSetPasswordOpen(true) : setChangePasswordOpen(true)}>{t(client.hasPassword === false && client.email ? "cabinet.profile.password_set" : "cabinet.profile.password_change")}</Button></div>
          {yookassaRecurringEnabled && client.yookassaPaymentMethodTitle && <div className="cabinet-setting-row"><div><span>{t("cabinet.profile.payment_method")}</span><p>{client.yookassaPaymentMethodTitle}</p></div><Button variant="outline" disabled={unlinkingPayment} onClick={handleUnlinkPaymentMethod}>{unlinkingPayment ? <Loader2 size={16} className="animate-spin" /> : t("cabinet.profile.unlink")}</Button></div>}
        </div>
      </section>
      <section className="cabinet-settings-section" id="devices">
        <header><h2>{t("cabinet.workspace.vpn_devices")}</h2><p>{t("cabinet.workspace.vpn_devices_hint")}</p></header>
        <div className="cabinet-settings-rows">
          {devicesLoading ? <Loader2 aria-label={t("cabinet.redesign.loading_subscription")} className="animate-spin" size={20} /> : devicesError && devicesError !== "NO_SUBSCRIPTION" ? <div role="alert"><p>{devicesError}</p><p>{t("cabinet.profile.devices_error_hint")}</p></div> : !devices.length ? <div className="cabinet-setting-empty"><p>{t("cabinet.profile.no_devices_title")}</p><small>{t(devicesError === "NO_SUBSCRIPTION" ? "cabinet.profile.devices_no_sub_hint" : "cabinet.profile.devices_empty_hint")}</small></div> : <>
            <p className="text-sm text-muted-foreground">{t("cabinet.profile.devices_disconnect_hint")}</p>
            {devices.map(d => <div className="cabinet-setting-row" key={`${d.subscriptionId}:${d.hwid}`}><div><span>{d.tariffName || t("cabinet.redesign.numbered_subscription", {number:d.subscriptionIndex + 1})}</span><p>{[d.platform,d.deviceModel].filter(Boolean).join(" / ") || d.hwid.slice(0,12)}</p><small>{d.appName}{d.appName && " / "}{d.hwid.slice(0,16)}</small></div><Button variant="outline" disabled={deletingHwid === d.hwid} onClick={()=>deleteDevice(d.hwid,d.subscriptionType,d.subscriptionId)}>{deletingHwid === d.hwid ? <Loader2 size={16} className="animate-spin" /> : t("cabinet.profile.device_disconnect")}</Button></div>)}
          </>}
        </div>
      </section>

      {!accountOnly && (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className={`grid gap-6 ${isMiniapp ? "grid-cols-1" : "lg:grid-cols-2"} min-w-0`}
      >
        {topupCard}

        <div className="relative flex flex-col rounded-[2rem] shadow-[0_8px_40px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.3)] min-h-[400px]">
          <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl">
            <div className="absolute -bottom-32 -right-32 h-64 w-64 rounded-full bg-primary/10 blur-[80px] pointer-events-none" />
          </div>

          <div className="relative p-6 sm:p-8 flex flex-col h-full min-w-0">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-4 min-w-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner shrink-0">
                  <Wallet className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-bold tracking-tight text-foreground truncate">{t("cabinet.profile.payments_history")}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5 truncate">{t("cabinet.profile.payments_last3")}</p>
                </div>
              </div>
              {payments.length > 3 && (
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setPaymentsHistoryOpen(true)}>
                  {t("cabinet.profile.payments_all")} ({payments.length})
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar min-w-0 -mx-2 px-2">
              {payments.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center opacity-70">
                  <Wallet className="mb-3 h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">{t("cabinet.profile.no_payments")}</p>
                </div>
              ) : (
                <ul className="space-y-3 min-w-0">
                  {payments.slice(0, 3).map((p) => (
                    <li
                      key={p.id}
                      className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/5 hover:bg-white/10 dark:bg-black/10 dark:hover:bg-black/20 p-4 transition-all duration-300"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background/50 text-muted-foreground shadow-sm">
                          <Check className={cn("h-4 w-4", p.status?.toLowerCase() === "paid" && "text-green-500")} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate" title={p.orderId}>{p.orderId}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(p.paidAt ?? p.createdAt)}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-center shrink-0">
                        <span className="font-bold tracking-tight">{formatMoney(p.amount, p.currency)}</span>
                        <span className={cn(
                          "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
                          p.status?.toLowerCase() === "paid" ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
                        )}>
                          {formatPaymentStatus(p.status, t)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </motion.div>)}

      </>}

      <Dialog open={paymentsHistoryOpen} onOpenChange={setPaymentsHistoryOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              {t("cabinet.profile.all_history")}
            </DialogTitle>
            <DialogDescription>
              {payments.length} {payments.length === 1 ? t("cabinet.profile.transactions_count_one") : payments.length < 5 ? t("cabinet.profile.transactions_count_few") : t("cabinet.profile.transactions_count_many")}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 min-h-0 -mx-1 px-1 space-y-2 py-2">
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">{t("cabinet.profile.no_payments")}</p>
            ) : (
              payments.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border bg-muted/30 p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
                      <Check className={cn("h-3.5 w-3.5", p.status?.toLowerCase() === "paid" && "text-green-500")} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate" title={p.orderId}>{p.orderId}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(p.paidAt ?? p.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:flex-col sm:items-end gap-1 shrink-0">
                    <span className="font-semibold text-sm">{formatMoney(p.amount, p.currency)}</span>
                    <span className={cn(
                      "text-[10px] font-medium uppercase px-2 py-0.5 rounded-full",
                      p.status?.toLowerCase() === "paid" ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"
                    )}>
                      {formatPaymentStatus(p.status, t)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentsHistoryOpen(false)}>
              {t("cabinet.profile.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {topupDialog}

      <Dialog open={twoFaEnableOpen} onOpenChange={(open) => !open && closeTwoFaEnable()}>
        <DialogContent className="cabinet-account-dialog sm:max-w-md p-0 overflow-hidden border-border/50 backdrop-blur-3xl" showCloseButton={!twoFaLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary mb-6 shadow-inner border border-primary/20">
              <KeyRound className="h-8 w-8" />
            </div>
            <DialogHeader className="p-0 flex flex-col items-center mb-6">
              <DialogTitle className="text-2xl font-bold tracking-tight">
                {twoFaStep === 1 ? t("cabinet.profile.2fa_setup_title") : t("cabinet.profile.2fa_setup_confirm")}
              </DialogTitle>
              <DialogDescription className="text-center text-sm mt-2 max-w-[280px]">
                {twoFaStep === 1
                  ? t("cabinet.profile.2fa_setup_scan_qr")
                  : t("cabinet.profile.2fa_setup_enter_code")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-6 w-full">
              {twoFaLoading && !twoFaSetupData ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-primary/60" />
                </div>
              ) : twoFaStep === 1 && twoFaSetupData ? (
                <div className="flex flex-col items-center gap-6 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="relative p-4 rounded-3xl bg-white shadow-xl ring-1 ring-black/5 dark:ring-white/10 dark:bg-white/95">
                    <QRCodeSVG value={twoFaSetupData.otpauthUrl} size={180} level="M" />
                  </div>
                  <div className="w-full space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-left pl-1">{t("cabinet.profile.2fa_manual_key")}</p>
                    <div className="flex items-center gap-2 p-1.5 pr-2 rounded-2xl bg-muted/50 border border-border/50">
                      <div className="flex-1 overflow-x-auto no-scrollbar font-mono text-xs font-bold text-foreground text-center tracking-widest pl-2 select-all whitespace-nowrap">
                        {twoFaSetupData.secret}
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl shrink-0 hover:bg-background shadow-sm" onClick={() => {
                        navigator.clipboard.writeText(twoFaSetupData.secret);
                      }}>
                        <Copy className="h-4 w-4 opacity-70 cursor-pointer" />
                      </Button>
                    </div>
                  </div>
                  <Button className="w-full h-12 rounded-2xl font-bold text-base shadow-lg shadow-primary/20" onClick={() => setTwoFaStep(2)}>
                    {t("cabinet.profile.2fa_next_enter")}
                  </Button>
                </div>
              ) : twoFaStep === 2 ? (
                <div className="flex flex-col gap-6 w-full animate-in fade-in slide-in-from-right-8 duration-300">
                  <div className="relative w-full">
                    <Input
                      placeholder="000 000"
                      maxLength={6}
                      value={twoFaCode}
                      onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ""))}
                      className="h-16 text-center text-3xl tracking-[0.3em] font-mono font-bold rounded-2xl border-primary/20 bg-primary/5 focus-visible:ring-primary/30"
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-col gap-3">
                    <Button className="w-full h-12 rounded-2xl font-bold text-base shadow-lg shadow-primary/20" onClick={confirmTwoFaEnable} disabled={twoFaLoading || twoFaCode.length !== 6}>
                      {twoFaLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                      {t("cabinet.profile.2fa_confirm_enable")}
                    </Button>
                    <Button variant="ghost" className="w-full h-10 rounded-xl text-muted-foreground" onClick={() => setTwoFaStep(1)} disabled={twoFaLoading}>
                      {t("cabinet.profile.2fa_back")}
                    </Button>
                  </div>
                </div>
              ) : null}
              {twoFaError && (
                <p className="text-sm font-medium text-destructive animate-in fade-in text-center">{twoFaError}</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={twoFaDisableOpen} onOpenChange={(open) => !open && setTwoFaDisableOpen(false)}>
        <DialogContent className="cabinet-account-dialog sm:max-w-md p-0 overflow-hidden border-border/50 backdrop-blur-3xl" showCloseButton={!twoFaLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-red-500/10 text-red-500 mb-6 shadow-inner border border-red-500/20">
              <Shield className="h-8 w-8" />
            </div>
            <DialogHeader className="p-0 flex flex-col items-center mb-6">
              <DialogTitle className="text-2xl font-bold tracking-tight">{t("cabinet.profile.2fa_disable_title")}</DialogTitle>
              <DialogDescription className="text-center text-sm mt-2 max-w-[280px]">
                {t("cabinet.profile.2fa_disable_desc")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-6 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Input
                placeholder="000 000"
                maxLength={6}
                value={twoFaCode}
                onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ""))}
                className="h-16 text-center text-3xl tracking-[0.3em] font-mono font-bold rounded-2xl border-red-500/20 bg-red-500/5 focus-visible:ring-red-500/30"
                autoFocus
              />
              <Button variant="destructive" className="w-full h-12 rounded-2xl font-bold text-base shadow-lg shadow-red-500/20" onClick={confirmTwoFaDisable} disabled={twoFaLoading || twoFaCode.length !== 6}>
                {twoFaLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                {t("cabinet.profile.2fa_disable_button")}
              </Button>
              {twoFaError && (
                <p className="text-sm font-medium text-destructive animate-in fade-in text-center">{twoFaError}</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={changePasswordOpen} onOpenChange={(open) => !open && closeChangePassword()}>
        <DialogContent className="cabinet-account-dialog sm:max-w-md p-0 overflow-hidden border-border/50 backdrop-blur-3xl" showCloseButton={!changePasswordLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary mb-6 shadow-inner border border-primary/20">
              <KeyRound className="h-8 w-8" />
            </div>
            <DialogHeader className="p-0 flex flex-col items-center mb-6">
              <DialogTitle className="text-2xl font-bold tracking-tight">{t("cabinet.profile.change_password_title")}</DialogTitle>
              <DialogDescription className="text-center text-sm mt-2 max-w-[280px]">
                {t("cabinet.profile.change_password_desc")}
              </DialogDescription>
            </DialogHeader>

            {changePasswordSuccess ? (
              <div className="flex flex-col items-center gap-4 py-6 animate-in fade-in scale-95 duration-300">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 text-green-500">
                  <Check className="h-8 w-8" />
                </div>
                <p className="text-lg font-bold text-green-500">{t("cabinet.profile.password_changed")}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-3">
                  <label htmlFor="cabinet-password-current" className="text-sm">{t("cabinet.profile.current_password")}</label>
                  <Input
                    id="cabinet-password-current"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="h-12 rounded-xl"
                    autoFocus
                  />
                  <label htmlFor="cabinet-password-new" className="text-sm">{t("cabinet.profile.new_password")}</label>
                  <Input
                    id="cabinet-password-new"
                    type="password"
                    aria-describedby="change-password-hint"
                    autoComplete="new-password"
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-12 rounded-xl"
                  />
                  <PasswordHint id="change-password-hint" minLength={6} />
                  <label htmlFor="cabinet-password-confirm" className="text-sm">{t("cabinet.profile.confirm_password")}</label>
                  <Input
                    id="cabinet-password-confirm"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-12 rounded-xl"
                  />
                </div>
                {changePasswordError && (
                  <p className="text-sm font-medium text-destructive animate-in fade-in text-center">{changePasswordError}</p>
                )}
                <Button className="w-full h-12 rounded-xl font-bold text-base shadow-lg" onClick={submitChangePassword} disabled={changePasswordLoading || !currentPassword || !newPassword || !confirmPassword}>
                  {changePasswordLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                  {t("cabinet.profile.save_password")}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Установка пароля — для юзеров без пароля (Telegram/Google/Apple) */}
      <Dialog open={setPasswordOpen} onOpenChange={(open) => !open && closeSetPassword()}>
        <DialogContent className="cabinet-account-dialog sm:max-w-md p-0 overflow-hidden border-border/50 backdrop-blur-3xl" showCloseButton={!setPasswordLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary mb-6 shadow-inner border border-primary/20">
              <KeyRound className="h-8 w-8" />
            </div>
            <DialogHeader className="p-0 flex flex-col items-center mb-6">
              <DialogTitle className="text-2xl font-bold tracking-tight">{t("cabinet.profile.set_password_title")}</DialogTitle>
              <DialogDescription className="text-center text-sm mt-2 max-w-[280px]">
                {t("cabinet.profile.set_password_desc")}
              </DialogDescription>
            </DialogHeader>

            {setPasswordSuccess ? (
              <div className="flex flex-col items-center gap-4 py-6 animate-in fade-in scale-95 duration-300">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 text-green-500">
                  <Check className="h-8 w-8" />
                </div>
                <p className="text-lg font-bold text-green-500">{t("cabinet.profile.set_password_ok")}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-3">
                  <Input
                    type="password"
                    placeholder={t("cabinet.profile.new_password")}
                    aria-describedby="set-password-hint"
                    autoComplete="new-password"
                    minLength={6}
                    value={setPasswordNew}
                    onChange={(e) => setSetPasswordNew(e.target.value)}
                    className="h-12 rounded-xl"
                    autoFocus
                  />
                  <PasswordHint id="set-password-hint" minLength={6} />
                  <Input
                    type="password"
                    placeholder={t("cabinet.profile.confirm_password")}
                    value={setPasswordConfirm}
                    onChange={(e) => setSetPasswordConfirm(e.target.value)}
                    className="h-12 rounded-xl"
                  />
                </div>
                {setPasswordError && (
                  <p className="text-sm font-medium text-destructive animate-in fade-in text-center">{setPasswordError}</p>
                )}
                <Button className="w-full h-12 rounded-xl font-bold text-base shadow-lg" onClick={submitSetPassword} disabled={setPasswordLoading || !setPasswordNew || !setPasswordConfirm}>
                  {setPasswordLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                  {t("cabinet.profile.save_password")}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
