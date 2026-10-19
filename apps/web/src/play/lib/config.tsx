import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { GameId, KioskCommand, KioskConfig, PublicStats } from "@wildcat/shared";
import { api, connectivity } from "./api.ts";
import { setSoundEnabled } from "./sound.ts";

/**
 * Live kiosk configuration. Loaded at boot, refreshed whenever the server
 * says settings changed (SSE), and cached locally so the board can still
 * draw its attract screen if it reloads while the server is down.
 */

export type Availability = Record<GameId, { practice: boolean; ranked: boolean }>;
export type FullConfig = KioskConfig & { availability: Availability };

interface ConfigState {
  config: FullConfig | null;
  stats: PublicStats | null;
  refreshStats: () => void;
  onCommand: (fn: (cmd: KioskCommand) => void) => () => void;
}

const Ctx = createContext<ConfigState | null>(null);
const CACHE_KEY = "wg:config";

function readCache(): FullConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as FullConfig) : null;
  } catch {
    return null;
  }
}

export function ConfigProvider({ children, live = true }: { children: ReactNode; live?: boolean }) {
  const [config, setConfig] = useState<FullConfig | null>(readCache);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const handlers = useRef(new Set<(cmd: KioskCommand) => void>());

  const loadConfig = useCallback(async () => {
    try {
      const c = await api<FullConfig>("/api/kiosk/config");
      setConfig(c);
      setSoundEnabled(c.sound.enabled);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(c));
      } catch {
        // Storage may be unavailable; the live config still works.
      }
    } catch {
      // Keep the cached config; connectivity overlay explains the outage.
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await api<PublicStats>("/api/stats"));
    } catch {
      // Stats are decorative; keep the last good copy.
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void refreshStats();
    const statsTimer = window.setInterval(refreshStats, 30_000);
    return () => window.clearInterval(statsTimer);
  }, [loadConfig, refreshStats]);

  useEffect(() => {
    if (!live) return;
    let source: EventSource | null = null;
    let retry: number | undefined;
    const connect = () => {
      source = new EventSource("/api/kiosk/events");
      source.addEventListener("hello", () => {
        connectivity.markOnline();
        // Settings may have changed while disconnected.
        void loadConfig();
        void refreshStats();
      });
      source.addEventListener("command", (e) => {
        const cmd = JSON.parse((e as MessageEvent).data) as KioskCommand;
        if (cmd.type === "config") {
          void loadConfig();
          void refreshStats();
        }
        for (const fn of handlers.current) fn(cmd);
      });
      source.onerror = () => {
        // EventSource retries on its own; if it gave up, start over.
        if (source?.readyState === EventSource.CLOSED) {
          source.close();
          retry = window.setTimeout(connect, 3000);
        }
      };
    };
    connect();
    return () => {
      source?.close();
      window.clearTimeout(retry);
    };
  }, [live, loadConfig, refreshStats]);

  // Re-check config at day boundaries and every few minutes as a safety net.
  useEffect(() => {
    const t = window.setInterval(loadConfig, 5 * 60_000);
    return () => window.clearInterval(t);
  }, [loadConfig]);

  const onCommand = useCallback((fn: (cmd: KioskCommand) => void) => {
    handlers.current.add(fn);
    return () => handlers.current.delete(fn);
  }, []);

  return <Ctx.Provider value={{ config, stats, refreshStats, onCommand }}>{children}</Ctx.Provider>;
}

export function useKiosk() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useKiosk outside ConfigProvider");
  return v;
}
