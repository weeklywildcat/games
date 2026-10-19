/** Trivia Blitz: ten questions, a running clock, and streaks. */

export const TRIVIA_QUESTIONS_PER_ROUND = 10;
export const TRIVIA_DEFAULT_ROUND_SECONDS = 75;
/** Network and rendering slack the server allows on the shared clock. */
export const TRIVIA_CLOCK_TOLERANCE_MS = 1500;

export const TRIVIA_BASE_POINTS = 60;
export const TRIVIA_MAX_SPEED_BONUS = 20;
export const TRIVIA_STREAK_STEP = 5;
export const TRIVIA_MAX_STREAK_BONUS = 20;

export interface TriviaAnswerScoreInput {
  correct: boolean;
  /** Streak including this answer when correct. */
  streak: number;
  answerMs: number;
  timed: boolean;
}

/**
 * Points for one answer (max 100):
 *  - 60 for a correct answer,
 *  - up to 20 for speed in timed play (full at ≤2.5 s, none at ≥10 s),
 *  - 5 per consecutive correct answer beyond the first, capped at 20.
 */
export function triviaAnswerPoints({ correct, streak, answerMs, timed }: TriviaAnswerScoreInput): number {
  if (!correct) return 0;
  const speed = timed ? Math.round(TRIVIA_MAX_SPEED_BONUS * clamp01((10_000 - answerMs) / 7_500)) : 0;
  const streakBonus = Math.min(TRIVIA_MAX_STREAK_BONUS, TRIVIA_STREAK_STEP * Math.max(0, streak - 1));
  return TRIVIA_BASE_POINTS + speed + streakBonus;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export interface TriviaRoundState {
  index: number;
  streak: number;
  bestStreak: number;
  correct: number;
  score: number;
  /** Milliseconds of question-answering time used so far (reveals don't count). */
  clockUsedMs: number;
}

export function initialTriviaState(): TriviaRoundState {
  return { index: 0, streak: 0, bestStreak: 0, correct: 0, score: 0, clockUsedMs: 0 };
}

export function applyTriviaAnswer(
  state: TriviaRoundState,
  correct: boolean,
  answerMs: number,
  timed: boolean,
): { state: TriviaRoundState; points: number } {
  const streak = correct ? state.streak + 1 : 0;
  const points = triviaAnswerPoints({ correct, streak, answerMs, timed });
  return {
    points,
    state: {
      index: state.index + 1,
      streak,
      bestStreak: Math.max(state.bestStreak, streak),
      correct: state.correct + (correct ? 1 : 0),
      score: state.score + points,
      clockUsedMs: state.clockUsedMs + answerMs,
    },
  };
}
