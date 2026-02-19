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
  if (!dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const cfg = [
    "nserver 8.8.8.8",
    "nserver 8.8.4.4",
    "nscache 65536",
    "timeouts 1 5 30 60 180 1800 15 60",
    "log /dev/stdout D",
    "logformat \"- +_L%t.%. %N.%p %E %U %C:%c %R:%r %O %I %h %T\"",
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

async function heartbeat(nodeId) {
  const res = await fetch(`${API_URL}/api/proxy-nodes/${nodeId}/heartbeat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ connections: 0, trafficIn: 0, trafficOut: 0 }),
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
    await heartbeat(nodeId);
    const slots = await getSlots(nodeId);
    applySlots(slots);
    if (slots.length > 0) {
      console.log("Slots:", slots.length);
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
