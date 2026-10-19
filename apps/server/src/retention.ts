import type { AppContext } from "./context.ts";

/**
 * Deletes gameplay records older than the retention window. Leaderboard entries
 * are kept (they hold only a generated nickname and a score); their link to the
 * deleted session is cleared.
 */
export function purgeOldData(app: AppContext, olderThanDays: number) {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60_000;
  return app.db.tx(() => {
    const sessions = app.db.run("DELETE FROM game_sessions WHERE started_at < ? AND status != 'active'", [cutoff]).changes;
    const events = app.db.run("DELETE FROM events WHERE created_at < ?", [cutoff]).changes;
    const audit = app.db.run("DELETE FROM audit_log WHERE created_at < ?", [new Date(cutoff - 365 * 24 * 60 * 60_000).toISOString()]).changes;
    return { sessions, events, audit };
  });
}
