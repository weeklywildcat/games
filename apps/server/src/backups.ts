import { copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readSync, closeSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import type { AppContext } from "./context.ts";
import { Db, LATEST_SCHEMA_VERSION, migrate } from "./db.ts";
import { log } from "./log.ts";

/**
 * Online backups use SQLite's backup API, so they're consistent while the
 * board keeps playing. Restores verify the file, snapshot the current
 * database first, then swap files and reopen without restarting the process.
 */

const NAME = /^wildcat-\d{8}-\d{6}(-[a-z-]+)?\.sqlite$/;

export function backupDir(app: AppContext) {
  const dir = join(app.config.dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

export function listBackups(app: AppContext): BackupInfo[] {
  const dir = backupDir(app);
  return readdirSync(dir)
    .filter((f) => NAME.test(f))
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

export function backupPath(app: AppContext, name: string): string | null {
  if (!NAME.test(name)) return null;
  const p = join(backupDir(app), name);
  return existsSync(p) ? p : null;
}

export async function createBackup(app: AppContext, label = ""): Promise<BackupInfo> {
  const suffix = label ? `-${label.toLowerCase().replace(/[^a-z-]/g, "").slice(0, 20)}` : "";
  let name = `wildcat-${stamp()}${suffix}.sqlite`;
  let n = 1;
  while (existsSync(join(backupDir(app), name))) name = `wildcat-${stamp()}${suffix}${"-x".repeat(n++)}.sqlite`;
  const dest = join(backupDir(app), name);
  const tmp = `${dest}.partial`;
  await backup(app.db.raw, tmp);
  renameSync(tmp, dest);
  pruneBackups(app);
  log.info("Backup created", { name });
  const st = statSync(dest);
  return { name, size: st.size, createdAt: st.mtime.toISOString() };
}

/** Keeps the newest N automatic backups; labeled ones (pre-restore, manual) are kept too but count. */
export function pruneBackups(app: AppContext) {
  const keep = Math.max(3, app.config.backupKeep);
  const all = listBackups(app);
  for (const b of all.slice(keep)) rmSync(join(backupDir(app), b.name), { force: true });
}

export function isSqliteFile(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(16);
    readSync(fd, buf, 0, 16, 0);
    return buf.toString("latin1") === "SQLite format 3\u0000";
  } finally {
    closeSync(fd);
  }
}

export interface RestoreCheck {
  ok: boolean;
  reason?: string;
  schemaVersion?: number;
  counts?: Record<string, number>;
}

/** Opens a candidate file read-only and checks it is a Wildcat Games database we can migrate. */
export function inspectBackup(path: string): RestoreCheck {
  if (!existsSync(path)) return { ok: false, reason: "File not found" };
  if (!isSqliteFile(path)) return { ok: false, reason: "Not a SQLite database" };
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const integrity = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
    if (integrity.quick_check !== "ok") return { ok: false, reason: "The database failed an integrity check" };
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    for (const t of ["schema_migrations", "content_items", "game_sessions", "leaderboard_entries", "settings", "admins"]) {
      if (!tables.has(t)) return { ok: false, reason: `Missing table ${t}; this isn't a Wildcat Games backup` };
    }
    const version = (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v;
    if (version > LATEST_SCHEMA_VERSION) return { ok: false, reason: "This backup is from a newer version of Wildcat Games. Update first." };
    const count = (t: string) => (db!.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const admins = count("admins");
    if (admins === 0) return { ok: false, reason: "This backup has no admin accounts; restoring it would lock everyone out" };
    return {
      ok: true,
      schemaVersion: version,
      counts: { content: count("content_items"), sessions: count("game_sessions"), leaderboard: count("leaderboard_entries"), admins },
    };
  } catch (err) {
    return { ok: false, reason: `Couldn't read the file: ${(err as Error).message}` };
  } finally {
    db?.close();
  }
}

export async function restoreBackup(app: AppContext, sourcePath: string, actor: string): Promise<{ safetyBackup: string; check: RestoreCheck }> {
  const check = inspectBackup(sourcePath);
  if (!check.ok) throw new Error(check.reason);
  const safety = await createBackup(app, "pre-restore");
  const target = app.dbPath;
  const staged = `${target}.restoring`;
  copyFileSync(sourcePath, staged);
  app.db.close();
  for (const ext of ["-wal", "-shm"]) rmSync(`${target}${ext}`, { force: true });
  renameSync(staged, target);
  const next = new Db(target);
  migrate(next);
  app.replaceDb(next);
  app.audit(actor, "system.restore", null, { safetyBackup: safety.name, counts: check.counts });
  log.warn("Database restored from backup", { actor, safetyBackup: safety.name });
  return { safetyBackup: safety.name, check };
}

/** Writes an uploaded file to a temporary path inside the backups folder. */
export function stageUpload(app: AppContext, bytes: Uint8Array): string {
  const p = join(backupDir(app), `upload-${Date.now()}.tmp`);
  writeFileSync(p, bytes, { mode: 0o600 });
  return p;
}
