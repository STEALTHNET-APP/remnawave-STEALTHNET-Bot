export const auroraProfileTabs = ["account", "payments", "security", "language", "devices", "topup"] as const;
export type AuroraProfileTab = typeof auroraProfileTabs[number];

export function auroraProfileTab(search: string, hash: string): AuroraProfileTab | null {
  const value = new URLSearchParams(search).get("tab") || hash.replace(/^#/, "");
  return auroraProfileTabs.includes(value as AuroraProfileTab) ? value as AuroraProfileTab : null;
}

export function formatAuroraBalance(amount: number, currency: string, language: string): string {
  const code = currency.trim().toUpperCase();
  try {
    return new Intl.NumberFormat(language, { style: "currency", currency: code, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}
