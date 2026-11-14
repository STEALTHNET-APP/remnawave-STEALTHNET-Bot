import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./i18n/init";
import "./index.css";
import "./components/layout/modern-admin.css";
import "./pages/cabinet/cabinet-polish.css";
import { initTelegramViewport } from "./lib/telegram-viewport";
import { cacheHousekeeper } from "./lib/cache-housekeeper";
import { recoverFromStaleBundle } from "./lib/sw-recovery";

// До первого рендера: иначе мини-апп успевает нарисоваться «половинкой».
initTelegramViewport();

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  void recoverFromStaleBundle();
});

window.setTimeout(() => { void cacheHousekeeper(); }, 1000);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
