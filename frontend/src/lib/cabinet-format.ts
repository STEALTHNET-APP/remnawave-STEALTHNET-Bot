import i18n from "i18next";
import { formatAuroraBalance } from "./aurora-profile";

export function formatCabinetMoney(amount: number, currency: string): string {
  return formatAuroraBalance(amount, currency, i18n.language || "ru");
}
