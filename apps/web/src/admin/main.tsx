import "./admin.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./AdminApp.tsx";
import { Router } from "./lib/router.tsx";
import { ToastProvider } from "./ui/toast.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <ToastProvider>
        <AdminApp />
      </ToastProvider>
    </Router>
  </StrictMode>,
);
