import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "../lib/utils.ts";

type Toast = { id: number; title: string; description?: string; tone: "success" | "error" | "info" };
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.tone === "error" ? 8000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] grid w-[min(24rem,calc(100%-2rem))] gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={cn("pointer-events-auto flex items-start gap-3 rounded-lg border bg-card p-3 shadow-lg", t.tone === "error" && "border-red-200")}>
            {t.tone === "error" ? <AlertTriangle className="mt-0.5 size-4 text-destructive" /> : <CheckCircle2 className="mt-0.5 size-4 text-success" />}
            <div className="grid flex-1 gap-0.5">
              <p className="text-sm font-medium">{t.title}</p>
              {t.description ? <p className="text-xs text-muted-foreground">{t.description}</p> : null}
            </div>
            <button className="opacity-60 hover:opacity-100" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
