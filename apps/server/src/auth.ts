import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AppContext } from "./context.ts";
import { log } from "./log.ts";

/**
 * Admin authentication. There is no default password: the first admin is
 * created with a one-time setup code written to the data directory (readable
 * only by the service user) or with `npm run admin:create` over SSH.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32 };
const SESSION_ABSOLUTE_MS = 12 * 60 * 60_000;
const SESSION_IDLE_MS = 2 * 60 * 60_000;
export const SESSION_COOKIE = "wg_admin";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "Enter a password";
  if (password.length < 12) return "Use at least 12 characters";
  if (password.length > 256) return "That password is too long";
  if (/^(.)\1+$/.test(password)) return "Pick something less repetitive";
  if (["password1234", "wildcatgames", "weeklywildcat", "123456789012"].includes(password.toLowerCase())) return "That password is too easy to guess";
  return null;
}

export function usernameProblem(username: unknown): string | null {
  if (typeof username !== "string" || !/^[A-Za-z0-9._-]{3,32}$/.test(username)) return "Use 3–32 letters, numbers, dots, dashes, or underscores";
  return null;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function adminCount(app: AppContext): number {
  return app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM admins")?.n ?? 0;
}

// --- First-run setup code ---------------------------------------------------

export function setupCodePath(app: AppContext) {
  return join(app.config.dataDir, "setup-code.txt");
}

/** Ensures a setup code exists while there are no admins. Returns it for dev logging only. */
export function ensureSetupCode(app: AppContext): string | null {
  const path = setupCodePath(app);
  if (adminCount(app) > 0) {
    if (existsSync(path)) rmSync(path, { force: true });
    return null;
  }
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const code = randomBytes(9).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 12);
  writeFileSync(path, code + "\n", { mode: 0o600 });
  return code;
}

export function checkSetupCode(app: AppContext, code: unknown): boolean {
  const path = setupCodePath(app);
  if (!existsSync(path) || typeof code !== "string") return false;
  const expected = Buffer.from(readFileSync(path, "utf8").trim().toUpperCase());
  const given = Buffer.from(code.trim().toUpperCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function createAdmin(app: AppContext, username: string, password: string, actor: string) {
  const hash = await hashPassword(password);
  const r = app.db.run("INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)", [username, hash, new Date().toISOString()]);
  app.audit(actor, "admin.create", username);
  if (adminCount(app) > 0) rmSync(setupCodePath(app), { force: true });
  return r.lastInsertRowid;
}

// --- Sessions ------------------------------------------------------------------

export interface AdminSession {
  adminId: number;
  username: string;
  csrf: string;
  expiresAt: number;
}

export function createSession(app: AppContext, adminId: number): { token: string; csrf: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  const now = Date.now();
  const expiresAt = now + SESSION_ABSOLUTE_MS;
  app.db.run("INSERT INTO admin_sessions (id, admin_id, csrf, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)", [
    sha256(token),
    adminId,
    csrf,
    now,
    expiresAt,
    now,
  ]);
  app.db.run("UPDATE admins SET last_login_at = ? WHERE id = ?", [new Date(now).toISOString(), adminId]);
  app.db.run("DELETE FROM admin_sessions WHERE expires_at < ? OR last_seen_at < ?", [now, now - SESSION_IDLE_MS]);
  return { token, csrf, expiresAt };
}

export function readSession(app: AppContext, token: string | undefined): AdminSession | null {
  if (!token || token.length > 100) return null;
  const now = Date.now();
  const row = app.db.get<{ admin_id: number; csrf: string; expires_at: number; last_seen_at: number; username: string }>(
    "SELECT s.admin_id, s.csrf, s.expires_at, s.last_seen_at, a.username FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.id = ?",
    [sha256(token)],
  );
  if (!row) return null;
  if (row.expires_at < now || row.last_seen_at < now - SESSION_IDLE_MS) {
    app.db.run("DELETE FROM admin_sessions WHERE id = ?", [sha256(token)]);
    return null;
  }
  if (now - row.last_seen_at > 60_000) app.db.run("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?", [now, sha256(token)]);
  return { adminId: row.admin_id, username: row.username, csrf: row.csrf, expiresAt: row.expires_at };
}

export function destroySession(app: AppContext, token: string | undefined) {
  if (token) app.db.run("DELETE FROM admin_sessions WHERE id = ?", [sha256(token)]);
}

export function destroyAllSessions(app: AppContext, adminId: number) {
  app.db.run("DELETE FROM admin_sessions WHERE admin_id = ?", [adminId]);
}

export function csrfMatches(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Login rate limiting ----------------------------------------------------------

/**
 * In-memory limiter keyed by a salted hash of the client address, so raw IPs
 * are never stored. Five failures in 15 minutes locks that client out for 15
 * minutes; a global ceiling slows distributed guessing.
 */
const WINDOW_MS = 15 * 60_000;
const PER_CLIENT = 5;
const GLOBAL = 50;
const salt = randomBytes(16).toString("hex");
const failures = new Map<string, number[]>();
let globalFailures: number[] = [];

export function clientKey(ip: string): string {
  return sha256(`${salt}:${ip}`).slice(0, 24);
}

export function loginAllowed(key: string, now = Date.now()): { ok: boolean; retryAfterSec?: number } {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, list);
  globalFailures = globalFailures.filter((t) => now - t < WINDOW_MS);
  if (list.length >= PER_CLIENT) return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - list[0])) / 1000) };
  if (globalFailures.length >= GLOBAL) return { ok: false, retryAfterSec: 60 };
  return { ok: true };
}

export function recordLoginFailure(key: string, now = Date.now()) {
  const list = failures.get(key) ?? [];
  list.push(now);
  failures.set(key, list);
  globalFailures.push(now);
  if (failures.size > 5000) failures.clear();
  log.warn("Admin login failed", { client: key });
}

export function clearLoginFailures(key: string) {
  failures.delete(key);
}

export function resetRateLimits() {
  failures.clear();
  globalFailures = [];
}
