import { exec } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { CONTENT_TYPES, GAME_IDS, settingsSchema, type ContentStatus, type ContentType, type GameId } from "@wildcat/shared";
import {
  adminCount,
  checkSetupCode,
  clearLoginFailures,
  clientKey,
  createAdmin,
  createSession,
  csrfMatches,
  destroyAllSessions,
  destroySession,
  hashPassword,
  loginAllowed,
  passwordProblem,
  readSession,
  recordLoginFailure,
  SESSION_COOKIE,
  usernameProblem,
  verifyPassword,
} from "../auth.ts";
import { backupPath, createBackup, inspectBackup, listBackups, restoreBackup, stageUpload } from "../backups.ts";
import {
  contentCounts,
  contentUsage,
  createContent,
  deleteContent,
  exportContent,
  getContent,
  importContent,
  listContent,
  setContentStatus,
  updateContent,
  validateItem,
  type ContentInput,
} from "../content.ts";
import type { AppContext } from "../context.ts";
import { parseCsv, recordsFromCsv } from "../csv.ts";
import { HttpError, readJson, requireNetwork, type Env } from "../http.ts";
import { recentLogs, log, type LogLevel } from "../log.ts";
import { createPreviewToken } from "../preview.ts";
import { purgeOldData } from "../retention.ts";
import { diagnostics, overview } from "../stats.ts";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_RESTORE_BYTES = 200 * 1024 * 1024;

function secureCookie(c: Context<Env>): boolean {
  const pref = c.get("app").config.cookieSecure;
  if (pref !== "auto") return pref;
  return new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
}

function setSessionCookie(c: Context<Env>, token: string, expiresAt: number) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: secureCookie(c),
    path: "/",
    expires: new Date(expiresAt),
  });
}

async function confirmPassword(c: Context<Env>, password: unknown) {
  const app = c.get("app");
  const admin = c.get("admin");
  const row = app.db.get<{ password_hash: string }>("SELECT password_hash FROM admins WHERE id = ?", [admin.adminId]);
  if (typeof password !== "string" || !row || !(await verifyPassword(password, row.password_hash))) {
    throw new HttpError(403, "Your password is needed to confirm this", "reauth");
  }
}

function asContentType(v: string | undefined): ContentType {
  if (!v || !(CONTENT_TYPES as readonly string[]).includes(v)) throw new HttpError(404, "Unknown content type");
  return v as ContentType;
}

function asGame(v: unknown): GameId {
  if (typeof v !== "string" || !(GAME_IDS as readonly string[]).includes(v)) throw new HttpError(400, "Unknown game");
  return v as GameId;
}

function sniffImage(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length > 12 && Buffer.from(bytes.slice(0, 4)).toString() === "RIFF" && Buffer.from(bytes.slice(8, 12)).toString() === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function adminRoutes() {
  const r = new Hono<Env>();

  // Network allowlist applies to every admin endpoint, before auth.
  r.use("*", async (c, next) => {
    requireNetwork(c, c.get("app").config.adminNetworks, "The admin dashboard");
    c.header("Cache-Control", "no-store");
    await next();
  });

  // --- Auth (no session required) -----------------------------------------------

  r.get("/auth/status", (c) => {
    const app = c.get("app");
    const session = readSession(app, getCookie(c, SESSION_COOKIE));
    return c.json({
      needsSetup: adminCount(app) === 0,
      authenticated: Boolean(session),
      user: session ? { username: session.username } : null,
      csrf: session?.csrf ?? null,
      expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
      version: app.config.version,
    });
  });

  r.post("/auth/setup", async (c) => {
    const app = c.get("app");
    const key = clientKey(c.get("ip") ?? "unknown");
    const gate = loginAllowed(key);
    if (!gate.ok) throw new HttpError(429, "Too many attempts. Try again later.", "rate_limited", { retryAfterSec: gate.retryAfterSec });
    if (adminCount(app) > 0) throw new HttpError(409, "Setup is already complete", "setup_done");
    const body = await readJson<{ setupCode?: string; username?: string; password?: string }>(c);
    if (!checkSetupCode(app, body.setupCode)) {
      recordLoginFailure(key);
      throw new HttpError(403, "That setup code isn't right", "bad_setup_code");
    }
    const uProblem = usernameProblem(body.username);
    if (uProblem) throw new HttpError(400, uProblem, "bad_username");
    const pProblem = passwordProblem(body.password);
    if (pProblem) throw new HttpError(400, pProblem, "weak_password");
    const id = await createAdmin(app, body.username!, body.password!, "setup");
    const s = createSession(app, id);
    setSessionCookie(c, s.token, s.expiresAt);
    clearLoginFailures(key);
    log.info("First admin created", { username: body.username });
    return c.json({ ok: true, csrf: s.csrf });
  });

  r.post("/auth/login", async (c) => {
    const app = c.get("app");
    const key = clientKey(c.get("ip") ?? "unknown");
    const gate = loginAllowed(key);
    if (!gate.ok) throw new HttpError(429, "Too many attempts. Try again later.", "rate_limited", { retryAfterSec: gate.retryAfterSec });
    const body = await readJson<{ username?: string; password?: string }>(c);
    const row =
      typeof body.username === "string"
        ? app.db.get<{ id: number; password_hash: string; username: string }>("SELECT id, password_hash, username FROM admins WHERE username = ?", [body.username])
        : undefined;
    // Always run a hash so timing doesn't reveal whether the username exists.
    const ok = row
      ? await verifyPassword(String(body.password ?? ""), row.password_hash)
      : (await verifyPassword(String(body.password ?? ""), "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="), false);
    if (!row || !ok) {
      recordLoginFailure(key);
      throw new HttpError(401, "Wrong username or password", "bad_credentials");
    }
    clearLoginFailures(key);
    const s = createSession(app, row.id);
    setSessionCookie(c, s.token, s.expiresAt);
    app.audit(row.username, "auth.login", null);
    return c.json({ ok: true, csrf: s.csrf, user: { username: row.username } });
  });

  // --- Everything below requires a session; mutations require CSRF ----------------

  r.use("*", async (c, next) => {
    const app = c.get("app");
    const session = readSession(app, getCookie(c, SESSION_COOKIE));
    if (!session) throw new HttpError(401, "Please sign in", "unauthenticated");
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (!csrfMatches(session.csrf, c.req.header("x-csrf-token"))) throw new HttpError(403, "Security check failed. Reload the page.", "csrf");
      const origin = c.req.header("origin");
      if (origin) {
        const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
        if (!host || new URL(origin).host !== host) throw new HttpError(403, "Cross-site request blocked", "origin");
      }
    }
    c.set("admin", session);
    await next();
  });

  r.post("/auth/logout", (c) => {
    destroySession(c.get("app"), getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // --- Accounts ------------------------------------------------------------------------

  r.get("/users", (c) => {
    const rows = c.get("app").db.all("SELECT id, username, created_at AS createdAt, last_login_at AS lastLoginAt FROM admins ORDER BY username");
    return c.json({ users: rows, me: c.get("admin").username });
  });

  r.post("/users", async (c) => {
    const body = await readJson<{ username?: string; password?: string; currentPassword?: string }>(c);
    await confirmPassword(c, body.currentPassword);
    const uProblem = usernameProblem(body.username);
    if (uProblem) throw new HttpError(400, uProblem);
    const pProblem = passwordProblem(body.password);
    if (pProblem) throw new HttpError(400, pProblem);
    const app = c.get("app");
    if (app.db.get("SELECT 1 FROM admins WHERE username = ?", [body.username!])) throw new HttpError(409, "That username is taken");
    await createAdmin(app, body.username!, body.password!, c.get("admin").username);
    return c.json({ ok: true }, 201);
  });

  r.delete("/users/:id", async (c) => {
    const body = await readJson<{ currentPassword?: string }>(c);
    await confirmPassword(c, body.currentPassword);
    const app = c.get("app");
    const id = Number(c.req.param("id"));
    if (id === c.get("admin").adminId) throw new HttpError(409, "You can't remove your own account");
    if (adminCount(app) <= 1) throw new HttpError(409, "Keep at least one admin");
    const row = app.db.get<{ username: string }>("SELECT username FROM admins WHERE id = ?", [id]);
    if (!row) throw new HttpError(404, "Not found");
    app.db.run("DELETE FROM admins WHERE id = ?", [id]);
    app.audit(c.get("admin").username, "admin.delete", row.username);
    return c.json({ ok: true });
  });

  r.post("/account/password", async (c) => {
    const body = await readJson<{ currentPassword?: string; newPassword?: string }>(c);
    await confirmPassword(c, body.currentPassword);
    const problem = passwordProblem(body.newPassword);
    if (problem) throw new HttpError(400, problem);
    const app = c.get("app");
    const admin = c.get("admin");
    app.db.run("UPDATE admins SET password_hash = ? WHERE id = ?", [await hashPassword(body.newPassword!), admin.adminId]);
    destroyAllSessions(app, admin.adminId);
    const s = createSession(app, admin.adminId);
    setSessionCookie(c, s.token, s.expiresAt);
    app.audit(admin.username, "admin.password", admin.username);
    return c.json({ ok: true, csrf: s.csrf });
  });

  // --- Dashboard ------------------------------------------------------------------------

  r.get("/overview", (c) => c.json(overview(c.get("app"))));

  // --- Content ---------------------------------------------------------------------------

  r.get("/content-counts", (c) => c.json(contentCounts(c.get("app"))));

  r.get("/content/:type", (c) => {
    const type = asContentType(c.req.param("type"));
    const status = c.req.query("status") as ContentStatus | "active" | undefined;
    const ranked = c.req.query("ranked");
    return c.json(
      listContent(c.get("app"), {
        type,
        status: status || undefined,
        q: c.req.query("q") || undefined,
        ranked: ranked === "1" ? true : ranked === "0" ? false : undefined,
        limit: Number(c.req.query("limit") ?? 50),
        offset: Number(c.req.query("offset") ?? 0),
      }),
    );
  });

  r.post("/content/:type", async (c) => {
    const type = asContentType(c.req.param("type"));
    const body = await readJson<Omit<ContentInput, "type">>(c);
    const res = createContent(c.get("app"), { ...body, type, status: body.status === "review" ? "review" : "draft" }, c.get("admin").username);
    return c.json(res, 201);
  });

  r.post("/content/:type/validate", async (c) => {
    const type = asContentType(c.req.param("type"));
    const body = await readJson<{ data?: unknown; verification?: unknown }>(c);
    return c.json(validateItem(c.get("app"), type, body.data, body.verification as never, true));
  });

  r.get("/content/:type/export", (c) => {
    const type = c.req.param("type") === "all" ? undefined : asContentType(c.req.param("type"));
    const records = exportContent(c.get("app"), type);
    c.header("Content-Disposition", `attachment; filename="wildcat-content-${type ?? "all"}-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({ format: "wildcat-games-content", version: 1, exportedAt: new Date().toISOString(), records });
  });

  r.post("/content/:type/import", async (c) => {
    const type = asContentType(c.req.param("type"));
    const body = await readJson<{ format?: "json" | "csv"; text?: string; records?: unknown[]; onExisting?: "skip" | "update" }>(c);
    let records: unknown[];
    if (body.format === "csv") {
      if (typeof body.text !== "string" || body.text.length > 2_000_000) throw new HttpError(400, "Paste or upload CSV text");
      records = recordsFromCsv(type, parseCsv(body.text));
    } else {
      records = Array.isArray(body.records) ? body.records : [];
    }
    if (records.length === 0) throw new HttpError(400, "No records found to import");
    if (records.length > 5000) throw new HttpError(400, "Import at most 5,000 records at a time");
    const typed = records.map((r) => ({ ...(r as object), type }));
    const report = importContent(c.get("app"), typed, c.get("admin").username, { onExisting: body.onExisting === "update" ? "update" : "skip" });
    return c.json(report);
  });

  r.post("/content/bulk-status", async (c) => {
    const body = await readJson<{ ids?: string[]; status?: ContentStatus }>(c);
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 1000) throw new HttpError(400, "Choose some items");
    const app = c.get("app");
    const results = body.ids.map((id) => {
      try {
        setContentStatus(app, String(id), body.status as ContentStatus, c.get("admin").username);
        return { id, ok: true };
      } catch (err) {
        return { id, ok: false, error: (err as Error).message };
      }
    });
    return c.json({ results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
  });

  r.get("/item/:id", (c) => {
    const app = c.get("app");
    const item = getContent(app, c.req.param("id"));
    if (!item) throw new HttpError(404, "Not found");
    const validation = validateItem(app, item.type, item.data, item.verification, true);
    return c.json({ item, validation, usage: contentUsage(app, item.id) });
  });

  r.put("/item/:id", async (c) => {
    const body = await readJson(c);
    return c.json(updateContent(c.get("app"), c.req.param("id"), body, c.get("admin").username));
  });

  r.post("/item/:id/status", async (c) => {
    const body = await readJson<{ status?: ContentStatus }>(c);
    return c.json(setContentStatus(c.get("app"), c.req.param("id"), body.status as ContentStatus, c.get("admin").username));
  });

  r.delete("/item/:id", (c) => {
    deleteContent(c.get("app"), c.req.param("id"), c.get("admin").username);
    return c.json({ ok: true });
  });

  r.post("/item/:id/preview", (c) => {
    const item = getContent(c.get("app"), c.req.param("id"));
    if (!item) throw new HttpError(404, "Not found");
    return c.json(createPreviewToken(item.id, item.type as GameId));
  });

  // --- Uploads (Mini Match images, logos) ------------------------------------------------

  r.get("/uploads", (c) => c.json({ uploads: c.get("app").db.all("SELECT * FROM uploads ORDER BY created_at DESC") }));

  r.post("/uploads", async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new HttpError(400, "Choose an image file");
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "Images must be 2 MB or smaller");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) throw new HttpError(415, "Use a PNG, JPEG, or WebP image");
    const app = c.get("app");
    const id = randomUUID().replace(/-/g, "").slice(0, 20);
    const dir = join(app.config.dataDir, "uploads");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.${kind.ext}`), bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const name = file.name.replace(/[^\w.\- ]+/g, "").slice(0, 80) || "image";
    app.db.run("INSERT INTO uploads (id, filename, mime, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, name, kind.mime, bytes.length, sha, new Date().toISOString()]);
    app.audit(c.get("admin").username, "upload.create", id, { name, size: bytes.length });
    return c.json({ id, url: `/uploads/${id}`, mime: kind.mime }, 201);
  });

  // --- Leaderboard moderation ------------------------------------------------------------

  r.get("/leaderboard", (c) => {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const game = c.req.query("game");
    const day = c.req.query("day");
    const hidden = c.req.query("hidden");
    if (game) {
      where.push("game = ?");
      params.push(asGame(game));
    }
    if (day) {
      where.push("day = ?");
      params.push(day);
    }
    if (hidden === "1" || hidden === "0") {
      where.push("hidden = ?");
      params.push(Number(hidden));
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 1000);
    const rows = c
      .get("app")
      .db.all(
        `SELECT id, game, nickname, score, duration_ms AS durationMs, day, created_at AS createdAt, hidden, hidden_reason AS hiddenReason, hidden_by AS hiddenBy FROM leaderboard_entries ${clause} ORDER BY day DESC, score DESC LIMIT ?`,
        [...params, limit],
      );
    return c.json({ entries: rows });
  });

  r.post("/leaderboard/:id/hide", async (c) => {
    const body = await readJson<{ reason?: string }>(c);
    const app = c.get("app");
    const id = Number(c.req.param("id"));
    const reason = String(body.reason ?? "Removed by staff").slice(0, 120);
    const r2 = app.db.run("UPDATE leaderboard_entries SET hidden = 1, hidden_reason = ?, hidden_by = ?, hidden_at = ? WHERE id = ?", [
      reason,
      c.get("admin").username,
      new Date().toISOString(),
      id,
    ]);
    if (!r2.changes) throw new HttpError(404, "Not found");
    app.audit(c.get("admin").username, "leaderboard.hide", String(id), { reason });
    app.kiosk.broadcast({ type: "config" });
    return c.json({ ok: true });
  });

  r.post("/leaderboard/:id/unhide", (c) => {
    const app = c.get("app");
    const id = Number(c.req.param("id"));
    const r2 = app.db.run("UPDATE leaderboard_entries SET hidden = 0, hidden_reason = NULL, hidden_by = NULL, hidden_at = NULL WHERE id = ?", [id]);
    if (!r2.changes) throw new HttpError(404, "Not found");
    app.audit(c.get("admin").username, "leaderboard.unhide", String(id));
    app.kiosk.broadcast({ type: "config" });
    return c.json({ ok: true });
  });

  r.post("/leaderboard/reset-day", async (c) => {
    const body = await readJson<{ day?: string; game?: string; currentPassword?: string }>(c);
    await confirmPassword(c, body.currentPassword);
    if (typeof body.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) throw new HttpError(400, "Choose a day");
    const app = c.get("app");
    const params: (string | number)[] = ["Day reset by staff", c.get("admin").username, new Date().toISOString(), body.day];
    let sql = "UPDATE leaderboard_entries SET hidden = 1, hidden_reason = ?, hidden_by = ?, hidden_at = ? WHERE hidden = 0 AND day = ?";
    if (body.game) {
      sql += " AND game = ?";
      params.push(asGame(body.game));
    }
    const res = app.db.run(sql, params);
    app.audit(c.get("admin").username, "leaderboard.reset_day", body.day, { game: body.game ?? "all", entries: res.changes });
    app.kiosk.broadcast({ type: "config" });
    return c.json({ ok: true, hidden: res.changes });
  });

  r.post("/leaderboard/clear-game", async (c) => {
    const body = await readJson<{ game?: string; currentPassword?: string }>(c);
    await confirmPassword(c, body.currentPassword);
    const game = asGame(body.game);
    const app = c.get("app");
    const res = app.db.run("UPDATE leaderboard_entries SET hidden = 1, hidden_reason = ?, hidden_by = ?, hidden_at = ? WHERE hidden = 0 AND game = ?", [
      "Records cleared by staff",
      c.get("admin").username,
      new Date().toISOString(),
      game,
    ]);
    app.audit(c.get("admin").username, "leaderboard.clear_game", game, { entries: res.changes });
    app.kiosk.broadcast({ type: "config" });
    return c.json({ ok: true, hidden: res.changes });
  });

  r.get("/leaderboard/export.csv", (c) => {
    const rows = c.get("app").db.all<Record<string, unknown>>(
      "SELECT id, day, game, nickname, score, duration_ms, created_at, hidden, hidden_reason FROM leaderboard_entries ORDER BY day, game, score DESC",
    );
    const header = ["id", "day", "game", "nickname", "score", "duration_ms", "created_at", "hidden", "hidden_reason"];
    const csv = [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(","))].join("\n");
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="wildcat-leaderboard-${new Date().toISOString().slice(0, 10)}.csv"`);
    return c.body(csv);
  });

  r.get("/invalid-attempts", (c) => {
    const rows = c
      .get("app")
      .db.all<{ id: string; game: string; mode: string; day: string; invalid_reason: string; score: number | null; started_at: number; duration_ms: number | null }>(
        "SELECT id, game, mode, day, invalid_reason, score, started_at, duration_ms FROM game_sessions WHERE status = 'invalid' ORDER BY started_at DESC LIMIT 200",
      );
    return c.json({
      attempts: rows.map((r) => ({
        id: r.id.slice(0, 8),
        game: r.game,
        mode: r.mode,
        day: r.day,
        reason: r.invalid_reason,
        score: r.score,
        startedAt: new Date(r.started_at).toISOString(),
        durationMs: r.duration_ms,
      })),
    });
  });

  // --- Settings and kiosk control -----------------------------------------------------------

  r.get("/settings", (c) => c.json(c.get("app").settings()));

  r.put("/settings", async (c) => {
    const body = await readJson(c);
    const app = c.get("app");
    const before = app.settings();
    const next = app.saveSettings(settingsSchema.parse(body));
    const changed = Object.keys(next).filter((k) => JSON.stringify((next as Record<string, unknown>)[k]) !== JSON.stringify((before as Record<string, unknown>)[k]));
    app.audit(c.get("admin").username, "settings.update", null, { changed });
    app.kiosk.broadcast({ type: "config" });
    return c.json(next);
  });

  r.get("/kiosk", (c) => {
    const app = c.get("app");
    const s = app.settings();
    return c.json({ status: app.kiosk.status(), paused: s.kiosk.paused, pauseMessage: s.kiosk.pauseMessage, capabilities: diagnostics(app).capabilities });
  });

  r.post("/kiosk/command", async (c) => {
    const body = await readJson<{ type?: string }>(c);
    if (body.type !== "attract" && body.type !== "reload") throw new HttpError(400, "Unknown command");
    const app = c.get("app");
    app.kiosk.broadcast({ type: body.type });
    app.audit(c.get("admin").username, `kiosk.${body.type}`, null);
    return c.json({ ok: true, delivered: app.kiosk.connections });
  });

  r.post("/kiosk/pause", async (c) => {
    const body = await readJson<{ paused?: boolean; message?: string }>(c);
    const app = c.get("app");
    const s = structuredClone(app.settings());
    s.kiosk.paused = Boolean(body.paused);
    if (typeof body.message === "string") s.kiosk.pauseMessage = body.message.slice(0, 120);
    app.saveSettings(s);
    app.audit(c.get("admin").username, s.kiosk.paused ? "kiosk.pause" : "kiosk.resume", null);
    app.kiosk.broadcast({ type: "config" });
    return c.json({ ok: true, paused: s.kiosk.paused });
  });

  r.post("/kiosk/restart-browser", (c) => {
    const app = c.get("app");
    const cmd = app.config.kioskRestartCommand;
    if (!cmd) throw new HttpError(501, "Browser restart isn't configured on this device. Use Reload instead.", "unsupported");
    app.audit(c.get("admin").username, "kiosk.restart_browser", null);
    exec(cmd, { timeout: 15_000 }, (err) => {
      if (err) log.error("Kiosk browser restart failed", { error: err.message });
      else log.info("Kiosk browser restart requested");
    });
    return c.json({ ok: true });
  });

  // --- System -----------------------------------------------------------------------------------

  r.get("/system/diagnostics", (c) => c.json(diagnostics(c.get("app"))));

  r.get("/system/logs", (c) => {
    const level = (c.req.query("level") ?? "info") as LogLevel;
    return c.json({ entries: recentLogs(Math.min(Number(c.req.query("limit") ?? 200) || 200, 500), ["debug", "info", "warn", "error"].includes(level) ? level : "info") });
  });

  r.get("/system/audit", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 1000);
    const rows = c.get("app").db.all<{ details: string | null }>("SELECT id, actor, action, target, details, created_at AS createdAt FROM audit_log ORDER BY id DESC LIMIT ?", [limit]);
    return c.json({ entries: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })) });
  });

  r.get("/system/backups", (c) => c.json({ backups: listBackups(c.get("app")) }));

  r.post("/system/backups", async (c) => {
    const app = c.get("app");
    const info = await createBackup(app, "manual");
    app.audit(c.get("admin").username, "system.backup", info.name);
    return c.json(info, 201);
  });

  r.get("/system/backups/:name", (c) => {
    const path = backupPath(c.get("app"), c.req.param("name"));
    if (!path) throw new HttpError(404, "Backup not found");
    c.header("Content-Type", "application/vnd.sqlite3");
    c.header("Content-Disposition", `attachment; filename="${c.req.param("name")}"`);
    c.header("Content-Length", String(statSync(path).size));
    return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream);
  });

  r.post("/system/restore", async (c) => {
    const app = c.get("app");
    const form = await c.req.parseBody();
    await confirmPassword(c, form.currentPassword);
    if (form.confirm !== "RESTORE") throw new HttpError(400, 'Type RESTORE to confirm', "confirm");
    let source: string | null = null;
    let staged: string | null = null;
    if (form.file instanceof File) {
      if (form.file.size > MAX_RESTORE_BYTES) throw new HttpError(413, "That file is too large");
      staged = stageUpload(app, new Uint8Array(await form.file.arrayBuffer()));
      source = staged;
    } else if (typeof form.name === "string") {
      source = backupPath(app, form.name);
    }
    if (!source) throw new HttpError(400, "Choose a backup to restore");
    try {
      const check = inspectBackup(source);
      if (!check.ok) throw new HttpError(400, check.reason ?? "That backup can't be restored", "bad_backup");
      const result = await restoreBackup(app, source, c.get("admin").username);
      app.kiosk.broadcast({ type: "reload" });
      return c.json({ ok: true, ...result });
    } finally {
      if (staged) rmSync(staged, { force: true });
    }
  });

  r.post("/system/purge", async (c) => {
    const body = await readJson<{ olderThanDays?: number; currentPassword?: string }>(c);
    await confirmPassword(c, body.currentPassword);
    const days = Number(body.olderThanDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new HttpError(400, "Choose a number of days");
    const app = c.get("app");
    const res = purgeOldData(app, days);
    app.audit(c.get("admin").username, "system.purge", null, { days, ...res });
    return c.json(res);
  });

  r.post("/system/restart", async (c) => {
    const app = c.get("app");
    if (!app.config.supervised) throw new HttpError(501, "Restart is only available when Wildcat Games runs as a system service", "unsupported");
    const body = await readJson<{ currentPassword?: string }>(c);
    await confirmPassword(c, body.currentPassword);
    app.audit(c.get("admin").username, "system.restart", null);
    log.warn("Restart requested from the dashboard", { by: c.get("admin").username });
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 500);
    return c.json({ ok: true });
  });

  r.get("/system/config-export", (c) => {
    const app = c.get("app");
    c.header("Content-Disposition", `attachment; filename="wildcat-config-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({
      format: "wildcat-games-config",
      version: app.config.version,
      exportedAt: new Date().toISOString(),
      settings: app.settings(),
      content: contentCounts(app),
      server: { adminNetworks: app.config.adminNetworks, playNetworks: app.config.playNetworks, trustProxy: app.config.trustProxy, backupKeep: app.config.backupKeep },
    });
  });

  return r;
}
