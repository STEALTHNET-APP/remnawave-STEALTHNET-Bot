import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./i18n/init";
import "./index.css";
import { initTelegramViewport } from "./lib/telegram-viewport";

// До первого рендера: иначе мини-апп успевает нарисоваться «половинкой».
initTelegramViewport();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
