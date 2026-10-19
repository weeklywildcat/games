import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { GAME_IDS, suggestNicknames, type GameId, type KioskCommand, type KioskHeartbeat } from "@wildcat/shared";
import { requireNetwork, readJson, HttpError, type Env } from "../http.ts";
import { allBoards, leaderboard, type Period } from "../leaderboard.ts";
import { ipAllowed } from "../network.ts";
import { abandonSession, actOnSession, claimScore, recordEvent, sessionResult, startSession } from "../sessions.ts";
import { kioskConfig, publicStats } from "../stats.ts";
import { consumePreviewToken } from "../preview.ts";

/**
 * Public API for the board. Reads are open; anything that starts or plays a
 * game, or drives the kiosk, is limited to the play networks (the Pi itself by
 * default). Preview sessions are authorized by a short-lived admin token instead.
 */
export function publicRoutes() {
  const r = new Hono<Env>();

  const playGuard = (c: Parameters<typeof requireNetwork>[0]) => requireNetwork(c, c.get("app").config.playNetworks, "Playing");

  r.get("/kiosk/config", (c) => c.json(kioskConfig(c.get("app"))));

  r.get("/stats", (c) => c.json(publicStats(c.get("app"))));

  r.get("/leaderboards", (c) => {
    const period = (c.req.query("period") ?? "today") as Period;
    if (!["today", "week", "all"].includes(period)) throw new HttpError(400, "Unknown period");
    const game = c.req.query("game");
    const limit = Math.min(Number(c.req.query("limit") ?? 10) || 10, 50);
    const app = c.get("app");
    if (game) {
      if (!(GAME_IDS as readonly string[]).includes(game)) throw new HttpError(404, "Unknown game");
      return c.json({ period, game, rows: leaderboard(app, game as GameId, period, limit) });
    }
    return c.json(allBoards(app, period, limit));
  });

  r.get("/nicknames", (c) => {
    playGuard(c);
    return c.json({ names: suggestNicknames(3, randomBytes(4).readUInt32LE(0)) });
  });

  r.post("/play/sessions", async (c) => {
    playGuard(c);
    const body = await readJson<{ game?: string; mode?: string; visitId?: string; options?: { timed?: boolean } }>(c);
    if (body.mode === "preview") throw new HttpError(400, "Previews start from the admin dashboard");
    const res = startSession(c.get("app"), { game: String(body.game), mode: String(body.mode), visitId: body.visitId, options: body.options });
    return c.json(res, 201);
  });

  r.post("/play/preview", async (c) => {
    const body = await readJson<{ token?: string }>(c);
    const preview = consumePreviewToken(String(body.token ?? ""));
    if (!preview) throw new HttpError(403, "This preview link has expired. Open a new one from the dashboard.", "preview_expired");
    const res = startSession(c.get("app"), { game: preview.game, mode: "preview", contentId: preview.contentId });
    return c.json(res, 201);
  });

  /** Preview sessions may be played from admin networks; everything else from play networks. */
  const sessionGuard = (c: Parameters<typeof requireNetwork>[0], id: string) => {
    const app = c.get("app");
    const row = app.db.get<{ mode: string }>("SELECT mode FROM game_sessions WHERE id = ?", [id]);
    if (row?.mode === "preview" && ipAllowed(c.get("ip"), app.config.adminNetworks)) return;
    playGuard(c);
  };

  r.post("/play/sessions/:id/actions", async (c) => {
    const id = c.req.param("id");
    sessionGuard(c, id);
    const body = await readJson<{ seq?: number; type?: string; payload?: unknown }>(c);
    if (typeof body.type !== "string") throw new HttpError(400, "Missing action type");
    return c.json(actOnSession(c.get("app"), id, { seq: Number(body.seq), type: body.type, payload: body.payload }));
  });

  r.get("/play/sessions/:id/result", (c) => {
    const id = c.req.param("id");
    sessionGuard(c, id);
    return c.json(sessionResult(c.get("app"), id));
  });

  r.post("/play/sessions/:id/abandon", (c) => {
    const id = c.req.param("id");
    sessionGuard(c, id);
    abandonSession(c.get("app"), id);
    return c.json({ ok: true });
  });

  r.post("/play/sessions/:id/claim", async (c) => {
    const id = c.req.param("id");
    playGuard(c);
    const body = await readJson<{ nickname?: string }>(c);
    return c.json(claimScore(c.get("app"), id, body.nickname));
  });

  const EVENT_TYPES = new Set(["visit_start", "idle_reset", "attract_touch", "idle_continue", "help_open"]);
  r.post("/kiosk/events", async (c) => {
    playGuard(c);
    const body = await readJson<{ type?: string; game?: string }>(c);
    if (!body.type || !EVENT_TYPES.has(body.type)) throw new HttpError(400, "Unknown event");
    const game = body.game && (GAME_IDS as readonly string[]).includes(body.game) ? body.game : null;
    recordEvent(c.get("app"), body.type, game);
    return c.json({ ok: true });
  });

  r.post("/kiosk/heartbeat", async (c) => {
    playGuard(c);
    const body = await readJson<Partial<KioskHeartbeat>>(c);
    const screens = ["attract", "home", "game", "leaderboard", "paused", "quiet", "preview"];
    if (typeof body.clientId !== "string" || !screens.includes(String(body.screen))) throw new HttpError(400, "Bad heartbeat");
    c.get("app").kiosk.heartbeat({
      clientId: body.clientId.slice(0, 40),
      screen: body.screen as KioskHeartbeat["screen"],
      game: body.game && (GAME_IDS as readonly string[]).includes(body.game) ? body.game : null,
      version: String(body.version ?? "").slice(0, 20),
      viewport: body.viewport && typeof body.viewport.width === "number" ? { width: Math.round(body.viewport.width), height: Math.round(body.viewport.height) } : undefined,
    });
    return c.json({ ok: true, serverTime: Date.now() });
  });

  r.get("/kiosk/events", (c) => {
    playGuard(c);
    const app = c.get("app");
    return streamSSE(c, async (stream) => {
      let closed = false;
      const queue: KioskCommand[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = app.kiosk.subscribe((cmd) => {
        queue.push(cmd);
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ version: app.config.version }) });
      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 20_000);
          });
          wake = null;
        }
        if (closed) break;
        const batch = queue.splice(0);
        if (batch.length === 0) await stream.writeSSE({ event: "ping", data: "{}" });
        for (const cmd of batch) await stream.writeSSE({ event: "command", data: JSON.stringify(cmd) });
      }
      unsubscribe();
    });
  });

  return r;
}
