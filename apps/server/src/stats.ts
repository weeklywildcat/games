import { existsSync, readFileSync, statSync, statfsSync } from "node:fs";
import os from "node:os";
import { dayKey, GAME_IDS, inQuietWindow, type GameId, type KioskConfig, type PublicStats } from "@wildcat/shared";
import { listBackups } from "./backups.ts";
import { contentCounts } from "./content.ts";
import type { AppContext } from "./context.ts";
import { schemaVersion } from "./db.ts";
import { availability } from "./games/selection.ts";
import { calendarWeek, gameRecord, leaderboard, overallBetween } from "./leaderboard.ts";

/** Statistics shown on the board and in the dashboard. Every number comes from the database. */

export function today(app: AppContext) {
  return dayKey(new Date(), app.settings().timezone);
}

/** "Solved" means a won session in any mode except previews. */
function solvedBetween(app: AppContext, start: string, end: string): number {
  return (
    app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM game_sessions WHERE won = 1 AND status = 'completed' AND mode != 'preview' AND day BETWEEN ? AND ?", [start, end])
      ?.n ?? 0
  );
}

export function publicStats(app: AppContext): PublicStats {
  const s = app.settings();
  const day = today(app);
  const played = app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM game_sessions WHERE day = ? AND mode != 'preview'", [day])?.n ?? 0;
  const topToday: PublicStats["topToday"] = {};
  const records: PublicStats["records"] = {};
  for (const g of GAME_IDS) {
    topToday[g] = leaderboard(app, g, "today", 5);
    records[g] = gameRecord(app, g);
  }
  const recent = app.db
    .all<{ nickname: string; score: number; game: GameId; day: string; duration_ms: number; created_at: string }>(
      "SELECT nickname, score, game, day, duration_ms, created_at FROM leaderboard_entries WHERE hidden = 0 ORDER BY created_at DESC LIMIT 5",
    )
    .map((r, i) => ({ rank: i + 1, nickname: r.nickname, score: r.score, game: r.game, day: r.day, durationMs: r.duration_ms, createdAt: r.created_at }));
  const c = s.challenge;
  const week = calendarWeek(day);
  const leader = overallBetween(app, week, 1)[0];
  return {
    day,
    solvedToday: solvedBetween(app, day, day),
    playedToday: played,
    challenge: c.enabled ? { enabled: true, title: c.title, target: c.target, progress: solvedBetween(app, c.start, c.end), start: c.start, end: c.end } : null,
    topToday,
    records,
    recent,
    weekLeader: leader ? { nickname: leader.nickname, score: leader.score, games: leader.games, ...week } : null,
  };
}

export function kioskConfig(app: AppContext): KioskConfig & { availability: ReturnType<typeof availability> } {
  const s = app.settings();
  const quietActive = s.quietHours.enabled && inQuietWindow(s.quietHours.windows, new Date(), s.timezone);
  return {
    timezone: s.timezone,
    branding: s.branding,
    attract: s.attract,
    games: s.games,
    idle: s.idle,
    animation: s.animation,
    sound: s.sound,
    trivia: s.trivia,
    rush: s.rush,
    challenge: s.challenge,
    event: s.event,
    kiosk: s.kiosk,
    quiet: { active: quietActive, mode: s.quietHours.mode, message: s.quietHours.message },
    version: app.config.version,
    day: today(app),
    availability: availability(app),
  };
}

export function overview(app: AppContext) {
  const day = today(app);
  const s = app.settings();
  const byGame = app.db.all<{ game: string; started: number; completed: number; won: number; avg_ms: number | null; ranked: number }>(
    `SELECT game,
            COUNT(*) AS started,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN won = 1 AND status = 'completed' THEN 1 ELSE 0 END) AS won,
            AVG(CASE WHEN status = 'completed' THEN duration_ms END) AS avg_ms,
            SUM(CASE WHEN mode = 'ranked' THEN 1 ELSE 0 END) AS ranked
       FROM game_sessions WHERE day = ? AND mode != 'preview' GROUP BY game`,
    [day],
  );
  const lastSeven = app.db.all<{ day: string; started: number; completed: number }>(
    `SELECT day, COUNT(*) AS started, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM game_sessions WHERE mode != 'preview' GROUP BY day ORDER BY day DESC LIMIT 7`,
  );
  const idleResets = app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE day = ? AND type = 'idle_reset'", [day])?.n ?? 0;
  const visits = app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE day = ? AND type = 'visit_start'", [day])?.n ?? 0;
  const invalidToday = app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM game_sessions WHERE day = ? AND status = 'invalid'", [day])?.n ?? 0;
  const records: Record<string, unknown> = {};
  for (const g of GAME_IDS) records[g] = gameRecord(app, g);
  const stats = publicStats(app);
  return {
    day,
    version: app.config.version,
    health: "ok",
    serverUptimeSec: Math.round((Date.now() - app.startedAt) / 1000),
    kiosk: app.kiosk.status(),
    settings: { paused: s.kiosk.paused, attractMode: s.attract.mode, featuredGame: s.attract.featuredGame },
    totals: {
      started: byGame.reduce((a, r) => a + r.started, 0),
      completed: byGame.reduce((a, r) => a + r.completed, 0),
      solved: stats.solvedToday,
      visits,
      idleResets,
      invalid: invalidToday,
    },
    byGame: byGame.map((r) => ({ ...r, avgSeconds: r.avg_ms ? Math.round(r.avg_ms / 100) / 10 : null })),
    lastSeven: lastSeven.reverse(),
    challenge: stats.challenge,
    records,
    content: contentCounts(app),
  };
}

function readFirst(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8").replace(/\u0000/g, "").trim() : null;
  } catch {
    return null;
  }
}

export function diagnostics(app: AppContext) {
  let disk: { freeBytes: number; totalBytes: number } | null = null;
  try {
    const st = statfsSync(app.config.dataDir);
    disk = { freeBytes: st.bavail * st.bsize, totalBytes: st.blocks * st.bsize };
  } catch {
    disk = null;
  }
  const size = (p: string) => (existsSync(p) ? statSync(p).size : 0);
  const tempRaw = readFirst("/sys/class/thermal/thermal_zone0/temp");
  const backups = listBackups(app);
  return {
    version: app.config.version,
    env: app.config.env,
    node: process.version,
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    deviceModel: readFirst("/proc/device-tree/model"),
    cpuTempC: tempRaw ? Math.round(Number(tempRaw) / 100) / 10 : null,
    loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100),
    memory: { rssBytes: process.memoryUsage().rss, freeBytes: os.freemem(), totalBytes: os.totalmem() },
    serverUptimeSec: Math.round((Date.now() - app.startedAt) / 1000),
    systemUptimeSec: Math.round(os.uptime()),
    disk,
    database: {
      path: app.dbPath.replace(app.config.dataDir, "<data>"),
      sizeBytes: size(app.dbPath),
      walBytes: size(`${app.dbPath}-wal`),
      schemaVersion: schemaVersion(app.db),
    },
    backups: { count: backups.length, latest: backups[0] ?? null },
    kiosk: app.kiosk.status(),
    capabilities: {
      serverRestart: app.config.supervised,
      kioskBrowserRestart: Boolean(app.config.kioskRestartCommand),
      kioskReload: true,
    },
  };
}
