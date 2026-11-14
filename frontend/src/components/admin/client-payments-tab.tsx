import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Coins,
  CreditCard,
  Loader2,
  MoreVertical,
  Package,
  Receipt,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAdminClientPayments } from "@/lib/admin-queries";
import { qk } from "@/lib/query-client";
import { adminAlert, adminConfirm } from "@/lib/admin-dialogs";
import { fmtMsk } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PaymentActionsDrawer } from "@/components/payment-actions-drawer";

interface Props {
  clientId: string;
  token: string;
}

const AMOUNT_FORMAT = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  UAH: "₴",
  KZT: "₸",
  BYN: "Br",
  GBP: "£",
};

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  PENDING: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  FAILED: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20",
  REFUNDED: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20",
};

const PROVIDER_STYLES: Record<string, string> = {
  yookassa: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20",
  yoomoney: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  yoomoney_form: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  cryptopay: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/20",
  telegram_stars: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  balance: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
  platega: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  heleket: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/20",
  lava: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
  lavatop: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
  cloudpayments: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
  cispay: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  admin_grant: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20",
};

function currencySymbol(currency: string) {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? currency.toUpperCase();
}

function formatAmount(amount: number) {
  return AMOUNT_FORMAT.format(amount);
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function ClientPaymentsTab({ clientId, token }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, refetch } = useAdminClientPayments(token, clientId);
  const [actionsPaymentId, setActionsPaymentId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const items = data?.items ?? [];
  const paidItems = items.filter((p) => p.status === "PAID");
  const pendingCount = items.filter((p) => p.status === "PENDING").length;
  const failedCount = items.filter((p) => p.status === "FAILED" || p.status === "REFUNDED").length;

  const totalsByCurrency = new Map<string, number>();
  for (const payment of paidItems) {
    totalsByCurrency.set(payment.currency, (totalsByCurrency.get(payment.currency) ?? 0) + payment.amount);
  }
  const ltv = totalsByCurrency.size
    ? [...totalsByCurrency.entries()]
        .map(([currency, total]) => `${formatAmount(total)} ${currencySymbol(currency)}`)
        .join(" / ")
    : "—";

  const providerLabel = (provider: string) => {
    if (provider === "balance") return t("admin.clients.provider_balance", "Баланс");
    if (provider === "admin_grant") return t("admin.clients.provider_manual", "Ручная выдача");
    if (provider === "unknown") return "—";
    if (provider === "yoomoney" || provider === "yoomoney_form") return "ЮMoney";
    if (provider === "yookassa") return "ЮKassa";
    if (provider === "cryptopay") return "CryptoPay";
    if (provider === "telegram_stars") return "Telegram Stars";
    if (provider === "platega") return "Platega";
    if (provider === "heleket") return "Heleket";
    if (provider === "cloudpayments") return "CloudPayments";
    if (provider === "lavatop" || provider === "lava") return "Lava";
    if (provider === "cispay" || provider === "cis pay") return "CisPay";
    return provider;
  };

  const handleDelete = async (paymentId: string) => {
    const confirmed = await adminConfirm(
      t("admin.clients.delete_payment_confirm", "Удалить запись о платеже? Действие необратимо.")
    );
    if (!confirmed) return;
    setDeletingId(paymentId);
    try {
      await api.deleteSalePayment(token, paymentId);
      await queryClient.invalidateQueries({ queryKey: qk.admin.clientPayments(clientId) });
      await queryClient.invalidateQueries({ queryKey: ["admin", "sales-report"] });
      await refetch();
    } catch (error) {
      await adminAlert(
        error instanceof Error
          ? error.message
          : t("admin.clients.delete_payment_error", "Не удалось удалить платёж")
      );
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t("admin.clients.loading_short", "Загрузка…")}
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-stretch gap-3">
        <Card className="min-w-[180px] flex-1 rounded-xl border-border bg-card p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Coins className="h-3.5 w-3.5" />
            {t("admin.clients.total_spent", "Всего оплачено")}
          </div>
          <div className="mt-1 text-lg font-bold tracking-tight">{ltv}</div>
        </Card>

        <Card className="min-w-[180px] flex-1 rounded-xl border-border bg-card p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" />
            {t("admin.clients.payments_count", "Платежей")}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-lg font-bold tracking-tight">{items.length}</span>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
              {paidItems.length} {t("admin.clients.payments_success", "успешных")}
            </span>
            <span className="text-[11px] text-amber-600 dark:text-amber-400">
              {pendingCount} {t("admin.clients.payments_pending", "ожидают")}
            </span>
            <span className="text-[11px] text-rose-600 dark:text-rose-400">
              {failedCount} {t("admin.clients.payments_failed", "неуспешных")}
            </span>
          </div>
        </Card>

        <Button
          variant="outline"
          size="icon"
          className="h-auto w-11 shrink-0 rounded-xl"
          onClick={() => void refetch()}
          disabled={isFetching}
          title={t("admin.clients.refresh_data", "Обновить данные")}
          aria-label={t("admin.clients.refresh_data", "Обновить данные")}
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
        </Button>
      </div>

      {!items.length ? (
        <Card className="flex flex-col items-center justify-center gap-2 rounded-xl border-border bg-card py-12 text-center">
          <CreditCard className="h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{t("admin.clients.no_payments", "У клиента пока нет платежей")}</p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {items.map((payment, index) => {
            const providerClass =
              PROVIDER_STYLES[payment.provider] ??
              "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-border";
            return (
              <motion.div
                key={payment.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.015, 0.4) }}
              >
                <Card className="flex flex-col gap-3 rounded-xl border-border bg-card p-3.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold tracking-tight">
                        {formatAmount(payment.amount)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">{currencySymbol(payment.currency)}</span>
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          STATUS_STYLES[payment.status] ??
                            "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-border"
                        )}
                      >
                        {statusLabel(payment.status)}
                      </span>
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", providerClass)}>
                        {providerLabel(payment.provider)}
                      </span>
                      {payment.hasActivationError && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-500"
                          title={payment.activationError ?? undefined}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {t("admin.clients.activation_error", "Сбой активации")}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {payment.tariffName ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-foreground/[0.05] dark:bg-white/[0.05] px-2 py-0.5 text-[10px]">
                          <Package className="h-3 w-3" />
                          {payment.tariffName}
                        </span>
                      ) : payment.paymentType === "balance_topup" ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/20 bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                          <Wallet className="h-3 w-3" />
                          {t("admin.clients.balance_topup", "Пополнение баланса")}
                        </span>
                      ) : null}
                      {payment.subscriptionIndex != null && (
                        <span className="inline-flex items-center rounded-md border border-border bg-foreground/[0.05] dark:bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px]">
                          #{payment.subscriptionIndex}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <span className="font-mono select-all break-all">{payment.orderId}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">{fmtMsk(payment.paidAt ?? payment.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full hover:bg-foreground/10"
                      onClick={() => setActionsPaymentId(payment.id)}
                      title={t("admin.clients.payment_actions", "Действия с платежом")}
                      aria-label={t("admin.clients.payment_actions", "Действия с платежом")}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-red-500 hover:bg-red-500/10 dark:text-red-400"
                      onClick={() => void handleDelete(payment.id)}
                      disabled={deletingId === payment.id}
                      title={t("admin.clients.delete_payment", "Удалить платёж")}
                      aria-label={t("admin.clients.delete_payment", "Удалить платёж")}
                    >
                      {deletingId === payment.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <PaymentActionsDrawer
        paymentId={actionsPaymentId}
        onClose={() => setActionsPaymentId(null)}
        onRefreshList={() => void refetch()}
      />
    </div>
  );
}
