import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Structured logging: JSON lines to stdout (journald on the Pi), a size-capped
 * file in the data directory, and a ring buffer the admin dashboard reads.
 * Never log secrets, cookies, or setup codes here.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  t: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

const RING_SIZE = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ring: LogEntry[] = [];
let filePath: string | null = null;
let quiet = false;

export function configureLogging(opts: { dataDir?: string; quiet?: boolean }) {
  quiet = Boolean(opts.quiet);
  if (opts.dataDir) {
    const dir = join(opts.dataDir, "logs");
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, "app.log");
  } else {
    filePath = null;
  }
}

function rotate() {
  if (!filePath || !existsSync(filePath)) return;
  if (statSync(filePath).size < MAX_FILE_BYTES) return;
  for (let i = 2; i >= 1; i--) {
    const from = `${filePath}.${i}`;
    if (existsSync(from)) renameSync(from, `${filePath}.${i + 1}`);
  }
  renameSync(filePath, `${filePath}.1`);
}

function write(level: LogLevel, msg: string, fields: Record<string, unknown> = {}) {
  const entry: LogEntry = { t: new Date().toISOString(), level, msg, ...fields };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  const line = JSON.stringify(entry);
  if (!quiet) (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
  if (filePath) {
    try {
      rotate();
      appendFileSync(filePath, line + "\n");
    } catch {
      // A full disk must not take gameplay down with it.
    }
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};

export function recentLogs(limit = 200, minLevel: LogLevel = "debug"): LogEntry[] {
  const order: LogLevel[] = ["debug", "info", "warn", "error"];
  const min = order.indexOf(minLevel);
  return ring.filter((e) => order.indexOf(e.level) >= min).slice(-limit).reverse();
}

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.message, stack: err.stack?.split("\n").slice(0, 4).join(" | ") };
  return { error: String(err) };
}
