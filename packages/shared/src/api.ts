import type { GameId } from "./content.ts";
import type { LetterState } from "./word.ts";
import type { MatchCard } from "./match.ts";
import type { RushRoundView } from "./rush.ts";

/** Wire types shared by the server and the kiosk. */

export type PlayMode = "ranked" | "practice" | "preview";

export interface MatchItemView {
  id: string;
  label: string;
  icon?: string;
  imageUrl?: string;
  color: string;
}

export type PuzzleView =
  | { game: "word"; length: 5; maxGuesses: 6 }
  | { game: "connections"; tiles: string[]; maxMistakes: number; title?: string }
  | { game: "trivia"; total: number; timed: boolean; roundSeconds: number }
  | { game: "match"; theme: { name: string; back: string }; items: MatchItemView[]; deck: MatchCard[]; columns: number }
  | { game: "rush"; seconds: number };

export interface StartSessionResponse {
  sessionId: string;
  game: GameId;
  mode: PlayMode;
  ranked: boolean;
  puzzle: PuzzleView;
  startedAt: string;
  /** Rush and trivia send their first round with the start response. */
  first?: TriviaQuestionView | RushRoundView;
}

export interface TriviaQuestionView {
  index: number;
  total: number;
  prompt: string;
  choices: string[];
  category: string;
  /** Remaining round clock in ms when timed. */
  remainingMs: number | null;
}

export interface WordGuessResult {
  kind: "guess";
  valid: boolean;
  reason?: string;
  result?: LetterState[];
  guessIndex?: number;
  status: "playing" | "won" | "lost";
  answer?: string;
}

export interface ConnectionsGroupReveal {
  index: number;
  category: string;
  members: string[];
  level: number;
  explanation?: string;
}

export interface ConnectionsSubmitResult {
  kind: "submit";
  outcome: "correct" | "incorrect" | "duplicate" | "invalid";
  oneAway?: boolean;
  reason?: string;
  group?: ConnectionsGroupReveal;
  mistakes: number;
  status: "playing" | "won" | "lost";
  /** All groups, revealed when the game ends. */
  reveal?: ConnectionsGroupReveal[];
}

export interface TriviaAnswerResult {
  kind: "answer";
  correct: boolean;
  correctIndex: number;
  explanation?: string;
  points: number;
  score: number;
  streak: number;
  timedOut: boolean;
  status: "playing" | "finished";
  next?: TriviaQuestionView;
}

export interface RushAnswerResult {
  kind: "rush";
  correct: boolean;
  /** Index of the right choice (or the duplicate pair for "pair" rounds). */
  solution: number[];
  points: number;
  score: number;
  streak: number;
  status: "playing" | "finished";
  remainingMs: number;
  next?: RushRoundView;
}

export interface SessionResult {
  sessionId: string;
  game: GameId;
  mode: PlayMode;
  ranked: boolean;
  completed: boolean;
  won: boolean;
  score: number;
  durationMs: number;
  stats: Record<string, number | string | boolean>;
  /** Server-side rank on today's board if claimed now (null if not eligible). */
  eligible: boolean;
  wouldRankToday: number | null;
  isGameRecord: boolean;
  isDailyBest: boolean;
  claimed: boolean;
  nickname?: string;
}

export interface LeaderboardRow {
  rank: number;
  nickname: string;
  score: number;
  game: GameId;
  day: string;
  durationMs: number;
  createdAt: string;
}

export interface PublicStats {
  day: string;
  solvedToday: number;
  playedToday: number;
  challenge: { enabled: boolean; title: string; target: number; progress: number; start: string; end: string } | null;
  topToday: Partial<Record<GameId, LeaderboardRow[]>>;
  records: Partial<Record<GameId, LeaderboardRow | null>>;
  recent: LeaderboardRow[];
  /** Highest Wildcat Cup total (best score in each core game, summed) this calendar week. */
  weekLeader: { nickname: string; score: number; games: number; start: string; end: string } | null;
}

export type KioskCommand =
  | { type: "attract" }
  | { type: "reload" }
  | { type: "config" }
  | { type: "ping" };

export interface KioskHeartbeat {
  clientId: string;
  screen: "attract" | "home" | "game" | "leaderboard" | "paused" | "quiet" | "preview";
  game?: GameId | null;
  version: string;
  viewport?: { width: number; height: number };
}
