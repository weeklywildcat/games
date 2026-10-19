import {
  checkSelection,
  CONNECTIONS_MAX_MISTAKES,
  normalizeTile,
  scoreConnections,
  selectionKey,
  shuffledTiles,
  type ConnectionsData,
  type ConnectionsGroupReveal,
  type ConnectionsSubmitResult,
} from "@wildcat/shared";
import { pickFresh, previewItem } from "./selection.ts";
import { GameError, type GameEngine } from "./types.ts";

export interface ConnectionsState {
  puzzle: ConnectionsData;
  solved: number[];
  guesses: string[];
  mistakes: number;
  status: "playing" | "won" | "lost";
}

function reveal(puzzle: ConnectionsData, index: number): ConnectionsGroupReveal {
  const g = puzzle.groups[index];
  return { index, category: g.category, members: g.members.map(normalizeTile), level: g.level, explanation: g.explanation };
}

function remainingReveals(state: ConnectionsState): ConnectionsGroupReveal[] {
  return state.puzzle.groups
    .map((_, i) => i)
    .filter((i) => !state.solved.includes(i))
    .sort((a, b) => state.puzzle.groups[a].level - state.puzzle.groups[b].level)
    .map((i) => reveal(state.puzzle, i));
}

export const connectionsEngine: GameEngine<ConnectionsState> = {
  start(ctx) {
    const item =
      ctx.mode === "preview"
        ? previewItem(ctx.app, "connections", ctx.contentId)
        : pickFresh(ctx.app, "connections", ctx.rng, ctx.visitId, { rankedOnly: ctx.ranked });
    const puzzle = item.data as ConnectionsData;
    return {
      state: { puzzle, solved: [], guesses: [], mistakes: 0, status: "playing" },
      contentIds: [item.id],
      puzzle: { game: "connections", tiles: shuffledTiles(puzzle, ctx.seed), maxMistakes: CONNECTIONS_MAX_MISTAKES, title: puzzle.title },
    };
  },

  act(state, action) {
    if (action.type !== "submit") throw new GameError("Unknown action");
    if (state.status !== "playing") throw new GameError("This game is over", 409, "finished");
    const tiles = (action.payload as { tiles?: unknown })?.tiles;
    if (!Array.isArray(tiles) || !tiles.every((t) => typeof t === "string")) throw new GameError("Send four tiles");
    const check = checkSelection(state.puzzle, state.solved, state.guesses, tiles);

    if (check.kind === "invalid" || check.kind === "duplicate") {
      const response: ConnectionsSubmitResult = {
        kind: "submit",
        outcome: check.kind,
        reason: check.kind === "invalid" ? check.reason : "Already guessed",
        mistakes: state.mistakes,
        status: "playing",
      };
      return { state, response };
    }

    const key = selectionKey(tiles);
    let next: ConnectionsState;
    let response: ConnectionsSubmitResult;
    if (check.kind === "correct") {
      const solved = [...state.solved, check.groupIndex];
      const won = solved.length === state.puzzle.groups.length;
      next = { ...state, solved, guesses: [...state.guesses, key], status: won ? "won" : "playing" };
      response = { kind: "submit", outcome: "correct", group: reveal(state.puzzle, check.groupIndex), mistakes: state.mistakes, status: next.status };
    } else {
      const mistakes = state.mistakes + 1;
      const lost = mistakes >= CONNECTIONS_MAX_MISTAKES;
      next = { ...state, mistakes, guesses: [...state.guesses, key], status: lost ? "lost" : "playing" };
      response = { kind: "submit", outcome: "incorrect", oneAway: check.oneAway, mistakes, status: next.status };
      if (lost) response.reveal = remainingReveals(next);
    }
    if (next.status === "playing") return { state: next, response };
    const won = next.status === "won";
    return {
      state: next,
      response,
      finish: {
        won,
        completed: true,
        score: scoreConnections({ solvedGroups: next.solved.length, mistakes: next.mistakes, won }),
        stats: { groups: next.solved.length, mistakes: next.mistakes, perfect: won && next.mistakes === 0 },
      },
    };
  },

  giveUp(state) {
    const next: ConnectionsState = { ...state, status: "lost" };
    const response: ConnectionsSubmitResult = {
      kind: "submit",
      outcome: "incorrect",
      mistakes: state.mistakes,
      status: "lost",
      reveal: remainingReveals(state),
    };
    return {
      state: next,
      response,
      finish: {
        won: false,
        completed: false,
        score: scoreConnections({ solvedGroups: state.solved.length, mistakes: state.mistakes, won: false }),
        stats: { groups: state.solved.length, mistakes: state.mistakes, revealed: true },
      },
    };
  },
};
