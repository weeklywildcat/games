import { describe, expect, it } from "vitest";
import { applyTriviaAnswer, initialTriviaState, triviaAnswerPoints } from "../src/trivia.ts";
import { createDeck, flip, initialMatchState, matchAccuracy, replayMatch, resolveMiss, scoreMatch } from "../src/match.ts";
import { rushPoints } from "../src/rush.ts";

describe("trivia scoring", () => {
  it("awards base, speed, and streak points", () => {
    expect(triviaAnswerPoints({ correct: true, streak: 1, answerMs: 2000, timed: true })).toBe(80);
    expect(triviaAnswerPoints({ correct: true, streak: 1, answerMs: 12_000, timed: true })).toBe(60);
    expect(triviaAnswerPoints({ correct: true, streak: 5, answerMs: 2000, timed: true })).toBe(100);
    expect(triviaAnswerPoints({ correct: true, streak: 9, answerMs: 2000, timed: true })).toBe(100);
    expect(triviaAnswerPoints({ correct: true, streak: 3, answerMs: 1000, timed: false })).toBe(70);
    expect(triviaAnswerPoints({ correct: false, streak: 0, answerMs: 1000, timed: true })).toBe(0);
  });

  it("builds and breaks streaks", () => {
    let s = initialTriviaState();
    for (const correct of [true, true, true, false, true]) s = applyTriviaAnswer(s, correct, 3000, true).state;
    expect(s.streak).toBe(1);
    expect(s.bestStreak).toBe(3);
    expect(s.correct).toBe(4);
    expect(s.index).toBe(5);
    expect(s.clockUsedMs).toBe(15_000);
  });
});

describe("mini match", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];

  it("deals six distinct pairs, deterministically", () => {
    const deck = createDeck(ids, 7);
    expect(deck).toHaveLength(12);
    const counts = new Map<string, number>();
    for (const c of deck) counts.set(c.itemId, (counts.get(c.itemId) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    expect(counts.size).toBe(6);
    expect(createDeck(ids, 7)).toEqual(deck);
    expect(() => createDeck(["a", "b"], 1)).toThrow();
  });

  it("locks the board while a miss is showing and ignores repeat taps", () => {
    const deck = [
      { index: 0, itemId: "a" },
      { index: 1, itemId: "b" },
      { index: 2, itemId: "a" },
      { index: 3, itemId: "b" },
    ];
    let s = initialMatchState(deck);
    s = flip(s, 0).state;
    expect(flip(s, 0).outcome).toEqual({ kind: "ignored", reason: "open" });
    const miss = flip(s, 1);
    expect(miss.outcome.kind).toBe("miss");
    s = miss.state;
    expect(flip(s, 2).outcome).toEqual({ kind: "ignored", reason: "locked" });
    s = resolveMiss(s);
    s = flip(s, 0).state;
    const hit = flip(s, 2);
    expect(hit.outcome.kind).toBe("match");
    s = hit.state;
    expect(flip(s, 0).outcome).toEqual({ kind: "ignored", reason: "matched" });
    expect(s.attempts).toBe(2);
  });

  it("replays legitimate logs and rejects impossible ones", () => {
    const deck = createDeck(ids, 99);
    const positions = new Map<string, number[]>();
    for (const c of deck) positions.set(c.itemId, [...(positions.get(c.itemId) ?? []), c.index]);
    const perfect: [number, number][] = [];
    let t = 0;
    for (const [a, b] of positions.values()) {
      perfect.push([a, (t += 400)], [b, (t += 400)]);
    }
    expect(replayMatch(deck, perfect)).toEqual({ ok: true, attempts: 6 });
    expect(replayMatch(deck, perfect.slice(0, -1)).reason).toBe("incomplete");
    expect(replayMatch(deck, perfect.map(([i], k) => [i, k * 10] as [number, number])).reason).toBe("too-fast");
    expect(replayMatch(deck, [[0, 100], [0, 600]]).ok).toBe(false);
  });

  it("scores attempts and time", () => {
    expect(scoreMatch({ attempts: 6, durationMs: 18_000 })).toBe(1000);
    expect(scoreMatch({ attempts: 10, durationMs: 40_000 })).toBe(1000 - 240 - 80);
    expect(scoreMatch({ attempts: 40, durationMs: 600_000 })).toBe(100);
    expect(matchAccuracy(12)).toBe(0.5);
  });
});

describe("rush scoring", () => {
  it("adds capped streak bonuses", () => {
    expect(rushPoints(true, 1)).toBe(100);
    expect(rushPoints(true, 3)).toBe(140);
    expect(rushPoints(true, 20)).toBe(200);
    expect(rushPoints(false, 5)).toBe(0);
  });
});
