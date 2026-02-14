import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "STEALTHNET Admin",
        short_name: "StealthNET",
        theme_color: "#0f172a",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      workbox: {
        // Не перехватывать запросы к /api/ — они должны идти на бэкенд
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      // На macOS порт 5000 часто занят AirPlay. Бэкенд по умолчанию на 5001.
      "/api": { target: "http://localhost:5001", changeOrigin: true },
    },
  },
});
