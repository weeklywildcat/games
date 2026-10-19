/** Wildcat Rush: 90 seconds of quick rounds drawn from the existing banks. */

export const RUSH_DEFAULT_SECONDS = 90;
export const RUSH_POINTS = 100;
export const RUSH_STREAK_STEP = 20;
export const RUSH_MAX_STREAK_BONUS = 100;

export type RushRoundKind = "trivia" | "association" | "pair" | "missing-letter";

/** What the player sees. Answers stay on the server. */
export type RushRoundView =
  | { kind: "trivia"; prompt: string; choices: string[]; category: string }
  | { kind: "association"; category: string; clues: string[]; choices: string[] }
  | { kind: "pair"; icons: { icon: string; color: string; label: string }[] }
  | { kind: "missing-letter"; pattern: string; choices: string[] };

/** 100 per correct answer, plus 20 per consecutive correct beyond the first (max +100). */
export function rushPoints(correct: boolean, streak: number): number {
  if (!correct) return 0;
  return RUSH_POINTS + Math.min(RUSH_MAX_STREAK_BONUS, RUSH_STREAK_STEP * Math.max(0, streak - 1));
}

/** Round kinds rotate so every stretch of play mixes formats. */
export function rushKindForIndex(index: number, available: readonly RushRoundKind[], offset = 0): RushRoundKind {
  if (available.length === 0) throw new Error("No Rush round kinds available");
  return available[(index + offset) % available.length];
}
