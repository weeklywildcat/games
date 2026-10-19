import "@fontsource-variable/mona-sans/wdth.css";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/screens.css";
import "./styles/games.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KioskApp } from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { ConfigProvider } from "./lib/config.tsx";
import { VisitProvider } from "./lib/visit.tsx";
import { PreviewApp } from "./PreviewApp.tsx";

const isPreview = window.location.pathname.startsWith("/preview");

// Kiosk hardening that CSS can't do: no context menu, no pinch zoom, no drag ghosts.
if (!isPreview) {
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("gesturestart", (e) => e.preventDefault());
  window.addEventListener("dragstart", (e) => e.preventDefault());
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
}

// The service worker keeps the app shell available if the page reloads while the server restarts.
if ("serviceWorker" in navigator && import.meta.env.PROD && !isPreview) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ConfigProvider live={!isPreview}>
        <VisitProvider>{isPreview ? <PreviewApp /> : <KioskApp />}</VisitProvider>
      </ConfigProvider>
    </ErrorBoundary>
  </StrictMode>,
);
