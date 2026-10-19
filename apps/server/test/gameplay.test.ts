import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeck } from "@wildcat/shared";
import { calendarWeek } from "../src/leaderboard.ts";
import { destroy, makeActor, makeApp, sessionState, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeEach(() => {
  t = makeApp();
});
afterEach(() => destroy(t));

async function start(game: string, mode = "practice", extra: Record<string, unknown> = {}) {
  const r = await t.request("POST", "/api/play/sessions", { game, mode, visitId: "visit-test-0001", ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

describe("health and config", () => {
  it("reports health and a safe kiosk config", async () => {
    const h = await t.request("GET", "/health");
    expect(h.status).toBe(200);
    expect(h.body.status).toBe("ok");
    const c = await t.request("GET", "/api/kiosk/config");
    expect(c.body.event.start).toBe("2026-10-26");
    expect(c.body.availability.word.ranked).toBe(true);
    // Nothing secret leaks into the public config.
    const text = JSON.stringify(c.body);
    expect(text).not.toMatch(/password|setup|csrf|privacy|retention/i);
  });
});

describe("Wildcat Word", () => {
  it("validates guesses, solves, and scores server-side", async () => {
    const s = await start("word");
    expect(JSON.stringify(s)).not.toContain(sessionState(t, s.sessionId).answer);
    const act = makeActor(t, s.sessionId);
    const answer: string = sessionState(t, s.sessionId).answer;

    const notWord = await act("guess", { word: "qzxqz" });
    expect(notWord.body).toMatchObject({ valid: false, reason: "Not in word list" });

    const wrong = answer === "crane" ? "slate" : "crane";
    const g1 = await act("guess", { word: wrong });
    expect(g1.body.valid).toBe(true);
    expect(g1.body.result).toHaveLength(5);

    const win = await act("guess", { word: answer });
    expect(win.body.status).toBe("won");
    expect(win.body.result.result).toBeUndefined();
    expect(win.body.result.won).toBe(true);
    expect(win.body.result.score).toBe(900);
    expect(win.body.result.eligible).toBe(false); // practice

    const after = await act("guess", { word: answer });
    expect(after.status).toBe(409);
  });

  it("reveals the answer on give-up and after six misses", async () => {
    const s = await start("word");
    const act = makeActor(t, s.sessionId);
    const answer: string = sessionState(t, s.sessionId).answer;
    const r = await act("give-up");
    expect(r.body.answer).toBe(answer.toUpperCase());
    expect(r.body.result.completed).toBe(false);

    const s2 = await start("word");
    const act2 = makeActor(t, s2.sessionId);
    const a2: string = sessionState(t, s2.sessionId).answer;
    const misses = ["crane", "slate", "pious", "dumpy", "glint", "brick", "frond"].filter((w) => w !== a2).slice(0, 6);
    let last;
    for (const w of misses) last = await act2("guess", { word: w });
    expect(last!.body.status).toBe("lost");
    expect(last!.body.answer).toBe(a2.toUpperCase());
  });

  it("answers retries idempotently and rejects out-of-order moves", async () => {
    const s = await start("word");
    const body = { seq: 1, type: "guess", payload: { word: "crane" } };
    const a = await t.request("POST", `/api/play/sessions/${s.sessionId}/actions`, body);
    const b = await t.request("POST", `/api/play/sessions/${s.sessionId}/actions`, body);
    expect(b.body).toEqual(a.body);
    expect(sessionState(t, s.sessionId).rows).toHaveLength(answerIs(t, s.sessionId, "crane") ? 1 : 1);
    const skip = await t.request("POST", `/api/play/sessions/${s.sessionId}/actions`, { seq: 5, type: "guess", payload: { word: "slate" } });
    expect(skip.status).toBe(409);
    expect(skip.body.code).toBe("out_of_sequence");
  });

  it("does not repeat the same practice word for one visitor", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 15; i++) {
      const s = await start("word");
      const a = sessionState(t, s.sessionId).answer;
      expect(seen.has(a)).toBe(false);
      seen.add(a);
    }
  });

  it("gives a different ranked word every play", async () => {
    const answers = [];
    for (let i = 0; i < 25; i++) {
      const s = await start("word", "ranked");
      answers.push(sessionState(t, s.sessionId).answer);
    }
    expect(new Set(answers).size).toBe(25);
  });

  it("gives different ranked Connections puzzles and Match themes every play", async () => {
    const puzzles = new Set<string>();
    const themes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const c = await start("connections", "ranked");
      puzzles.add(JSON.stringify(sessionState(t, c.sessionId).puzzle.groups[0]));
      const m = await start("match", "ranked");
      themes.add(sessionState(t, m.sessionId).themeId);
    }
    expect(puzzles.size).toBe(10);
    expect(themes.size).toBe(10);
  });
});

function answerIs(t: TestApp, id: string, w: string) {
  return sessionState(t, id).answer === w;
}

describe("Connections", () => {
  it("handles correct groups, one-away, and a perfect win", async () => {
    const s = await start("connections");
    expect(s.puzzle.tiles).toHaveLength(16);
    const state = sessionState(t, s.sessionId);
    const act = makeActor(t, s.sessionId);
    const groups: string[][] = state.puzzle.groups.map((g: { members: string[] }) => g.members.map((m) => m.toUpperCase()));

    const oneAway = await act("submit", { tiles: [...groups[0].slice(0, 3), groups[1][0]] });
    expect(oneAway.body).toMatchObject({ outcome: "incorrect", oneAway: true, mistakes: 1 });
    const dup = await act("submit", { tiles: [groups[1][0], ...groups[0].slice(0, 3)] });
    expect(dup.body.outcome).toBe("duplicate");
    expect(dup.body.mistakes).toBe(1);

    let last;
    for (const g of groups) last = await act("submit", { tiles: g });
    expect(last!.body.status).toBe("won");
    expect(last!.body.result.score).toBe(900);
  });

  it("ends after four mistakes and reveals every remaining group", async () => {
    const s = await start("connections");
    const groups: string[][] = sessionState(t, s.sessionId).puzzle.groups.map((g: { members: string[] }) => g.members.map((m) => m.toUpperCase()));
    const act = makeActor(t, s.sessionId);
    const wrongs = [
      [groups[0][0], groups[1][0], groups[2][0], groups[3][0]],
      [groups[0][1], groups[1][1], groups[2][1], groups[3][1]],
      [groups[0][2], groups[1][2], groups[2][2], groups[3][2]],
      [groups[0][3], groups[1][3], groups[2][3], groups[3][3]],
    ];
    let last;
    for (const w of wrongs) last = await act("submit", { tiles: w });
    expect(last!.body.status).toBe("lost");
    expect(last!.body.reveal).toHaveLength(4);
    expect(last!.body.result.score).toBe(0);
  });
});

describe("Trivia Blitz", () => {
  it("plays a ranked round with shuffled choices and server-held answers", async () => {
    const s = await start("trivia", "ranked");
    expect(s.puzzle.timed).toBe(true);
    expect(s.first.choices).toHaveLength(4);
    expect(JSON.stringify(s)).not.toMatch(/answerIndex/);
    const act = makeActor(t, s.sessionId);
    let res;
    for (let i = 0; i < 10; i++) {
      const st = sessionState(t, s.sessionId);
      if (i > 0) await act("show", { index: i });
      res = await act("answer", { index: i, choice: st.questions[i].answerIndex });
      expect(res.body.correct).toBe(true);
    }
    expect(res!.body.status).toBe("finished");
    expect(res!.body.result.stats.correct).toBe(10);
    expect(res!.body.result.stats.bestStreak).toBe(10);
    expect(res!.body.result.score).toBeGreaterThanOrEqual(770);
    expect(res!.body.result.eligible).toBe(true);
  });

  it("rejects stale answers and resyncs an early timeout", async () => {
    const s = await start("trivia", "ranked");
    const act = makeActor(t, s.sessionId);
    const early = await act("timeout", { index: 0 });
    expect(early.body.kind).toBe("resync");
    const stale = await act("answer", { index: 3, choice: 0 });
    expect(stale.status).toBe(409);
  });

  it("offers an untimed practice round", async () => {
    const s = await start("trivia", "practice");
    expect(s.puzzle.timed).toBe(false);
    expect(s.first.remainingMs).toBeNull();
    const timed = await start("trivia", "practice", { options: { timed: true } });
    expect(timed.puzzle.timed).toBe(true);
    expect(timed.ranked).toBe(false);
  });
});

describe("Mini Match", () => {
  it("accepts a legitimate flip log and rejects an impossible one", async () => {
    const s = await start("match");
    expect(s.puzzle.deck).toHaveLength(12);
    const deck = sessionState(t, s.sessionId).deck as { index: number; itemId: string }[];
    expect(s.puzzle.deck).toEqual(deck);
    const pairs = new Map<string, number[]>();
    for (const c of deck) pairs.set(c.itemId, [...(pairs.get(c.itemId) ?? []), c.index]);
    const flips: [number, number][] = [];
    let ms = 0;
    for (const [a, b] of pairs.values()) flips.push([a, (ms += 150)], [b, (ms += 150)]);
    // The server times the game; keep the log within its clock.
    t.ctx.db.run("UPDATE game_sessions SET started_at = started_at - 5000 WHERE id = ?", [s.sessionId]);
    const ok = await makeActor(t, s.sessionId)("finish", { flips });
    expect(ok.body.result.completed).toBe(true);
    expect(ok.body.result.stats.attempts).toBe(6);
    expect(ok.body.result.stats.perfect).toBe(true);

    const s2 = await start("match", "ranked");
    const bad = await makeActor(t, s2.sessionId)("finish", { flips: [[0, 100], [0, 400]] });
    expect(bad.body.result.completed).toBe(false);
    const row = t.ctx.db.get<{ status: string; invalid_reason: string }>("SELECT status, invalid_reason FROM game_sessions WHERE id = ?", [s2.sessionId]);
    expect(row!.status).toBe("invalid");
    expect(row!.invalid_reason).toMatch(/^replay-/);
  });

  it("deals a seeded, reproducible deck", () => {
    expect(createDeck(["a", "b", "c", "d", "e", "f"], 5)).toEqual(createDeck(["a", "b", "c", "d", "e", "f"], 5));
  });
});

describe("Wildcat Rush", () => {
  beforeEach(() => {
    // Rush ships hidden; staff can turn it on.
    const settings = structuredClone(t.ctx.settings());
    settings.games.rush.enabled = true;
    t.ctx.saveSettings(settings);
  });

  it("is hidden by default", async () => {
    const fresh = makeApp();
    expect((await fresh.request("GET", "/api/kiosk/config")).body.games.rush.enabled).toBe(false);
    expect((await fresh.request("POST", "/api/play/sessions", { game: "rush", mode: "ranked" })).status).toBe(423);
    destroy(fresh);
  });

  it("serves mixed rounds and scores streaks", async () => {
    const s = await start("rush", "ranked");
    const act = makeActor(t, s.sessionId);
    const kinds = new Set<string>();
    let res;
    for (let i = 0; i < 8; i++) {
      const st = sessionState(t, s.sessionId);
      const round = st.rounds[i];
      kinds.add(round.view.kind);
      res = await act("answer", round.view.kind === "pair" ? { index: i, pair: round.solution } : { index: i, choice: round.solution[0] });
      expect(res.body.correct, round.view.kind).toBe(true);
    }
    expect(kinds.size).toBe(4);
    expect(res!.body.score).toBe(100 + 120 + 140 + 160 + 180 + 200 + 200 + 200);
    const early = await act("timeout");
    expect(early.body.kind).toBe("resync");
  });

  it("only offers a missing letter round with one valid answer", async () => {
    const s = await start("rush");
    const rounds = sessionState(t, s.sessionId).rounds.filter((r: { view: { kind: string } }) => r.view.kind === "missing-letter");
    for (const r of rounds.slice(0, 10)) {
      const valid = r.view.choices.filter((l: string) => t.ctx.dictionary.isValidGuess(r.view.pattern.replace("_", l).toLowerCase()));
      expect(valid).toEqual([r.view.choices[r.solution[0]]]);
    }
  });
});

describe("claims and leaderboards", () => {
  async function rankedWordWin() {
    const s = await start("word", "ranked");
    const answer = sessionState(t, s.sessionId).answer;
    t.ctx.db.run("UPDATE game_sessions SET started_at = started_at - 10000 WHERE id = ?", [s.sessionId]);
    const r = await makeActor(t, s.sessionId)("guess", { word: answer });
    expect(r.body.result.eligible).toBe(true);
    return { id: s.sessionId as string, result: r.body.result };
  }

  it("claims once with a generated nickname and ranks best-per-name", async () => {
    const names = await t.request("GET", "/api/nicknames");
    expect(names.body.names).toHaveLength(3);
    const a = await rankedWordWin();
    expect(a.result.isGameRecord).toBe(true);
    const claim = await t.request("POST", `/api/play/sessions/${a.id}/claim`, { nickname: names.body.names[0] });
    expect(claim.status).toBe(200);
    expect(claim.body.rank).toBe(1);
    // Retrying the same claim is harmless; a different name is refused.
    expect((await t.request("POST", `/api/play/sessions/${a.id}/claim`, { nickname: names.body.names[0] })).body.duplicate).toBe(true);
    expect((await t.request("POST", `/api/play/sessions/${a.id}/claim`, { nickname: names.body.names[1] })).status).toBe(409);

    const b = await rankedWordWin();
    await t.request("POST", `/api/play/sessions/${b.id}/claim`, { nickname: names.body.names[0] });
    const board = await t.request("GET", "/api/leaderboards?period=today&game=word");
    expect(board.body.rows).toHaveLength(1);
    expect(board.body.rows[0].nickname).toBe(names.body.names[0]);
    const all = await t.request("GET", "/api/leaderboards?period=all");
    expect(all.body.overall[0].nickname).toBe(names.body.names[0]);
  });

  it("refuses typed names, practice scores, and zero scores", async () => {
    const a = await rankedWordWin();
    expect((await t.request("POST", `/api/play/sessions/${a.id}/claim`, { nickname: "Real Name 12" })).status).toBe(400);
    const p = await start("word");
    const ans = sessionState(t, p.sessionId).answer;
    await makeActor(t, p.sessionId)("guess", { word: ans });
    expect((await t.request("POST", `/api/play/sessions/${p.sessionId}/claim`, { nickname: "Bold Otter 12" })).body.code).toBe("not_ranked");
    const z = await start("word", "ranked");
    await makeActor(t, z.sessionId)("give-up");
    expect((await t.request("POST", `/api/play/sessions/${z.sessionId}/claim`, { nickname: "Bold Otter 12" })).status).toBe(409);
  });

  it("marks implausibly fast ranked solves invalid", async () => {
    const s = await start("word", "ranked");
    const answer = sessionState(t, s.sessionId).answer;
    const r = await makeActor(t, s.sessionId)("guess", { word: answer });
    expect(r.body.result.eligible).toBe(false);
    expect((await t.request("POST", `/api/play/sessions/${s.sessionId}/claim`, { nickname: "Bold Otter 12" })).status).toBe(409);
  });

  it("counts solved puzzles toward the community challenge and public stats", async () => {
    const before = await t.request("GET", "/api/stats");
    expect(before.body.weekLeader).toBeNull();
    expect(before.body.challenge).toBeNull(); // off by default
    const settings = structuredClone(t.ctx.settings());
    settings.challenge.enabled = true;
    t.ctx.saveSettings(settings);
    const win = await rankedWordWin();
    await t.request("POST", `/api/play/sessions/${win.id}/claim`, { nickname: "Swift Otter 27" });
    const stats = await t.request("GET", "/api/stats");
    expect(stats.body.solvedToday).toBe(1);
    expect(stats.body.challenge.target).toBe(1000);
    expect(stats.body.weekLeader).toMatchObject({ nickname: "Swift Otter 27", score: win.result.score, games: 1 });
  });

  it("computes Monday-to-Sunday weeks", () => {
    expect(calendarWeek("2026-10-28")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(calendarWeek("2026-10-26")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(calendarWeek("2026-11-01")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
  });
});

describe("network separation", () => {
  it("only lets the play networks start games or drive the kiosk", async () => {
    const r = await t.request("POST", "/api/play/sessions", { game: "word", mode: "ranked" }, { ip: "10.1.2.3" });
    expect(r.status).toBe(403);
    expect((await t.request("POST", "/api/kiosk/heartbeat", { clientId: "x", screen: "home" }, { ip: "192.168.1.50" })).status).toBe(403);
    // Reading the leaderboard is fine from anywhere.
    expect((await t.request("GET", "/api/leaderboards", undefined, { ip: "10.1.2.3" })).status).toBe(200);
  });

  it("respects disabled games and a paused board", async () => {
    const s = structuredClone(t.ctx.settings());
    s.games.match.enabled = false;
    t.ctx.saveSettings(s);
    expect((await t.request("POST", "/api/play/sessions", { game: "match", mode: "practice" })).status).toBe(423);
    s.kiosk.paused = true;
    t.ctx.saveSettings(s);
    expect((await t.request("POST", "/api/play/sessions", { game: "word", mode: "practice" })).body.code).toBe("paused");
  });
});
