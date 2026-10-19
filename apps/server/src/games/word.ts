import {
  evaluateGuess,
  isWellFormedGuess,
  normalizeGuess,
  scoreWord,
  WORD_MAX_GUESSES,
  type LetterState,
  type WordData,
  type WordGuessResult,
} from "@wildcat/shared";
import { pickFresh, previewItem } from "./selection.ts";
import { GameError, type GameEngine } from "./types.ts";

export interface WordState {
  answer: string;
  rows: { guess: string; result: LetterState[] }[];
  status: "playing" | "won" | "lost";
}

/** Solving a ranked Word faster than this is treated as implausible. */
const MIN_RANKED_SOLVE_MS = 3000;

export const wordEngine: GameEngine<WordState> = {
  start(ctx) {
    const item =
      ctx.mode === "preview"
        ? previewItem(ctx.app, "word", ctx.contentId)
        : pickFresh(ctx.app, "word", ctx.rng, ctx.visitId, { rankedOnly: ctx.ranked });
    return {
      state: { answer: (item.data as WordData).answer, rows: [], status: "playing" },
      contentIds: [item.id],
      puzzle: { game: "word", length: 5, maxGuesses: 6 },
    };
  },

  act(state, action, ctx) {
    if (action.type !== "guess") throw new GameError("Unknown action");
    if (state.status !== "playing") throw new GameError("This game is over", 409, "finished");
    const raw = typeof (action.payload as { word?: unknown })?.word === "string" ? (action.payload as { word: string }).word : "";
    const guess = normalizeGuess(raw);
    if (!isWellFormedGuess(guess)) {
      const response: WordGuessResult = { kind: "guess", valid: false, reason: "Five letters, please", status: "playing" };
      return { state, response };
    }
    if (!ctx.app.dictionary.isValidGuess(guess, new Set([state.answer]))) {
      const response: WordGuessResult = { kind: "guess", valid: false, reason: "Not in word list", status: "playing" };
      return { state, response };
    }
    const result = evaluateGuess(state.answer, guess);
    const rows = [...state.rows, { guess, result }];
    const won = result.every((r) => r === "correct");
    const status: WordState["status"] = won ? "won" : rows.length >= WORD_MAX_GUESSES ? "lost" : "playing";
    const next: WordState = { ...state, rows, status };
    const response: WordGuessResult = {
      kind: "guess",
      valid: true,
      result,
      guessIndex: rows.length - 1,
      status,
      answer: status === "lost" ? state.answer.toUpperCase() : undefined,
    };
    if (status === "playing") return { state: next, response };
    const durationMs = ctx.now - (ctx.startedAt ?? ctx.now);
    return {
      state: next,
      response,
      finish: {
        won,
        completed: true,
        score: scoreWord({ solved: won, guesses: rows.length, durationMs }),
        stats: { guesses: rows.length, solved: won, answer: state.answer.toUpperCase() },
        invalid: won && ctx.ranked && durationMs < MIN_RANKED_SOLVE_MS ? "implausibly-fast-solve" : undefined,
      },
    };
  },

  giveUp(state) {
    const next: WordState = { ...state, status: "lost" };
    const response: WordGuessResult = { kind: "guess", valid: true, status: "lost", answer: state.answer.toUpperCase() };
    return {
      state: next,
      response,
      finish: { won: false, completed: false, score: 0, stats: { guesses: state.rows.length, solved: false, answer: state.answer.toUpperCase(), revealed: true } },
    };
  },
};
