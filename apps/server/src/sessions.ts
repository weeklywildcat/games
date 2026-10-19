import { randomUUID } from "node:crypto";
import {
  createRng,
  dayKey,
  GAME_IDS,
  inQuietWindow,
  isValidNickname,
  randomSeed,
  type GameId,
  type PlayMode,
  type SessionResult,
  type StartSessionResponse,
} from "@wildcat/shared";
import type { AppContext } from "./context.ts";
import { markServed } from "./content.ts";
import { connectionsEngine } from "./games/connections.ts";
import { matchEngine } from "./games/match.ts";
import { rushEngine } from "./games/rush.ts";
import { triviaEngine } from "./games/trivia.ts";
import { GameError, type EngineContext, type Finish, type GameEngine } from "./games/types.ts";
import { wordEngine } from "./games/word.ts";
import { bestScore, wouldRank } from "./leaderboard.ts";
import { log } from "./log.ts";

/**
 * Game sessions are server-authoritative: answers live here, every move is
 * validated here, and the server times each game. Moves carry a sequence
 * number so a retried request after a dropped connection is answered from the
 * stored response instead of being applied twice.
 */

const ENGINES: Record<GameId, GameEngine<any>> = {
  word: wordEngine,
  connections: connectionsEngine,
  trivia: triviaEngine,
  match: matchEngine,
  rush: rushEngine,
};

/** Sessions untouched this long are abandoned. */
const STALE_SESSION_MS = 60 * 60_000;
/** Scores can be claimed for this long after finishing. */
const CLAIM_WINDOW_MS = 15 * 60_000;

interface SessionRow {
  id: string;
  game: GameId;
  mode: PlayMode;
  content_ids: string;
  seed: number;
  state: string;
  status: "active" | "completed" | "abandoned" | "invalid";
  won: number | null;
  score: number | null;
  stats: string | null;
  day: string;
  started_at: number;
  finished_at: number | null;
  duration_ms: number | null;
  last_seq: number;
  last_response: string | null;
  visit_id: string | null;
  invalid_reason: string | null;
}

export function recordEvent(app: AppContext, type: string, game: string | null = null, data?: unknown) {
  const s = app.settings();
  app.db.run("INSERT INTO events (type, game, day, created_at, data) VALUES (?, ?, ?, ?, ?)", [
    type,
    game,
    dayKey(new Date(), s.timezone),
    Date.now(),
    data === undefined ? null : JSON.stringify(data),
  ]);
}

export function kioskBlocked(app: AppContext, now = new Date()): string | null {
  const s = app.settings();
  if (s.kiosk.paused) return "paused";
  if (s.quietHours.enabled && s.quietHours.mode === "closed" && inQuietWindow(s.quietHours.windows, now, s.timezone)) return "closed";
  return null;
}

export interface StartOptions {
  game: string;
  mode: string;
  visitId?: string | null;
  contentId?: string;
  options?: { timed?: boolean };
}

function sanitizeVisit(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null;
}

export function startSession(app: AppContext, opts: StartOptions): StartSessionResponse {
  if (!(GAME_IDS as readonly string[]).includes(opts.game)) throw new GameError("Unknown game", 404);
  const game = opts.game as GameId;
  const mode = opts.mode as PlayMode;
  if (!["ranked", "practice", "preview"].includes(mode)) throw new GameError("Unknown mode");
  const settings = app.settings();
  if (mode !== "preview") {
    if (!settings.games[game].enabled) throw new GameError("This game is turned off right now", 423, "disabled");
    const blocked = kioskBlocked(app);
    if (blocked) throw new GameError(blocked === "paused" ? "Games are paused" : "Wildcat Games is closed right now", 423, blocked);
  }
  const now = Date.now();
  const seed = randomSeed();
  const ctx: EngineContext = {
    app,
    mode,
    ranked: mode === "ranked",
    day: dayKey(new Date(now), settings.timezone),
    now,
    seed,
    rng: createRng(seed),
    visitId: sanitizeVisit(opts.visitId),
    contentId: opts.contentId,
  };
  const started = ENGINES[game].start(ctx);
  if (game === "trivia" && mode === "practice" && opts.options?.timed) {
    // Casual players may opt into the clock; it still isn't ranked.
    started.state.timed = true;
    started.puzzle = { ...started.puzzle, timed: true } as typeof started.puzzle;
    if (started.first && "remainingMs" in started.first) started.first.remainingMs = started.state.roundMs;
  }
  const id = randomUUID();
  app.db.tx(() => {
    app.db.run(
      `INSERT INTO game_sessions (id, game, mode, content_ids, seed, state, status, day, started_at, visit_id)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [id, game, mode, JSON.stringify(started.contentIds), seed, JSON.stringify(started.state), ctx.day, now, ctx.visitId],
    );
    if (mode !== "preview") markServed(app, started.contentIds);
  });
  return {
    sessionId: id,
    game,
    mode,
    ranked: mode === "ranked",
    puzzle: started.puzzle,
    startedAt: new Date(now).toISOString(),
    first: started.first,
  };
}

function loadSession(app: AppContext, id: string): SessionRow {
  if (typeof id !== "string" || id.length > 64) throw new GameError("Session not found", 404, "not_found");
  const row = app.db.get<SessionRow>("SELECT * FROM game_sessions WHERE id = ?", [id]);
  if (!row) throw new GameError("Session not found", 404, "not_found");
  return row;
}

export interface ActInput {
  seq: number;
  type: string;
  payload?: unknown;
}

export function actOnSession(app: AppContext, id: string, input: ActInput): unknown {
  return app.db.tx(() => {
    const row = loadSession(app, id);
    const seq = Number(input.seq);
    if (!Number.isInteger(seq) || seq < 1) throw new GameError("Missing move number");
    // Idempotent retry of the last move.
    if (seq === row.last_seq && row.last_response) return JSON.parse(row.last_response);
    if (row.status !== "active") throw new GameError("This game has ended", 409, "finished");
    if (seq !== row.last_seq + 1) throw new GameError("Moves arrived out of order", 409, "out_of_sequence");
    const now = Date.now();
    if (now - row.started_at > STALE_SESSION_MS) {
      app.db.run("UPDATE game_sessions SET status = 'abandoned', finished_at = ? WHERE id = ?", [now, id]);
      throw new GameError("This game timed out", 409, "stale");
    }
    const ctx: EngineContext = {
      app,
      mode: row.mode,
      ranked: row.mode === "ranked",
      day: row.day,
      now,
      seed: row.seed,
      rng: createRng(row.seed + seq),
      visitId: row.visit_id,
      startedAt: row.started_at,
    };
    const engine = ENGINES[row.game];
    const state = JSON.parse(row.state);
    const result = input.type === "give-up" ? engine.giveUp(state, ctx) : engine.act(state, { type: input.type, payload: input.payload }, ctx);
    let response = result.response as Record<string, unknown>;
    if (result.finish) {
      const summary = finalize(app, row, result.finish, now);
      response = { ...response, result: summary };
    }
    app.db.run("UPDATE game_sessions SET state = ?, last_seq = ?, last_response = ? WHERE id = ?", [
      JSON.stringify(result.state),
      seq,
      JSON.stringify(response),
      id,
    ]);
    return response;
  });
}

function finalize(app: AppContext, row: SessionRow, finish: Finish, now: number): SessionResult {
  const durationMs = now - row.started_at;
  const status = finish.invalid ? "invalid" : "completed";
  app.db.run(
    "UPDATE game_sessions SET status = ?, won = ?, score = ?, stats = ?, finished_at = ?, duration_ms = ?, invalid_reason = ? WHERE id = ?",
    [status, finish.won ? 1 : 0, finish.score, JSON.stringify(finish.stats), now, durationMs, finish.invalid ?? null, row.id],
  );
  if (finish.invalid) log.warn("Rejected game result", { game: row.game, mode: row.mode, reason: finish.invalid });
  return buildResult(app, { ...row, status, won: finish.won ? 1 : 0, score: finish.score, stats: JSON.stringify(finish.stats), finished_at: now, duration_ms: durationMs, invalid_reason: finish.invalid ?? null }, finish.completed);
}

function buildResult(app: AppContext, row: SessionRow, completed: boolean): SessionResult {
  const score = row.score ?? 0;
  const claimed = app.db.get<{ nickname: string }>("SELECT nickname FROM leaderboard_entries WHERE session_id = ?", [row.id]);
  const eligible = row.mode === "ranked" && row.status === "completed" && score > 0 && !claimed;
  const prevDaily = bestScore(app, row.game, row.day);
  const prevRecord = bestScore(app, row.game);
  return {
    sessionId: row.id,
    game: row.game,
    mode: row.mode,
    ranked: row.mode === "ranked",
    completed,
    won: row.won === 1,
    score,
    durationMs: row.duration_ms ?? 0,
    stats: row.stats ? JSON.parse(row.stats) : {},
    eligible,
    wouldRankToday: eligible ? wouldRank(app, row.game, row.day, score) : null,
    isGameRecord: row.mode === "ranked" && row.status === "completed" && score > 0 && score > prevRecord,
    isDailyBest: row.mode === "ranked" && row.status === "completed" && score > 0 && score > prevDaily,
    claimed: Boolean(claimed),
    nickname: claimed?.nickname,
  };
}

export function sessionResult(app: AppContext, id: string): SessionResult {
  const row = loadSession(app, id);
  if (row.status === "active") throw new GameError("This game is still in progress", 409, "active");
  return buildResult(app, row, row.status === "completed");
}

/** Called when the board resets mid-game; keeps the record for stats. */
export function abandonSession(app: AppContext, id: string): void {
  const row = loadSession(app, id);
  if (row.status !== "active") return;
  app.db.run("UPDATE game_sessions SET status = 'abandoned', finished_at = ? WHERE id = ?", [Date.now(), id]);
}

export function claimScore(app: AppContext, id: string, nickname: unknown) {
  if (typeof nickname !== "string" || !isValidNickname(nickname)) throw new GameError("Pick one of the suggested names", 400, "bad_nickname");
  return app.db.tx(() => {
    const row = loadSession(app, id);
    const existing = app.db.get<{ nickname: string }>("SELECT nickname FROM leaderboard_entries WHERE session_id = ?", [id]);
    if (existing) {
      if (existing.nickname === nickname) return { ok: true, rank: wouldRank(app, row.game, row.day, row.score ?? 0), nickname, duplicate: true };
      throw new GameError("This score is already on the board", 409, "claimed");
    }
    if (row.mode !== "ranked") throw new GameError("Only daily challenge scores go on the board", 409, "not_ranked");
    if (row.status !== "completed") throw new GameError("This result can't be claimed", 409, "not_eligible");
    if (!row.score || row.score <= 0) throw new GameError("Score some points first", 409, "no_score");
    if (!row.finished_at || Date.now() - row.finished_at > CLAIM_WINDOW_MS) throw new GameError("The claim window has closed", 409, "expired");
    const rank = wouldRank(app, row.game, row.day, row.score);
    app.db.run(
      "INSERT INTO leaderboard_entries (session_id, game, nickname, score, duration_ms, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, row.game, nickname, row.score, row.duration_ms ?? 0, row.day, new Date().toISOString()],
    );
    return { ok: true, rank, nickname, duplicate: false };
  });
}

/** Marks long-idle active sessions abandoned (run periodically). */
export function sweepStaleSessions(app: AppContext, now = Date.now()) {
  return app.db.run("UPDATE game_sessions SET status = 'abandoned', finished_at = ? WHERE status = 'active' AND started_at < ?", [now, now - STALE_SESSION_MS]).changes;
}
