import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Runtime configuration, read once from the environment. Everything has a safe
 * default so `npm run dev` works with no setup.
 */

const repoRoot = resolve(import.meta.dirname, "../../..");

function readVersion(): string {
  try {
    return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return process.env.WG_VERSION ?? "0.0.0";
  }
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AppConfig {
  env: "development" | "production" | "test";
  host: string;
  port: number;
  dataDir: string;
  contentDir: string;
  staticDir: string;
  version: string;
  /** CIDR ranges allowed to reach /admin and /api/admin. */
  adminNetworks: string[];
  /**
   * CIDR ranges allowed to play ranked/practice games and drive the board.
   * Production defaults to the Pi itself so phones on school Wi-Fi can't farm scores.
   */
  playNetworks: string[];
  /** Honor X-Forwarded-For (only behind a local reverse proxy such as Caddy). */
  trustProxy: boolean;
  /** Force the Secure flag on admin cookies (set when serving over HTTPS). */
  cookieSecure: boolean | "auto";
  /** Set by the systemd unit: the process may exit to be restarted. */
  supervised: boolean;
  /** Optional shell command that restarts the kiosk browser (installed by the Pi setup). */
  kioskRestartCommand: string | null;
  backupKeep: number;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = (process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development") as AppConfig["env"];
  const cookie = process.env.WG_COOKIE_SECURE;
  return {
    env,
    host: process.env.WG_HOST ?? (env === "production" ? "0.0.0.0" : "127.0.0.1"),
    port: Number(process.env.WG_PORT ?? 8787),
    dataDir: resolve(process.env.WG_DATA_DIR ?? join(repoRoot, "data")),
    contentDir: resolve(process.env.WG_CONTENT_DIR ?? join(repoRoot, "content")),
    staticDir: resolve(process.env.WG_STATIC_DIR ?? join(repoRoot, "apps/web/dist")),
    version: readVersion(),
    adminNetworks: list(process.env.WG_ADMIN_NETWORKS, [
      "127.0.0.0/8",
      "::1/128",
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "fc00::/7",
      "fe80::/10",
    ]),
    playNetworks: list(process.env.WG_PLAY_NETWORKS, env === "production" ? ["127.0.0.0/8", "::1/128"] : ["0.0.0.0/0", "::/0"]),
    trustProxy: process.env.WG_TRUST_PROXY === "1",
    cookieSecure: cookie === "1" ? true : cookie === "0" ? false : "auto",
    supervised: process.env.WG_SUPERVISED === "1",
    kioskRestartCommand: process.env.WG_KIOSK_RESTART_COMMAND || null,
    backupKeep: Number(process.env.WG_BACKUP_KEEP ?? 14),
    ...overrides,
  };
}
