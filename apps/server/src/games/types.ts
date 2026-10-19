import type { PlayMode, PuzzleView, Rng, RushRoundView, TriviaQuestionView } from "@wildcat/shared";
import type { AppContext } from "../context.ts";

export interface EngineContext {
  app: AppContext;
  mode: PlayMode;
  ranked: boolean;
  day: string;
  now: number;
  seed: number;
  rng: Rng;
  visitId: string | null;
  /** Preview sessions play one specific item regardless of status. */
  contentId?: string;
  /** Set when acting on an existing session. */
  startedAt?: number;
}

export interface Finish {
  won: boolean;
  /** False when the player gave up or timed out without finishing. */
  completed: boolean;
  score: number;
  stats: Record<string, number | string | boolean>;
  /** Marks the result ineligible for leaderboards (with a reason for the audit log). */
  invalid?: string;
}

export interface StartResult<S> {
  state: S;
  contentIds: string[];
  puzzle: PuzzleView;
  first?: TriviaQuestionView | RushRoundView;
}

export interface Action {
  type: string;
  payload?: unknown;
}

export interface ActResult<S> {
  state: S;
  response: unknown;
  finish?: Finish;
}

export interface GameEngine<S> {
  start(ctx: EngineContext): StartResult<S>;
  act(state: S, action: Action, ctx: EngineContext): ActResult<S>;
  giveUp(state: S, ctx: EngineContext): ActResult<S>;
}

export class GameError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "bad_request",
  ) {
    super(message);
  }
}
