#!/usr/bin/env node
/**
 * Агент прокси-ноды STEALTHNET: регистрация, heartbeat, загрузка слотов.
 * Запуск: node agent.js
 * Переменные: STEALTHNET_API_URL, PROXY_NODE_TOKEN, SOCKS_PORT, HTTP_PORT
 */

const API_URL = (process.env.STEALTHNET_API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.PROXY_NODE_TOKEN || "";
const SOCKS_PORT = parseInt(process.env.SOCKS_PORT || "1080", 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8080", 10);
const POLL_INTERVAL_MS = (parseInt(process.env.POLL_INTERVAL_SEC || "60", 10) || 60) * 1000;

if (!API_URL || !TOKEN) {
  console.error("Set STEALTHNET_API_URL and PROXY_NODE_TOKEN");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "X-Proxy-Node-Token": TOKEN,
};

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
  let nodeId = await register();
  if (!nodeId) {
    console.error("Registration failed. Exiting.");
    process.exit(1);
  }

  setInterval(async () => {
    await heartbeat(nodeId);
    const slots = await getSlots(nodeId);
    if (slots.length > 0) {
      console.log("Slots:", slots.length);
    }
  }, POLL_INTERVAL_MS);

  await heartbeat(nodeId);
  console.log("Heartbeat started every", POLL_INTERVAL_MS / 1000, "s");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
