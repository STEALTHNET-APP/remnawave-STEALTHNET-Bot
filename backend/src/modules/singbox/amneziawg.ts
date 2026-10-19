import { generateKeyPairSync, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { isIP } from "node:net";

export const awgKey = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
export const awgHost = z.string().min(1).max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/).refine(host => isIP(host) !== 0 || /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host));
export const awgConfigSchema = z.object({
  version: z.literal(2),
  publicKey: awgKey.optional(),
  Jc: z.number().int().min(1).max(12),
  Jmin: z.number().int().min(1).max(1280),
  Jmax: z.number().int().min(1).max(1280),
  S1: z.number().int().min(0).max(128),
  S2: z.number().int().min(0).max(128),
  S3: z.literal(0),
  S4: z.literal(0),
  H1: z.number().int().min(5).max(4294967295),
  H2: z.number().int().min(5).max(4294967295),
  H3: z.number().int().min(5).max(4294967295),
  H4: z.number().int().min(5).max(4294967295),
}).strict().refine(c => c.Jmin <= c.Jmax && new Set([c.H1, c.H2, c.H3, c.H4]).size === 4 && c.S1 + 148 !== c.S2 + 92);

export function newAwgConfig() {
  const headers = new Set<number>();
  while (headers.size < 4) headers.add(randomInt(5, 4294967296));
  const [H1, H2, H3, H4] = [...headers];
  return awgConfigSchema.parse({ version: 2, Jc: 4, Jmin: 40, Jmax: 70, S1: 86, S2: 96, S3: 0, S4: 0, H1, H2, H3, H4 });
}

export const awgPeerSchema = z.object({
  privateKey: awgKey,
  publicKey: awgKey,
  presharedKey: awgKey,
  address: z.string().regex(/^10\.88\.(?:[0-9]{1,3})\.(?:[0-9]{1,3})$/),
}).strict();

export function newAwgPeer(address: string) {
  const keys = generateKeyPairSync("x25519");
  return {
    privateKey: keys.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("base64"),
    publicKey: keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64"),
    presharedKey: randomBytes(32).toString("base64"),
    address,
  };
}

export function freeAwgAddress(used: Set<string>): string | null {
  for (let i = 2; i < 65535; i++) {
    const address = `10.88.${i >>> 8}.${i & 255}`;
    if (!used.has(address)) return address;
  }
  return null;
}

export function buildAwgClientConfig(node: { publicHost: string; port: number; customConfigJson?: string | null }, secret: string | null): string {
  const config = awgConfigSchema.parse(JSON.parse(node.customConfigJson || "null"));
  const peer = awgPeerSchema.parse(JSON.parse(secret || "null"));
  if (!config.publicKey) throw new Error("AmneziaWG node is not registered");
  const host = awgHost.parse(node.publicHost);
  const endpoint = `${host.includes(":") ? `[${host}]` : host}:${node.port}`;
  return ["[Interface]", `PrivateKey = ${peer.privateKey}`, `Address = ${peer.address}/32`, "DNS = 1.1.1.1, 1.0.0.1", "MTU = 1280",
    ...["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4"].map(k => `${k} = ${config[k as keyof typeof config]}`),
    "", "[Peer]", `PublicKey = ${config.publicKey}`, `PresharedKey = ${peer.presharedKey}`, `Endpoint = ${endpoint}`, "AllowedIPs = 0.0.0.0/0, ::/0", "PersistentKeepalive = 25", ""].join("\n");
}

export function awgCompose(apiUrl: string, token: string, port: number): string {
  if (!/^https:\/\//.test(apiUrl)) throw new Error("Для AmneziaWG укажите публичный HTTPS URL панели в настройках");
  return `services:
  amneziawg:
    build:
      context: https://github.com/STEALTHNET-APP/remnawave-STEALTHNET-Bot.git#main
      dockerfile: amneziawg-node/Dockerfile
    restart: unless-stopped
    cap_add: [NET_ADMIN]
    devices: [/dev/net/tun:/dev/net/tun]
    sysctls:
      net.ipv4.ip_forward: 1
    ports:
      - "${port}:${port}/udp"
    environment:
      STEALTHNET_API_URL: ${JSON.stringify(apiUrl.replace(/\/$/, ""))}
      SINGBOX_NODE_TOKEN: ${JSON.stringify(token)}
    volumes:
      - awg-data:/data
volumes:
  awg-data:
`;
}
