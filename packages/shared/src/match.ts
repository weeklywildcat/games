import { createRng, sample, shuffle } from "./rng.ts";

/** Mini Match: twelve cards, six pairs. */

export const MATCH_PAIRS = 6;
export const MATCH_COLUMNS = 4;
export const MATCH_ROWS = 3;
/** Fastest believable flip-to-flip interval when replaying a submitted game. */
export const MATCH_MIN_FLIP_INTERVAL_MS = 120;

export interface MatchCard {
  index: number;
  itemId: string;
}

/** Picks six items from the theme and lays out a shuffled 4×3 grid. */
export function createDeck(itemIds: readonly string[], seed: number, pairs = MATCH_PAIRS): MatchCard[] {
  if (new Set(itemIds).size !== itemIds.length) throw new Error("Theme item ids must be unique");
  if (itemIds.length < pairs) throw new Error(`A theme needs at least ${pairs} items`);
  const rng = createRng(seed);
  const chosen = sample(itemIds, pairs, rng);
  return shuffle([...chosen, ...chosen], rng).map((itemId, index) => ({ index, itemId }));
}

export type MatchPhase = "idle" | "one" | "two" | "done";

export interface MatchState {
  deck: MatchCard[];
  matched: number[];
  /** Cards currently face up and not yet matched (0–2). */
  open: number[];
  attempts: number;
  phase: MatchPhase;
}

export function initialMatchState(deck: MatchCard[]): MatchState {
  return { deck, matched: [], open: [], attempts: 0, phase: "idle" };
}

export type FlipOutcome =
  | { kind: "ignored"; reason: "locked" | "matched" | "open" | "out-of-range" | "done" }
  | { kind: "first" }
  | { kind: "match"; pair: [number, number] }
  | { kind: "miss"; pair: [number, number] };

/**
 * Pure flip reducer. While two unmatched cards are open the board is locked
 * until `resolveMiss` closes them, which makes double-taps and taps during the
 * flip-back animation harmless.
 */
export function flip(state: MatchState, index: number): { state: MatchState; outcome: FlipOutcome } {
  if (state.phase === "done") return { state, outcome: { kind: "ignored", reason: "done" } };
  if (index < 0 || index >= state.deck.length) return { state, outcome: { kind: "ignored", reason: "out-of-range" } };
  if (state.phase === "two") return { state, outcome: { kind: "ignored", reason: "locked" } };
  if (state.matched.includes(index)) return { state, outcome: { kind: "ignored", reason: "matched" } };
  if (state.open.includes(index)) return { state, outcome: { kind: "ignored", reason: "open" } };

  if (state.open.length === 0) {
    return { state: { ...state, open: [index], phase: "one" }, outcome: { kind: "first" } };
  }
  const first = state.open[0];
  const pair: [number, number] = [first, index];
  const attempts = state.attempts + 1;
  if (state.deck[first].itemId === state.deck[index].itemId) {
    const matched = [...state.matched, first, index];
    const done = matched.length === state.deck.length;
    return {
      state: { ...state, matched, open: [], attempts, phase: done ? "done" : "idle" },
      outcome: { kind: "match", pair },
    };
  }
  return { state: { ...state, open: pair, attempts, phase: "two" }, outcome: { kind: "miss", pair } };
}

export function resolveMiss(state: MatchState): MatchState {
  if (state.phase !== "two") return state;
  return { ...state, open: [], phase: "idle" };
}

export interface MatchReplay {
  ok: boolean;
  attempts: number;
  reason?: string;
}

/**
 * Replays a submitted flip log against the server's deck. Each flip is
 * [cardIndex, msSinceStart]. Misses implicitly close before the next flip.
 */
export function replayMatch(deck: MatchCard[], flips: readonly (readonly [number, number])[]): MatchReplay {
  let state = initialMatchState(deck);
  let lastT = -Infinity;
  for (const [index, t] of flips) {
    if (!Number.isFinite(t) || t < 0) return { ok: false, attempts: state.attempts, reason: "bad-timestamp" };
    if (t < lastT) return { ok: false, attempts: state.attempts, reason: "out-of-order" };
    if (t - lastT < MATCH_MIN_FLIP_INTERVAL_MS && Number.isFinite(lastT)) {
      return { ok: false, attempts: state.attempts, reason: "too-fast" };
    }
    lastT = t;
    if (state.phase === "two") state = resolveMiss(state);
    const result = flip(state, index);
    if (result.outcome.kind === "ignored") return { ok: false, attempts: state.attempts, reason: `illegal-${result.outcome.reason}` };
    state = result.state;
  }
  if (state.phase !== "done") return { ok: false, attempts: state.attempts, reason: "incomplete" };
  return { ok: true, attempts: state.attempts };
}

export interface MatchScoreInput {
  attempts: number;
  durationMs: number;
  pairs?: number;
}

/**
 * Score out of 1000. A perfect six-attempt clear inside 20 seconds scores 1000.
 * Each extra attempt costs 60; each second past 20 costs 4 (max 300). Floor 100.
 */
export function scoreMatch({ attempts, durationMs, pairs = MATCH_PAIRS }: MatchScoreInput): number {
  const seconds = durationMs / 1000;
  const timePenalty = Math.min(300, Math.max(0, Math.floor(seconds - 20) * 4));
  return Math.max(100, 1000 - 60 * Math.max(0, attempts - pairs) - timePenalty);
}

export function matchAccuracy(attempts: number, pairs = MATCH_PAIRS): number {
  return attempts === 0 ? 0 : Math.min(1, pairs / attempts);
}
