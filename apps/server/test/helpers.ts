import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/app.ts";
import { ensureSetupCode, resetRateLimits } from "../src/auth.ts";
import { loadConfig, type AppConfig } from "../src/config.ts";
import { AppContext } from "../src/context.ts";
import { resetSelectionMemory } from "../src/games/selection.ts";
import { configureLogging } from "../src/log.ts";
import { applySeed } from "../src/seed.ts";

configureLogging({ quiet: true });

export interface TestApp {
  ctx: AppContext;
  dataDir: string;
  request: (method: string, path: string, body?: unknown, opts?: { ip?: string; headers?: Record<string, string>; form?: FormData }) => Promise<{ status: number; body: any; headers: Headers }>;
  cookies: Map<string, string>;
  csrf: string | null;
  close: () => void;
}

export function makeApp(overrides: Partial<AppConfig> = {}, existingDataDir?: string): TestApp {
  const dataDir = existingDataDir ?? mkdtempSync(join(tmpdir(), "wg-test-"));
  const config = loadConfig({
    env: "test",
    dataDir,
    contentDir: resolve(import.meta.dirname, "../../../content"),
    staticDir: join(dataDir, "no-static"),
    playNetworks: ["127.0.0.0/8", "::1/128"],
    ...overrides,
  });
  const ctx = new AppContext(config);
  applySeed(ctx);
  ensureSetupCode(ctx);
  resetRateLimits();
  resetSelectionMemory();
  const web = createApp(ctx);
  const cookies = new Map<string, string>();
  const t: TestApp = {
    ctx,
    dataDir,
    cookies,
    csrf: null,
    async request(method, path, body, opts = {}) {
      const headers: Record<string, string> = { "x-test-ip": opts.ip ?? "127.0.0.1", ...(opts.headers ?? {}) };
      if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      if (t.csrf && method !== "GET" && !("x-csrf-token" in headers)) headers["x-csrf-token"] = t.csrf;
      let payload: FormData | string | undefined;
      if (opts.form) payload = opts.form;
      else if (body !== undefined) {
        headers["content-type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await web.request(`http://localhost${path}`, { method, headers, body: payload });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const [k, v] = pair.split("=");
        if (v === "" || /Max-Age=0/i.test(c)) cookies.delete(k);
        else cookies.set(k, v);
      }
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON (CSV, binary).
      }
      return { status: res.status, body: parsed, headers: res.headers };
    },
    close() {
      try {
        ctx.db.close();
      } catch {
        // already closed
      }
    },
  };
  return t;
}

export function destroy(t: TestApp) {
  t.close();
  rmSync(t.dataDir, { recursive: true, force: true });
}

export function setupCode(t: TestApp) {
  return readFileSync(join(t.dataDir, "setup-code.txt"), "utf8").trim();
}

export const TEST_PASSWORD = "correct horse battery staple";

/** Creates the first admin and signs in, storing the CSRF token. */
export async function signInAdmin(t: TestApp) {
  const r = await t.request("POST", "/api/admin/auth/setup", { setupCode: setupCode(t), username: "staff", password: TEST_PASSWORD });
  if (r.status !== 200) throw new Error(`setup failed: ${JSON.stringify(r.body)}`);
  t.csrf = r.body.csrf;
  return r;
}

/** Reads the server's private state for a session (tests only). */
export function sessionState<T = any>(t: TestApp, id: string): T {
  const row = t.ctx.db.get<{ state: string }>("SELECT state FROM game_sessions WHERE id = ?", [id]);
  return JSON.parse(row!.state) as T;
}

export function makeActor(t: TestApp, sessionId: string) {
  let seq = 0;
  return (type: string, payload?: unknown, opts?: { ip?: string }) => t.request("POST", `/api/play/sessions/${sessionId}/actions`, { seq: ++seq, type, payload }, opts);
}
