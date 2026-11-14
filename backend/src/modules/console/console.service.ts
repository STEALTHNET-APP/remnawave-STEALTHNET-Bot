/**
 * SSH-консоль мониторинга для админа панели.
 * Доступ (юзер/пароль/порт) генерится САМ при старте бэкенда и хранится в system_settings —
 * НЕ в .env и НЕ в install.sh, чтобы фича доезжала и до тех, кто обновляется через `git pull`
 * (у них .env не трекается git'ом, а бэкенд-бутстрап отрабатывает на каждом старте).
 *
 * Отдельный сервис-контейнер (Wish/bubbletea) читает эти же креды и биндит порт (host-network).
 * Веб-админка показывает готовую ssh-команду + пароль + подсказку про фаервол.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../../db.js";

const K_USER = "console_user";
const K_PASS = "console_password";
const K_PORT = "console_port";
const K_IP = "console_public_ip";

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}
async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

function randUser(): string {
  return "ops_" + randomBytes(3).toString("hex");
}
function randPass(): string {
  // ~20 символов, url-safe (без символов, ломающих ввод пароля в SSH-клиенте)
  return randomBytes(15).toString("base64url");
}
function randPort(): number {
  // высокий диапазон, подальше от 22 и типовых сервисных портов
  return 22000 + Math.floor(Math.random() * 40000);
}

async function detectPublicIp(): Promise<string | null> {
  for (const url of ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
      if (!res.ok) continue;
      const ip = (await res.text()).trim();
      if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return ip;
    } catch {
      /* пробуем следующий */
    }
  }
  return null;
}

/** Идемпотентно: генерит недостающие креды консоли + детектит IP. Вызывается на старте бэкенда. */
export async function ensureConsoleAccess(): Promise<void> {
  try {
    if (!(await getSetting(K_USER))) await setSetting(K_USER, randUser());
    if (!(await getSetting(K_PASS))) await setSetting(K_PASS, randPass());
    if (!(await getSetting(K_PORT))) await setSetting(K_PORT, String(randPort()));
    if (!(await getSetting(K_IP))) {
      const ip = await detectPublicIp();
      if (ip) await setSetting(K_IP, ip);
    }
  } catch (e) {
    console.warn("[console] ensureConsoleAccess failed:", e);
  }
}

export type ConsoleAccess = {
  user: string;
  password: string;
  port: number;
  ip: string | null;
  sshCommand: string;
  ufwHint: string;
};

export async function getConsoleAccess(): Promise<ConsoleAccess> {
  const [user, password, portStr, ip] = await Promise.all([
    getSetting(K_USER),
    getSetting(K_PASS),
    getSetting(K_PORT),
    getSetting(K_IP),
  ]);
  const u = user ?? "";
  const port = Number(portStr) || 0;
  const host = ip || "<IP-сервера>";
  return {
    user: u,
    password: password ?? "",
    port,
    ip: ip ?? null,
    sshCommand: `ssh ${u}@${host} -p ${port}`,
    ufwHint: `ufw allow ${port}/tcp`,
  };
}

/**
 * Перегенерировать доступ (кнопка «сменить» в админке). IP и ПОРТ не трогаем —
 * консоль слушает порт постоянно; меняем только логин+пароль, а консоль
 * перечитывает их в auth-колбэке живьём (без пересоздания контейнера).
 */
export async function regenerateConsoleAccess(): Promise<ConsoleAccess> {
  await setSetting(K_USER, randUser());
  await setSetting(K_PASS, randPass());
  return getConsoleAccess();
}
