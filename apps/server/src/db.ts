import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { MIGRATIONS } from "./migrations.ts";

/**
 * SQLite via Node's built-in driver: no native module to compile on the Pi.
 * WAL mode keeps reads non-blocking and survives power loss; `synchronous=NORMAL`
 * is the recommended durability/speed balance for WAL.
 */

export type Params = Record<string, SQLInputValue> | SQLInputValue[];

export class Db {
  readonly raw: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL");
    this.raw.exec("PRAGMA synchronous = NORMAL");
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec("PRAGMA busy_timeout = 5000");
  }

  get<T>(sql: string, params: Params = []): T | undefined {
    return this.stmt(sql).get(...spread(params)) as T | undefined;
  }

  all<T>(sql: string, params: Params = []): T[] {
    return this.stmt(sql).all(...spread(params)) as T[];
  }

  run(sql: string, params: Params = []): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...spread(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Runs `fn` inside a transaction; nested calls join the outer one. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.raw.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (err) {
      this.raw.exec("ROLLBACK");
      throw err;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.cache.clear();
    try {
      this.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Best effort; closing still flushes.
    }
    this.raw.close();
  }

  private depth = 0;
  private cache = new Map<string, ReturnType<DatabaseSync["prepare"]>>();

  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
}

function spread(params: Params): SQLInputValue[] {
  return Array.isArray(params) ? params : [params as unknown as SQLInputValue];
}

export function schemaVersion(db: Db): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  return db.get<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations")?.v ?? 0;
}

/** Applies pending migrations in order, each in its own transaction. */
export function migrate(db: Db): number[] {
  const current = schemaVersion(db);
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.tx(() => {
      db.exec(m.sql);
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [m.version, m.name, new Date().toISOString()]);
    });
    applied.push(m.version);
  }
  return applied;
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
