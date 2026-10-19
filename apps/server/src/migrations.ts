/**
 * Versioned schema migrations. Append new entries; never edit an applied one.
 * Each runs once inside a transaction, recorded in schema_migrations.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
      CREATE TABLE admins (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE admin_sessions (
        id TEXT PRIMARY KEY,            -- sha256 of the cookie token
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        csrf TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE content_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        ranked INTEGER NOT NULL DEFAULT 0,
        difficulty INTEGER NOT NULL DEFAULT 2,
        tags TEXT NOT NULL DEFAULT '[]',
        data TEXT NOT NULL,
        verification TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'admin',
        search TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        times_served INTEGER NOT NULL DEFAULT 0,
        last_served_at TEXT
      );
      CREATE INDEX content_type_status ON content_items (type, status);

      CREATE TABLE seed_log (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE game_sessions (
        id TEXT PRIMARY KEY,
        game TEXT NOT NULL,
        mode TEXT NOT NULL,
        content_ids TEXT NOT NULL DEFAULT '[]',
        seed INTEGER NOT NULL,
        state TEXT NOT NULL,
        status TEXT NOT NULL,           -- active | completed | abandoned | invalid
        won INTEGER,
        score INTEGER,
        stats TEXT,
        day TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        duration_ms INTEGER,
        last_seq INTEGER NOT NULL DEFAULT 0,
        last_response TEXT,
        visit_id TEXT,
        invalid_reason TEXT
      );
      CREATE INDEX game_sessions_day ON game_sessions (day, game, status);
      CREATE INDEX game_sessions_started ON game_sessions (started_at);

      CREATE TABLE leaderboard_entries (
        id INTEGER PRIMARY KEY,
        session_id TEXT UNIQUE REFERENCES game_sessions(id) ON DELETE SET NULL,
        game TEXT NOT NULL,
        nickname TEXT NOT NULL,
        score INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        day TEXT NOT NULL,
        created_at TEXT NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0,
        hidden_reason TEXT,
        hidden_by TEXT,
        hidden_at TEXT
      );
      CREATE INDEX leaderboard_game_day ON leaderboard_entries (game, day, score DESC);

      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        game TEXT,
        day TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        data TEXT
      );
      CREATE INDEX events_day_type ON events (day, type);

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        details TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_log_created ON audit_log (created_at);

      CREATE TABLE uploads (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
];
