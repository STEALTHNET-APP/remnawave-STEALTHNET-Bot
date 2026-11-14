export type ReferralLink = { kind: "site" | "bot"; url: string };

export function buildReferralLinks(code: string | null | undefined, publicAppUrl: string | null | undefined, botUsername: string | null | undefined): ReferralLink[] {
  if (!code) return [];
  const links: ReferralLink[] = [];
  const site = publicAppUrl?.trim().replace(/\/+$/, "");
  const bot = botUsername?.trim().replace(/^@/, "");
  if (site) links.push({ kind: "site", url: `${site}/cabinet/register?ref=${encodeURIComponent(code)}` });
  if (bot) links.push({ kind: "bot", url: `https://t.me/${bot}?start=ref_${code}` });
  return links;
}
