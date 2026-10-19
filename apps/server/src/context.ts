import { join } from "node:path";
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from "@wildcat/shared";
import type { AppConfig } from "./config.ts";
import { Db, migrate } from "./db.ts";
import { Dictionary } from "./dictionary.ts";
import { KioskHub } from "./kiosk.ts";
import { log } from "./log.ts";

/**
 * Everything a request handler needs. The database handle is replaceable so a
 * backup restore can swap files without restarting the process.
 */
export class AppContext {
  db: Db;
  readonly config: AppConfig;
  readonly dictionary: Dictionary;
  readonly kiosk: KioskHub;
  readonly startedAt = Date.now();
  private settingsCache: Settings | null = null;

  constructor(config: AppConfig, opts: { dbPath?: string } = {}) {
    this.config = config;
    this.db = new Db(opts.dbPath ?? join(config.dataDir, "wildcat.sqlite"));
    migrate(this.db);
    this.dictionary = new Dictionary(config.contentDir);
    this.kiosk = new KioskHub();
  }

  get dbPath(): string {
    return this.db.path;
  }

  /** Swaps in a freshly opened database (after a restore). */
  replaceDb(next: Db) {
    this.db = next;
    this.settingsCache = null;
  }

  settings(): Settings {
    if (this.settingsCache) return this.settingsCache;
    const row = this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'settings'");
    let merged: Settings = DEFAULT_SETTINGS;
    if (row) {
      const stored = JSON.parse(row.value);
      const candidate = deepMerge(structuredClone(DEFAULT_SETTINGS), stored);
      const parsed = settingsSchema.safeParse(candidate);
      if (parsed.success) merged = parsed.data;
      else log.warn("Stored settings failed validation; using defaults for invalid keys", { issues: parsed.error.issues.length });
    }
    this.settingsCache = merged;
    return merged;
  }

  saveSettings(next: Settings) {
    const parsed = settingsSchema.parse(next);
    this.db.run(
      "INSERT INTO settings (key, value, updated_at) VALUES ('settings', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [JSON.stringify(parsed), new Date().toISOString()],
    );
    this.settingsCache = parsed;
    return parsed;
  }

  audit(actor: string, action: string, target: string | null, details?: unknown) {
    this.db.run("INSERT INTO audit_log (actor, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)", [
      actor,
      action,
      target,
      details === undefined ? null : JSON.stringify(details),
      new Date().toISOString(),
    ]);
  }
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const b = out[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) && v && typeof v === "object" && !Array.isArray(v) ? deepMerge(b, v) : v;
  }
  return out as T;
}

export { deepMerge };
