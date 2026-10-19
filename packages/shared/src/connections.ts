import type { ConnectionsData } from "./content.ts";
import { createRng, shuffle } from "./rng.ts";

/** Wildcat Connections: sixteen words, four hidden groups. */

export const CONNECTIONS_MAX_MISTAKES = 4;

export function normalizeTile(word: string): string {
  return word.trim().toUpperCase().replace(/\s+/g, " ");
}

export function allTiles(puzzle: ConnectionsData): string[] {
  return puzzle.groups.flatMap((g) => g.members.map(normalizeTile));
}

export function shuffledTiles(puzzle: ConnectionsData, seed: number): string[] {
  return shuffle(allTiles(puzzle), createRng(seed));
}

export function selectionKey(selection: readonly string[]): string {
  return selection.map(normalizeTile).sort().join("|");
}

export type ConnectionsCheck =
  | { kind: "correct"; groupIndex: number }
  | { kind: "incorrect"; oneAway: boolean }
  | { kind: "duplicate" }
  | { kind: "invalid"; reason: string };

/**
 * Checks a four-tile submission. Repeating an earlier wrong guess is reported as
 * a duplicate and does not cost a mistake.
 */
export function checkSelection(
  puzzle: ConnectionsData,
  solved: readonly number[],
  previousGuesses: readonly string[],
  selection: readonly string[],
): ConnectionsCheck {
  const picked = selection.map(normalizeTile);
  if (picked.length !== 4) return { kind: "invalid", reason: "Select exactly four words" };
  if (new Set(picked).size !== 4) return { kind: "invalid", reason: "Words must be different" };
  const solvedTiles = new Set(solved.flatMap((i) => puzzle.groups[i].members.map(normalizeTile)));
  const universe = new Set(allTiles(puzzle));
  for (const tile of picked) {
    if (!universe.has(tile)) return { kind: "invalid", reason: "Unknown word" };
    if (solvedTiles.has(tile)) return { kind: "invalid", reason: "That word is already in a solved group" };
  }
  if (previousGuesses.includes(selectionKey(picked))) return { kind: "duplicate" };

  let oneAway = false;
  for (let i = 0; i < puzzle.groups.length; i++) {
    if (solved.includes(i)) continue;
    const members = new Set(puzzle.groups[i].members.map(normalizeTile));
    const hits = picked.filter((t) => members.has(t)).length;
    if (hits === 4) return { kind: "correct", groupIndex: i };
    if (hits === 3) oneAway = true;
  }
  return { kind: "incorrect", oneAway };
}

export interface ConnectionsScoreInput {
  solvedGroups: number;
  mistakes: number;
  won: boolean;
}

/**
 * Score out of 1000. A full solve starts at 1000 and loses 100 per mistake;
 * running out of mistakes keeps 150 for each group you did find.
 */
export function scoreConnections({ solvedGroups, mistakes, won }: ConnectionsScoreInput): number {
  if (won) return Math.max(600, 1000 - mistakes * 100);
  return solvedGroups * 150;
}
