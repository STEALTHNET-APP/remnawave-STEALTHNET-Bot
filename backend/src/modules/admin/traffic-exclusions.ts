import { prisma } from "../../db.js";

const prefix = "traffic_abuse_exclude:";
export type TrafficExclusion = { uuid: string; username: string };
export const trafficExclusionKey = (uuid: string) => prefix + uuid;

export async function getTrafficExclusions(): Promise<TrafficExclusion[]> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: prefix } } });
  return rows.map(row => ({ uuid: row.key.slice(prefix.length), username: row.value }));
}

export function filterExcludedTraffic<T>(
  usage: Map<string, T>, users: { uuid: string; username: string }[], exclusions: TrafficExclusion[],
) {
  const excludedIds = new Set(exclusions.map(item => item.uuid));
  const savedNames = new Set(exclusions.map(item => item.username));
  const usersByName = new Map(users.map(user => [user.username, user]));
  for (const username of usage.keys()) {
    const user = usersByName.get(username);
    if (user ? excludedIds.has(user.uuid) : savedNames.has(username)) usage.delete(username);
  }
  return users.filter(user => excludedIds.has(user.uuid)).length;
}
