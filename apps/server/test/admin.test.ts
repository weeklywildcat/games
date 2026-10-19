import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../src/auth.ts";
import { ipInCidr } from "../src/network.ts";
import { destroy, makeActor, makeApp, sessionState, setupCode, signInAdmin, TEST_PASSWORD, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeEach(() => {
  t = makeApp();
});
afterEach(() => destroy(t));

describe("first-run setup and sign-in", () => {
  it("has no default admin and needs the one-time setup code", async () => {
    const status = await t.request("GET", "/api/admin/auth/status");
    expect(status.body).toMatchObject({ needsSetup: true, authenticated: false });
    expect((await t.request("GET", "/api/admin/overview")).status).toBe(401);
    expect((await t.request("POST", "/api/admin/auth/setup", { setupCode: "WRONG", username: "staff", password: TEST_PASSWORD })).status).toBe(403);
    expect((await t.request("POST", "/api/admin/auth/setup", { setupCode: setupCode(t), username: "staff", password: "short" })).status).toBe(400);
    await signInAdmin(t);
    expect(existsSync(join(t.dataDir, "setup-code.txt"))).toBe(false);
    // Setup can't run twice.
    expect((await t.request("POST", "/api/admin/auth/setup", { setupCode: "anything", username: "x", password: TEST_PASSWORD })).status).toBe(409);
  });

  it("stores scrypt hashes, never plain passwords", async () => {
    await signInAdmin(t);
    const row = t.ctx.db.get<{ password_hash: string }>("SELECT password_hash FROM admins");
    expect(row!.password_hash.startsWith("scrypt$")).toBe(true);
    expect(row!.password_hash).not.toContain(TEST_PASSWORD);
    expect(await verifyPassword(TEST_PASSWORD, row!.password_hash)).toBe(true);
    expect(await verifyPassword("nope", row!.password_hash)).toBe(false);
  });

  it("issues an HttpOnly, SameSite=Strict session cookie and supports logout", async () => {
    const setup = await t.request("POST", "/api/admin/auth/setup", { setupCode: setupCode(t), username: "staff", password: TEST_PASSWORD });
    const cookie = setup.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    t.csrf = setup.body.csrf;
    expect((await t.request("GET", "/api/admin/overview")).status).toBe(200);
    await t.request("POST", "/api/admin/auth/logout");
    t.cookies.clear();
    expect((await t.request("GET", "/api/admin/overview")).status).toBe(401);
    const login = await t.request("POST", "/api/admin/auth/login", { username: "staff", password: TEST_PASSWORD });
    expect(login.status).toBe(200);
  });

  it("rate-limits repeated failed logins", async () => {
    await signInAdmin(t);
    t.cookies.clear();
    for (let i = 0; i < 5; i++) expect((await t.request("POST", "/api/admin/auth/login", { username: "staff", password: "wrong" })).status).toBe(401);
    const locked = await t.request("POST", "/api/admin/auth/login", { username: "staff", password: TEST_PASSWORD });
    expect(locked.status).toBe(429);
    // A different client is unaffected.
    expect((await t.request("POST", "/api/admin/auth/login", { username: "staff", password: TEST_PASSWORD }, { ip: "127.0.0.9" })).status).toBe(200);
  });

  it("requires the CSRF token and a same-origin request for changes", async () => {
    await signInAdmin(t);
    const csrf = t.csrf;
    t.csrf = null;
    expect((await t.request("POST", "/api/admin/kiosk/command", { type: "attract" })).status).toBe(403);
    t.csrf = csrf;
    expect((await t.request("POST", "/api/admin/kiosk/command", { type: "attract" }, { headers: { origin: "http://evil.example" } })).status).toBe(403);
    expect((await t.request("POST", "/api/admin/kiosk/command", { type: "attract" })).status).toBe(200);
  });

  it("blocks admin from networks outside the allowlist", async () => {
    expect((await t.request("GET", "/api/admin/auth/status", undefined, { ip: "8.8.8.8" })).status).toBe(403);
    expect((await t.request("GET", "/api/admin/auth/status", undefined, { ip: "192.168.1.20" })).status).toBe(200);
    expect(ipInCidr("::ffff:10.0.0.5", "10.0.0.0/8")).toBe(true);
    expect(ipInCidr("fe80::1", "fe80::/10")).toBe(true);
    expect(ipInCidr("172.32.0.1", "172.16.0.0/12")).toBe(false);
  });
});

describe("content management", () => {
  beforeEach(async () => {
    await signInAdmin(t);
  });

  const question = { category: "general", prompt: "What color do you get by mixing red and white paint?", choices: ["Pink", "Purple", "Orange", "Gray"], answerIndex: 0, explanation: "A tint of red." };

  it("drafts, approves, publishes, and unpublishes with validation", async () => {
    const created = await t.request("POST", "/api/admin/content/trivia", { data: question, difficulty: 1, ranked: false });
    expect(created.status).toBe(201);
    const id = created.body.item.id;
    expect(created.body.item.status).toBe("draft");
    // Publishing straight from draft is refused.
    expect((await t.request("POST", `/api/admin/item/${id}/status`, { status: "published" })).status).toBe(409);
    expect((await t.request("POST", `/api/admin/item/${id}/status`, { status: "approved" })).body.item.approvedBy).toBe("staff");
    expect((await t.request("POST", `/api/admin/item/${id}/status`, { status: "published" })).body.item.status).toBe("published");
    const audit = t.ctx.db.all<{ action: string }>("SELECT action FROM audit_log WHERE target = ?", [id]);
    expect(audit.map((a) => a.action)).toEqual(["content.create", "content.status", "content.status"]);
    // Editing published content must stay valid.
    const broken = await t.request("PUT", `/api/admin/item/${id}`, { data: { ...question, choices: ["Pink", "Pink", "Orange", "Gray"] } });
    expect(broken.status).toBe(400);
    expect((await t.request("POST", `/api/admin/item/${id}/status`, { status: "draft" })).body.item.status).toBe("draft");
  });

  it("keeps unverified school questions out of play", async () => {
    const school = { ...question, category: "nshs-history", prompt: "In what year was the gym renovated?" };
    const created = await t.request("POST", "/api/admin/content/trivia", { data: school });
    const id = created.body.item.id;
    const refused = await t.request("POST", `/api/admin/item/${id}/status`, { status: "approved" });
    expect(refused.status).toBe(400);
    expect(refused.body.validation.errors.length).toBeGreaterThan(0);
    await t.request("PUT", `/api/admin/item/${id}`, { verification: { status: "verified", sources: ["Interview with the athletic director, Oct 2026"] } });
    expect((await t.request("POST", `/api/admin/item/${id}/status`, { status: "approved" })).status).toBe(200);
  });

  it("never serves drafts or archived content", async () => {
    const draft = await t.request("POST", "/api/admin/content/word", { data: { answer: "pixel" } });
    // Archive every other word.
    t.ctx.db.run("UPDATE content_items SET status = 'archived' WHERE type = 'word' AND id != ?", [draft.body.item.id]);
    const none = await t.request("POST", "/api/play/sessions", { game: "word", mode: "practice" });
    expect(none.status).toBe(409);
    expect(none.body.code).toBe("no_content");
    await t.request("POST", `/api/admin/item/${draft.body.item.id}/status`, { status: "approved" });
    await t.request("POST", `/api/admin/item/${draft.body.item.id}/status`, { status: "published" });
    const s = await t.request("POST", "/api/play/sessions", { game: "word", mode: "practice" });
    expect(sessionState(t, s.body.sessionId).answer).toBe("pixel");
  });

  it("imports JSON and CSV as drafts and reports bad records", async () => {
    const json = await t.request("POST", "/api/admin/content/word/import", { format: "json", records: [{ data: { answer: "fjord" } }, { data: { answer: "toolong" } }] });
    expect(json.body.created).toHaveLength(1);
    expect(json.body.errors).toHaveLength(1);
    const csv = [
      "category,difficulty,prompt,choice_a,choice_b,choice_c,choice_d,correct,explanation,source",
      'science,1,"How many planets orbit the Sun?",Seven,Eight,Nine,Ten,B,"Pluto was reclassified in 2006.",https://science.nasa.gov',
      "science,1,Broken row,A,A,B,C,A,,",
    ].join("\n");
    const r = await t.request("POST", "/api/admin/content/trivia/import", { format: "csv", text: csv });
    expect(r.body.created).toHaveLength(2);
    const items = t.ctx.db.all<{ status: string }>("SELECT status FROM content_items WHERE id IN (" + r.body.created.map(() => "?").join(",") + ")", r.body.created);
    expect(items.every((i) => i.status === "draft")).toBe(true);
    // The broken row imports as a draft but can't be approved.
    const approve = await t.request("POST", `/api/admin/item/${r.body.created[1]}/status`, { status: "approved" });
    expect(approve.status).toBe(400);
  });

  it("exports content and gives preview tokens that never rank", async () => {
    const ex = await t.request("GET", "/api/admin/content/connections/export");
    expect(ex.body.records.length).toBeGreaterThanOrEqual(40);
    const draft = await t.request("POST", "/api/admin/content/connections", { data: ex.body.records[0].data });
    const tok = await t.request("POST", `/api/admin/item/${draft.body.item.id}/preview`);
    const s = await t.request("POST", "/api/play/preview", { token: tok.body.token }, { ip: "192.168.4.4" });
    expect(s.status).toBe(201);
    expect(s.body.mode).toBe("preview");
    const groups = sessionState(t, s.body.sessionId).puzzle.groups;
    const act = makeActor(t, s.body.sessionId);
    let last;
    for (const g of groups) last = await act("submit", { tiles: g.members }, { ip: "192.168.4.4" });
    expect(last!.body.result.eligible).toBe(false);
    expect((await t.request("POST", "/api/play/preview", { token: "bogus" })).status).toBe(403);
  });
});

describe("moderation, settings, and system", () => {
  beforeEach(async () => {
    await signInAdmin(t);
  });

  async function claimRanked(nickname: string) {
    const s = await t.request("POST", "/api/play/sessions", { game: "word", mode: "ranked" });
    const answer = sessionState(t, s.body.sessionId).answer;
    t.ctx.db.run("UPDATE game_sessions SET started_at = started_at - 10000 WHERE id = ?", [s.body.sessionId]);
    await makeActor(t, s.body.sessionId)("guess", { word: answer });
    await t.request("POST", `/api/play/sessions/${s.body.sessionId}/claim`, { nickname });
  }

  it("hides, restores, resets a day, and exports", async () => {
    await claimRanked("Bold Otter 12");
    await claimRanked("Calm Heron 34");
    const list = await t.request("GET", "/api/admin/leaderboard");
    expect(list.body.entries).toHaveLength(2);
    const target = list.body.entries.find((e: { nickname: string }) => e.nickname === "Bold Otter 12");
    await t.request("POST", `/api/admin/leaderboard/${target.id}/hide`, { reason: "test" });
    let board = await t.request("GET", "/api/leaderboards?period=today&game=word");
    expect(board.body.rows.map((r: { nickname: string }) => r.nickname)).toEqual(["Calm Heron 34"]);
    await t.request("POST", `/api/admin/leaderboard/${target.id}/unhide`);
    board = await t.request("GET", "/api/leaderboards?period=today&game=word");
    expect(board.body.rows).toHaveLength(2);

    const day = list.body.entries[0].day;
    expect((await t.request("POST", "/api/admin/leaderboard/reset-day", { day, currentPassword: "wrong" })).status).toBe(403);
    const reset = await t.request("POST", "/api/admin/leaderboard/reset-day", { day, currentPassword: TEST_PASSWORD });
    expect(reset.body.hidden).toBe(2);
    expect((await t.request("GET", "/api/leaderboards?period=today&game=word")).body.rows).toHaveLength(0);
    // Entries are kept for the record.
    expect(t.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM leaderboard_entries")!.n).toBe(2);

    const csv = await t.request("GET", "/api/admin/leaderboard/export.csv");
    expect(String(csv.body)).toContain("Calm Heron 34");
  });

  it("validates and saves settings, then tells the kiosk", async () => {
    const received: string[] = [];
    const off = t.ctx.kiosk.subscribe((cmd) => received.push(cmd.type));
    const s = (await t.request("GET", "/api/admin/settings")).body;
    s.idle.timeoutSeconds = 30;
    s.idle.warningSeconds = 60;
    expect((await t.request("PUT", "/api/admin/settings", s)).status).toBe(400);
    s.idle.warningSeconds = 10;
    s.attract.headlines = ["Can you beat the library?"];
    const ok = await t.request("PUT", "/api/admin/settings", s);
    expect(ok.status).toBe(200);
    expect((await t.request("GET", "/api/kiosk/config")).body.idle.timeoutSeconds).toBe(30);
    expect(received).toContain("config");
    off();
  });

  it("backs up and restores with safeguards", async () => {
    await claimRanked("Bold Otter 12");
    const backup = await t.request("POST", "/api/admin/system/backups");
    expect(backup.status).toBe(201);
    await claimRanked("Calm Heron 34");
    expect(t.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM leaderboard_entries")!.n).toBe(2);

    const noConfirm = new FormData();
    noConfirm.append("name", backup.body.name);
    noConfirm.append("currentPassword", TEST_PASSWORD);
    expect((await t.request("POST", "/api/admin/system/restore", undefined, { form: noConfirm })).status).toBe(400);

    const bogusPath = join(t.dataDir, "not-a-db.sqlite");
    writeFileSync(bogusPath, "hello");
    const bad = new FormData();
    bad.append("file", new File([new Uint8Array(Buffer.from("definitely not sqlite"))], "x.sqlite"));
    bad.append("currentPassword", TEST_PASSWORD);
    bad.append("confirm", "RESTORE");
    expect((await t.request("POST", "/api/admin/system/restore", undefined, { form: bad })).status).toBe(400);

    const form = new FormData();
    form.append("name", backup.body.name);
    form.append("currentPassword", TEST_PASSWORD);
    form.append("confirm", "RESTORE");
    const restored = await t.request("POST", "/api/admin/system/restore", undefined, { form });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body.safetyBackup).toMatch(/pre-restore/);
    expect(t.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM leaderboard_entries")!.n).toBe(1);
    // Still signed in after restore (the backup includes the admin), and the app keeps working.
    expect((await t.request("GET", "/api/admin/overview")).status).toBe(200);
    expect((await t.request("POST", "/api/play/sessions", { game: "connections", mode: "practice" })).status).toBe(201);
  });

  it("reports diagnostics and never claims unavailable restarts", async () => {
    const d = await t.request("GET", "/api/admin/system/diagnostics");
    expect(d.body.database.schemaVersion).toBe(1);
    expect(d.body.capabilities.serverRestart).toBe(false);
    expect((await t.request("POST", "/api/admin/system/restart", { currentPassword: TEST_PASSWORD })).status).toBe(501);
    expect((await t.request("POST", "/api/admin/kiosk/restart-browser")).status).toBe(501);
    expect(JSON.stringify(d.body)).not.toContain(t.dataDir);
  });

  it("purges old gameplay records but keeps leaderboard entries", async () => {
    await claimRanked("Bold Otter 12");
    t.ctx.db.run("UPDATE game_sessions SET started_at = started_at - 400 * 86400000");
    const r = await t.request("POST", "/api/admin/system/purge", { olderThanDays: 365, currentPassword: TEST_PASSWORD });
    expect(r.body.sessions).toBeGreaterThan(0);
    expect(t.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM leaderboard_entries")!.n).toBe(1);
  });
});

describe("persistence", () => {
  it("keeps scores and settings across a restart", async () => {
    await signInAdmin(t);
    const s = await t.request("POST", "/api/play/sessions", { game: "word", mode: "ranked" });
    const answer = sessionState(t, s.body.sessionId).answer;
    t.ctx.db.run("UPDATE game_sessions SET started_at = started_at - 10000 WHERE id = ?", [s.body.sessionId]);
    await makeActor(t, s.body.sessionId)("guess", { word: answer });
    await t.request("POST", `/api/play/sessions/${s.body.sessionId}/claim`, { nickname: "Noble Lynx 77" });
    const before = t.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM content_items")!.n;
    t.close();

    const again = makeApp({}, t.dataDir);
    const board = await again.request("GET", "/api/leaderboards?period=all&game=word");
    expect(board.body.rows[0].nickname).toBe("Noble Lynx 77");
    // Re-seeding doesn't duplicate content.
    expect(again.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM content_items")!.n).toBe(before);
    t = again;
  });
});
