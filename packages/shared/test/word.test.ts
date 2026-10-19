import { describe, expect, it } from "vitest";
import { evaluateGuess, isWellFormedGuess, keyboardStates, scoreWord } from "../src/word.ts";

describe("evaluateGuess", () => {
  it("marks exact, present, and absent letters", () => {
    expect(evaluateGuess("crane", "trace")).toEqual(["absent", "correct", "correct", "present", "correct"]);
  });

  it("does not over-count duplicate guess letters", () => {
    // Answer has one E; only the correct-position E scores.
    expect(evaluateGuess("crane", "geese")).toEqual(["absent", "absent", "absent", "absent", "correct"]);
    // One E in the answer, two in the guess, neither in place: only the first is present.
    expect(evaluateGuess("adept", "eerie")).toEqual(["present", "absent", "absent", "absent", "absent"]);
  });

  it("credits duplicates when the answer has them", () => {
    expect(evaluateGuess("sleep", "eerie")).toEqual(["present", "present", "absent", "absent", "absent"]);
    expect(evaluateGuess("allay", "llama")).toEqual(["present", "correct", "present", "absent", "present"]);
  });

  it("prefers the exact match over an earlier misplaced copy", () => {
    expect(evaluateGuess("abbey", "babes")).toEqual(["present", "present", "correct", "correct", "absent"]);
    expect(evaluateGuess("hello", "lolly")).toEqual(["absent", "present", "correct", "correct", "absent"]);
  });

  it("is case-insensitive and rejects wrong lengths", () => {
    expect(evaluateGuess("CRANE", "crane")).toEqual(Array(5).fill("correct"));
    expect(() => evaluateGuess("crane", "cranes")).toThrow();
  });
});

describe("keyboardStates", () => {
  it("never downgrades a key", () => {
    const keys = keyboardStates([
      { guess: "crane", result: evaluateGuess("trace", "crane") },
      { guess: "trace", result: evaluateGuess("trace", "trace") },
    ]);
    expect(keys.c).toBe("correct");
    expect(keys.n).toBe("absent");
    expect(keys.t).toBe("correct");
  });
});

describe("guess validation and scoring", () => {
  it("accepts only five letters", () => {
    expect(isWellFormedGuess("Crane ")).toBe(true);
    expect(isWellFormedGuess("cran")).toBe(false);
    expect(isWellFormedGuess("cr4ne")).toBe(false);
  });

  it("rewards efficiency over speed", () => {
    expect(scoreWord({ solved: true, guesses: 1, durationMs: 10_000 })).toBe(1000);
    expect(scoreWord({ solved: true, guesses: 3, durationMs: 20_000 })).toBe(800);
    // Time penalty starts after 30 s and caps at 100.
    expect(scoreWord({ solved: true, guesses: 3, durationMs: 60_000 })).toBe(790);
    expect(scoreWord({ solved: true, guesses: 6, durationMs: 10 * 60_000 })).toBe(400);
    expect(scoreWord({ solved: false, guesses: 6, durationMs: 1000 })).toBe(0);
  });
});
