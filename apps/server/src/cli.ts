import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { adminCount, createAdmin, destroyAllSessions, hashPassword, passwordProblem, usernameProblem } from "./auth.ts";
import { createBackup } from "./backups.ts";
import { loadConfig } from "./config.ts";
import { AppContext } from "./context.ts";
import { configureLogging } from "./log.ts";
import { applySeed } from "./seed.ts";

/**
 * Maintenance commands for staff with shell access (SSH on the Pi):
 *   npm run admin -- create          create an admin account
 *   npm run admin -- reset-password  set a new password for an admin
 *   npm run admin -- list            list admin usernames
 *   npm run admin -- backup          take a backup now
 *   npm run admin -- seed            load any new bundled content
 */

configureLogging({ quiet: true });
const app = new AppContext(loadConfig());
const [command, arg] = process.argv.slice(2);

async function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  if (hidden) {
    // Mask typed characters.
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(question)) write.call(rl, s);
      else write.call(rl, "*".repeat(s.length));
    };
  }
  const answer = await rl.question(question);
  rl.close();
  if (hidden) stdout.write("\n");
  return answer.trim();
}

async function askPassword(): Promise<string> {
  for (;;) {
    const pw = await ask("New password (12+ characters): ", true);
    const problem = passwordProblem(pw);
    if (problem) {
      console.log(problem);
      continue;
    }
    const again = await ask("Repeat password: ", true);
    if (pw !== again) {
      console.log("Those didn't match.");
      continue;
    }
    return pw;
  }
}

async function main() {
  switch (command) {
    case "create": {
      const username = arg ?? (await ask("Username: "));
      const problem = usernameProblem(username);
      if (problem) throw new Error(problem);
      if (app.db.get("SELECT 1 FROM admins WHERE username = ?", [username])) throw new Error("That username already exists");
      await createAdmin(app, username, await askPassword(), "cli");
      console.log(`Created admin "${username}". Admins now: ${adminCount(app)}.`);
      break;
    }
    case "reset-password": {
      const username = arg ?? (await ask("Username: "));
      const row = app.db.get<{ id: number }>("SELECT id FROM admins WHERE username = ?", [username]);
      if (!row) throw new Error("No admin with that username");
      app.db.run("UPDATE admins SET password_hash = ? WHERE id = ?", [await hashPassword(await askPassword()), row.id]);
      destroyAllSessions(app, row.id);
      app.audit("cli", "admin.password_reset", username);
      console.log(`Password updated for "${username}". Existing sessions were signed out.`);
      break;
    }
    case "list":
      for (const r of app.db.all<{ username: string; last_login_at: string | null }>("SELECT username, last_login_at FROM admins ORDER BY username")) {
        console.log(`${r.username}\t${r.last_login_at ?? "never signed in"}`);
      }
      break;
    case "backup": {
      const b = await createBackup(app, "manual");
      console.log(`Backup written: ${b.name} (${Math.round(b.size / 1024)} KB)`);
      break;
    }
    case "seed": {
      const r = applySeed(app);
      console.log(`Seed: ${r.created} new, ${r.skipped} already present, ${r.failed} rejected.`);
      break;
    }
    default:
      console.log("Usage: npm run admin -- <create|reset-password|list|backup|seed> [username]");
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => app.db.close());
