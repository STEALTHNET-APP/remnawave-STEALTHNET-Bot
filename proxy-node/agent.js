#!/usr/bin/env node
/**
 * Агент прокси-ноды STEALTHNET: регистрация, heartbeat, слоты → 3proxy (SOCKS5 + HTTP).
 * Переменные: STEALTHNET_API_URL, PROXY_NODE_TOKEN, SOCKS_PORT, HTTP_PORT, CONFIG_PATH, PASSWD_PATH
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const API_URL = (process.env.STEALTHNET_API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.PROXY_NODE_TOKEN || "";
const SOCKS_PORT = parseInt(process.env.SOCKS_PORT || "1080", 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8080", 10);
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, "3proxy.cfg");
const PASSWD_PATH = process.env.PASSWD_PATH || path.join(__dirname, "passwd");
const LOG_PATH = process.env.LOG_PATH || path.join(path.dirname(CONFIG_PATH), "3proxy.log");
const POLL_INTERVAL_MS = (parseInt(process.env.POLL_INTERVAL_SEC || "60", 10) || 60) * 1000;

if (!API_URL || !TOKEN) {
  console.error("Set STEALTHNET_API_URL and PROXY_NODE_TOKEN");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "X-Proxy-Node-Token": TOKEN,
};

let proxyProcess = null;
let lastSlotsSignature = null;
// Метрики: трафик по логинам (bytes in+out на слот), общий трафик ноды, текущие соединения (если будет источник)
let stats = { trafficIn: 0, trafficOut: 0, byLogin: {} };
let logReadOffset = 0;
// 3proxy logformat "L %U %I %O" → одна строка на запись: L login bytesIn bytesOut
const TRAFFIC_LINE = /^L\s+(\S+)\s+(\d+)\s+(\d+)/;

function slotsSignature(slots) {
  if (!slots || slots.length === 0) return "";
  return slots.map((s) => `${s.login}:${s.password}`).join("|");
}

function writePasswd(slots) {
  const dir = path.dirname(PASSWD_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lines = (slots || []).map((s) => `${s.login}:CL:${s.password}`);
  fs.writeFileSync(PASSWD_PATH, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
}

function writeConfig(slots) {
  const dir = path.dirname(CONFIG_PATH);
  if (!dir || (dir !== "." && !fs.existsSync(dir))) fs.mkdirSync(dir, { recursive: true });
  const logDir = path.dirname(LOG_PATH);
  if (logDir && logDir !== "." && !fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  // Формат "L %U %I %O" — имя пользователя (%U), байты входящие (%I), исходящие (%O). L = local time (обязательно для logformat).
  const cfg = [
    "nserver 8.8.8.8",
    "nserver 8.8.4.4",
    "nscache 65536",
    "timeouts 1 5 30 60 180 1800 15 60",
    `log ${LOG_PATH}`,
    'logformat "L %U %I %O"',
    `users $${PASSWD_PATH}`,
    "auth strong",
    "allow *",
    "maxconn 500",
    `socks -p${SOCKS_PORT} -i0.0.0.0`,
    `proxy -p${HTTP_PORT} -i0.0.0.0`,
  ].join("\n");
  fs.writeFileSync(CONFIG_PATH, cfg, "utf8");
}

function start3proxy() {
  if (proxyProcess) {
    try {
      proxyProcess.kill("SIGTERM");
      proxyProcess = null;
    } catch (_) {}
  }
  const bin = "3proxy";
  proxyProcess = spawn(bin, [CONFIG_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  proxyProcess.stdout?.on("data", (d) => process.stdout.write(d));
  proxyProcess.stderr?.on("data", (d) => process.stderr.write(d));
  proxyProcess.on("error", (err) => {
    console.error("3proxy spawn error:", err.message);
  });
  proxyProcess.on("exit", (code, sig) => {
    if (code !== null && code !== 0) console.error("3proxy exited:", code, sig);
    proxyProcess = null;
  });
  console.log("3proxy started (SOCKS", SOCKS_PORT + ", HTTP", HTTP_PORT + ")");
}

function applySlots(slots) {
  const sig = slotsSignature(slots);
  if (sig === lastSlotsSignature) return;
  lastSlotsSignature = sig;
  writePasswd(slots);
  writeConfig(slots);
  start3proxy();
}

async function register() {
  const res = await fetch(`${API_URL}/api/proxy-nodes/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "", socksPort: SOCKS_PORT, httpPort: HTTP_PORT }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("Register failed:", res.status, text);
    return null;
  }
  const data = JSON.parse(text);
  console.log("Registered nodeId:", data.nodeId);
  return data.nodeId;
}

function collectStatsFromLog() {
  try {
    if (!fs.existsSync(LOG_PATH)) return;
    const size = fs.statSync(LOG_PATH).size;
    if (size < logReadOffset) logReadOffset = 0; // ротация: новый файл
    if (logReadOffset >= size) return;
    const fd = fs.openSync(LOG_PATH, "r");
    const buf = Buffer.alloc(256 * 1024);
    let offset = logReadOffset;
    let n = 0;
    while ((n = fs.readSync(fd, buf, 0, buf.length, offset)) > 0) {
      offset += n;
      const chunk = buf.toString("utf8", 0, n);
      const lines = chunk.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(TRAFFIC_LINE);
        if (m) {
          const login = m[1];
          const inB = parseInt(m[2], 10) || 0;
          const outB = parseInt(m[3], 10) || 0;
          stats.trafficIn += inB;
          stats.trafficOut += outB;
          if (!stats.byLogin[login]) stats.byLogin[login] = 0;
          stats.byLogin[login] += inB + outB;
        }
      }
    }
    fs.closeSync(fd);
    logReadOffset = offset;
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Log read error:", err.message);
  }
}

async function heartbeat(nodeId, slots) {
  collectStatsFromLog();
  const slotsPayload = (slots || []).map((s) => ({
    slotId: s.id,
    trafficUsed: stats.byLogin[s.login] || 0,
    connections: 0,
  }));
  const body = {
    connections: 0,
    trafficIn: stats.trafficIn,
    trafficOut: stats.trafficOut,
    slots: slotsPayload.length ? slotsPayload : undefined,
  };
  const res = await fetch(`${API_URL}/api/proxy-nodes/${nodeId}/heartbeat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("Heartbeat failed:", res.status, await res.text());
  }
}

async function getSlots(nodeId) {
  const res = await fetch(`${API_URL}/api/proxy-nodes/${nodeId}/slots`, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return data.slots || [];
}

async function main() {
  const nodeId = await register();
  if (!nodeId) {
    console.error("Registration failed. Exiting.");
    process.exit(1);
  }

  const tick = async () => {
    const slots = await getSlots(nodeId);
    applySlots(slots);
    await heartbeat(nodeId, slots);
    if (slots.length > 0) {
      const total = stats.trafficIn + stats.trafficOut;
      console.log("Slots:", slots.length, "Traffic:", Math.round(total / 1024), "KB");
    }
  };

  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
  console.log("Heartbeat + 3proxy config refresh every", POLL_INTERVAL_MS / 1000, "s");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
