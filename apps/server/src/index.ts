import { serve } from "@hono/node-server";
import { dayKey, inQuietWindow } from "@wildcat/shared";
import { createApp } from "./app.ts";
import { ensureSetupCode, setupCodePath } from "./auth.ts";
import { createBackup, listBackups } from "./backups.ts";
import { loadConfig } from "./config.ts";
import { AppContext } from "./context.ts";
import { configureLogging, errorFields, log } from "./log.ts";
import { purgeOldData } from "./retention.ts";
import { applySeed } from "./seed.ts";
import { sweepStaleSessions } from "./sessions.ts";

/** Production and development entry point. */

const config = loadConfig();
configureLogging({ dataDir: config.dataDir });

process.on("uncaughtException", (err) => {
  log.error("Uncaught exception", errorFields(err));
  // systemd restarts us; exiting is safer than running in an unknown state.
  process.exit(1);
});
process.on("unhandledRejection", (err) => log.error("Unhandled rejection", errorFields(err)));

const app = new AppContext(config);
applySeed(app);

const setupCode = ensureSetupCode(app);
if (setupCode) {
  if (config.env === "development") log.info(`No admin yet. Open /admin and use setup code ${setupCode}`);
  else log.info("No admin yet. Open /admin from a staff device and enter the setup code", { file: setupCodePath(app) });
}

const server = serve({ fetch: createApp(app).fetch, hostname: config.host, port: config.port }, (info) => {
  log.info("Wildcat Games server listening", { host: info.address, port: info.port, version: config.version, env: config.env });
});

// --- Housekeeping ----------------------------------------------------------------------

let lastQuiet: boolean | null = null;
let lastDay = dayKey(new Date(), app.settings().timezone);
let lastNightly = "";

const housekeeping = setInterval(async () => {
  try {
    const s = app.settings();
    const now = new Date();
    // Push quiet-hours and day changes to the board.
    const quiet = s.quietHours.enabled && inQuietWindow(s.quietHours.windows, now, s.timezone);
    const day = dayKey(now, s.timezone);
    if ((lastQuiet !== null && quiet !== lastQuiet) || day !== lastDay) app.kiosk.broadcast({ type: "config" });
    lastQuiet = quiet;
    lastDay = day;
    sweepStaleSessions(app);

    // Nightly at about 2:30 local: backup and retention purge.
    const local = new Intl.DateTimeFormat("en-US", { timeZone: s.timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).format(now);
    const [h, m] = local.split(":").map(Number);
    if (h === 2 && m >= 30 && lastNightly !== day) {
      lastNightly = day;
      await createBackup(app, "nightly");
      const purged = purgeOldData(app, s.privacy.retentionDays);
      log.info("Nightly maintenance complete", purged);
    }
  } catch (err) {
    log.error("Housekeeping failed", errorFields(err));
  }
}, 30_000);

// A first backup on a fresh install, so there's always something to restore.
if (listBackups(app).length === 0) {
  createBackup(app, "initial").catch((err) => log.warn("Initial backup failed", errorFields(err)));
}

function shutdown(signal: string) {
  log.info("Shutting down", { signal });
  clearInterval(housekeeping);
  server.close();
  try {
    app.db.close();
  } catch {
    // Already closed.
  }
  setTimeout(() => process.exit(0), 200).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
