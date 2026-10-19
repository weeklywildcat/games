import { CORE_GAMES, dayKey, GAME_IDS, type GameId, type LeaderboardRow } from "@wildcat/shared";
import type { AppContext } from "./context.ts";

/**
 * Leaderboards rank each nickname by its best visible score, so one player
 * replaying all afternoon takes one row, not ten. Ties go to the faster game,
 * then to whoever got there first.
 */

export type Period = "today" | "week" | "all";

export function periodRange(app: AppContext, period: Period, now = new Date()): { start: string; end: string } | null {
  const s = app.settings();
  const today = dayKey(now, s.timezone);
  if (period === "today") return { start: today, end: today };
  if (period === "week") return { start: s.event.start, end: s.event.end };
  return null;
}

interface EntryRow {
  nickname: string;
  score: number;
  game: GameId;
  day: string;
  duration_ms: number;
  created_at: string;
}

export function leaderboard(app: AppContext, game: GameId, period: Period, limit = 10): LeaderboardRow[] {
  const range = periodRange(app, period);
  const params: (string | number)[] = [game];
  let where = "game = ? AND hidden = 0";
  if (range) {
    where += " AND day BETWEEN ? AND ?";
    params.push(range.start, range.end);
  }
  const rows = app.db.all<EntryRow>(
    `SELECT nickname, score, game, day, duration_ms, created_at FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY nickname ORDER BY score DESC, duration_ms ASC, created_at ASC) AS rn
       FROM leaderboard_entries WHERE ${where}
     ) WHERE rn = 1
     ORDER BY score DESC, duration_ms ASC, created_at ASC
     LIMIT ?`,
    [...params, limit],
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    score: r.score,
    game: r.game,
    day: r.day,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  }));
}

/**
 * The all-games board: each nickname's best score in each core game, summed.
 * Rewards trying every game (max 4,000), and only counts the four core games
 * so Rush's different scale doesn't dominate.
 */
export function overallBoard(app: AppContext, period: Period, limit = 10) {
  return overallBetween(app, periodRange(app, period), limit);
}

/** Monday–Sunday of the week containing `day` (YYYY-MM-DD). */
export function calendarWeek(day: string): { start: string; end: string } {
  const d = new Date(`${day}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  const start = new Date(d.getTime() - offset * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function overallBetween(app: AppContext, range: { start: string; end: string } | null, limit = 10) {
  const params: (string | number)[] = [];
  let where = `hidden = 0 AND game IN (${CORE_GAMES.map(() => "?").join(",")})`;
  params.push(...CORE_GAMES);
  if (range) {
    where += " AND day BETWEEN ? AND ?";
    params.push(range.start, range.end);
  }
  return app.db
    .all<{ nickname: string; total: number; games: number }>(
      `SELECT nickname, SUM(best) AS total, COUNT(*) AS games FROM (
         SELECT nickname, game, MAX(score) AS best FROM leaderboard_entries WHERE ${where} GROUP BY nickname, game
       ) GROUP BY nickname ORDER BY total DESC, games DESC, nickname LIMIT ?`,
      [...params, limit],
    )
    .map((r, i) => ({ rank: i + 1, nickname: r.nickname, score: r.total, games: r.games }));
}

export function gameRecord(app: AppContext, game: GameId): LeaderboardRow | null {
  return leaderboard(app, game, "all", 1)[0] ?? null;
}

export function allBoards(app: AppContext, period: Period, limit = 10) {
  const out: Partial<Record<GameId, LeaderboardRow[]>> = {};
  for (const g of GAME_IDS) out[g] = leaderboard(app, g, period, limit);
  return { period, range: periodRange(app, period), games: out, overall: overallBoard(app, period, limit) };
}

/** Where a score would land on today's board (1-based), counting distinct nicknames ahead of it. */
export function wouldRank(app: AppContext, game: GameId, day: string, score: number): number {
  const ahead =
    app.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM (SELECT nickname, MAX(score) AS best FROM leaderboard_entries WHERE game = ? AND day = ? AND hidden = 0 GROUP BY nickname) WHERE best > ?",
      [game, day, score],
    )?.n ?? 0;
  return ahead + 1;
}

export function bestScore(app: AppContext, game: GameId, day?: string): number {
  const row = day
    ? app.db.get<{ s: number | null }>("SELECT MAX(score) AS s FROM leaderboard_entries WHERE game = ? AND day = ? AND hidden = 0", [game, day])
    : app.db.get<{ s: number | null }>("SELECT MAX(score) AS s FROM leaderboard_entries WHERE game = ? AND hidden = 0", [game]);
  return row?.s ?? 0;
}
