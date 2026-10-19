/** Wildcat Word: five letters, six tries. */

export const WORD_LENGTH = 5;
export const WORD_MAX_GUESSES = 6;

export type LetterState = "correct" | "present" | "absent";

/**
 * Scores a guess against the answer. Duplicates are handled the standard way:
 * exact matches claim their letters first, then remaining copies of a letter
 * are marked present left to right until the answer runs out of that letter.
 */
export function evaluateGuess(answer: string, guess: string): LetterState[] {
  const a = answer.toLowerCase();
  const g = guess.toLowerCase();
  if (a.length !== WORD_LENGTH || g.length !== WORD_LENGTH) {
    throw new Error("Answer and guess must both be five letters");
  }
  const result: LetterState[] = new Array(WORD_LENGTH).fill("absent");
  const remaining = new Map<string, number>();
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (g[i] === a[i]) {
      result[i] = "correct";
    } else {
      remaining.set(a[i], (remaining.get(a[i]) ?? 0) + 1);
    }
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === "correct") continue;
    const left = remaining.get(g[i]) ?? 0;
    if (left > 0) {
      result[i] = "present";
      remaining.set(g[i], left - 1);
    }
  }
  return result;
}

const RANK: Record<LetterState, number> = { absent: 0, present: 1, correct: 2 };

/** Folds evaluated rows into per-key keyboard hints; a key never gets "worse". */
export function keyboardStates(rows: { guess: string; result: LetterState[] }[]): Record<string, LetterState> {
  const keys: Record<string, LetterState> = {};
  for (const row of rows) {
    for (let i = 0; i < row.guess.length; i++) {
      const letter = row.guess[i].toLowerCase();
      const state = row.result[i];
      const prev = keys[letter];
      if (!prev || RANK[state] > RANK[prev]) keys[letter] = state;
    }
  }
  return keys;
}

export function normalizeGuess(input: string): string {
  return input.trim().toLowerCase();
}

export function isWellFormedGuess(input: string): boolean {
  return /^[a-z]{5}$/.test(normalizeGuess(input));
}

export interface WordScoreInput {
  solved: boolean;
  guesses: number;
  durationMs: number;
}

/**
 * Score out of 1000. Each guess after the first costs 100, so efficiency matters
 * most; time only shaves up to 100 more, starting after a 30-second grace period
 * (one point per three seconds), so nobody is rewarded for frantic typing.
 */
export function scoreWord({ solved, guesses, durationMs }: WordScoreInput): number {
  if (!solved) return 0;
  const seconds = durationMs / 1000;
  const timePenalty = Math.min(100, Math.max(0, Math.floor((seconds - 30) / 3)));
  return Math.max(100, 1000 - (guesses - 1) * 100 - timePenalty);
}
