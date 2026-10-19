import {
  applyTriviaAnswer,
  initialTriviaState,
  shuffle,
  TRIVIA_CATEGORY_LABELS,
  TRIVIA_CLOCK_TOLERANCE_MS,
  TRIVIA_QUESTIONS_PER_ROUND,
  type ContentItem,
  type Rng,
  type TriviaAnswerResult,
  type TriviaData,
  type TriviaQuestionView,
  type TriviaRoundState,
} from "@wildcat/shared";
import type { AppContext } from "../context.ts";
import { freshOrder, pickManyFresh, previewItem, rememberServed } from "./selection.ts";
import { GameError, type EngineContext, type GameEngine } from "./types.ts";

export interface TriviaQuestion {
  id: string;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation?: string;
  category: string;
}

export interface TriviaState {
  questions: TriviaQuestion[];
  index: number;
  timed: boolean;
  roundMs: number;
  /** When the current question appeared on screen (ms epoch). */
  shownAt: number;
  /** Earliest the next question can count as shown (end of the previous answer). */
  floorAt: number;
  round: TriviaRoundState;
  answers: { id: string; choice: number; correct: boolean; ms: number }[];
  status: "playing" | "finished";
}

/** Readers get this long on a reveal if the kiosk never confirms showing the next question. */
const REVEAL_FALLBACK_MS = 2500;
const MIN_ANSWER_MS = 250;

export function toQuestion(item: ContentItem<"trivia">, rng: Rng): TriviaQuestion {
  const d = item.data as TriviaData;
  const order = shuffle([0, 1, 2, 3], rng);
  return {
    id: item.id,
    prompt: d.prompt,
    choices: order.map((i) => d.choices[i]),
    answerIndex: order.indexOf(d.answerIndex),
    explanation: d.explanation,
    category: TRIVIA_CATEGORY_LABELS[d.category] ?? d.category,
  };
}

function view(state: TriviaState, index: number, now: number): TriviaQuestionView {
  const q = state.questions[index];
  return {
    index,
    total: state.questions.length,
    prompt: q.prompt,
    choices: q.choices,
    category: q.category,
    remainingMs: state.timed ? Math.max(0, state.roundMs - state.round.clockUsedMs) : null,
  };
}

/**
 * Ranked rounds: 4 easy, 4 medium, 2 hard questions from the ranked pool,
 * freshest first, so every round is different but similarly hard.
 */
function rankedQuestions(app: AppContext, rng: Rng, visitId: string | null): ContentItem<"trivia">[] {
  const ordered = freshOrder(app, "trivia", rng, visitId, { rankedOnly: true });
  if (ordered.length < TRIVIA_QUESTIONS_PER_ROUND) throw new GameError("Not enough ranked questions are published", 409, "no_ranked_content");
  const take = (n: number, ok: (d: number) => boolean, used: Set<string>) => ordered.filter((q) => ok(q.difficulty) && !used.has(q.id)).slice(0, n);
  const used = new Set<string>();
  const picked: ContentItem<"trivia">[] = [];
  for (const [n, ok] of [
    [4, (d: number) => d <= 1],
    [4, (d: number) => d === 2],
    [2, (d: number) => d >= 3],
  ] as const) {
    for (const q of take(n, ok, used)) {
      picked.push(q);
      used.add(q.id);
    }
  }
  for (const q of ordered) {
    if (picked.length >= TRIVIA_QUESTIONS_PER_ROUND) break;
    if (!used.has(q.id)) {
      picked.push(q);
      used.add(q.id);
    }
  }
  rememberServed("trivia", picked.map((q) => q.id), visitId, ordered.length);
  // Easier questions first so the round ramps up.
  return picked.sort((a, b) => a.difficulty - b.difficulty);
}

function selectQuestions(ctx: EngineContext): ContentItem<"trivia">[] {
  if (ctx.mode === "preview") {
    const item = previewItem(ctx.app, "trivia", ctx.contentId);
    // Preview the chosen question first, then a few published ones for context.
    const filler = pickManyFresh(ctx.app, "trivia", 4, ctx.rng, null).filter((q) => q.id !== item.id);
    return [item, ...filler];
  }
  if (ctx.ranked) return rankedQuestions(ctx.app, ctx.rng, ctx.visitId);
  const picked = pickManyFresh(ctx.app, "trivia", TRIVIA_QUESTIONS_PER_ROUND, ctx.rng, ctx.visitId);
  if (picked.length < TRIVIA_QUESTIONS_PER_ROUND) throw new GameError("Not enough trivia questions are published yet", 409, "no_content");
  return picked;
}

function finishRound(state: TriviaState, timedOut: boolean) {
  const r = state.round;
  return {
    won: r.correct >= Math.ceil(state.questions.length / 2),
    completed: !timedOut && state.index >= state.questions.length,
    score: r.score,
    stats: {
      correct: r.correct,
      total: state.questions.length,
      answered: state.answers.length,
      bestStreak: r.bestStreak,
      accuracy: state.answers.length ? Math.round((r.correct / state.answers.length) * 100) : 0,
      timedOut,
      timed: state.timed,
    },
  };
}

export const triviaEngine: GameEngine<TriviaState> = {
  start(ctx) {
    const items = selectQuestions(ctx);
    const timed = ctx.ranked || ctx.mode === "ranked";
    const roundMs = ctx.app.settings().trivia.roundSeconds * 1000;
    const state: TriviaState = {
      questions: items.map((i) => toQuestion(i, ctx.rng)),
      index: 0,
      timed,
      roundMs,
      shownAt: ctx.now,
      floorAt: ctx.now,
      round: initialTriviaState(),
      answers: [],
      status: "playing",
    };
    return {
      state,
      contentIds: items.map((i) => i.id),
      puzzle: { game: "trivia", total: state.questions.length, timed, roundSeconds: roundMs / 1000 },
      first: view(state, 0, ctx.now),
    };
  },

  act(state, action, ctx) {
    if (state.status !== "playing") throw new GameError("This round is over", 409, "finished");
    const payload = (action.payload ?? {}) as { index?: number; choice?: number };
    if (payload.index !== state.index) throw new GameError("That question has already been answered", 409, "stale");

    if (action.type === "show") {
      // The kiosk confirms the question is on screen; never earlier than the last answer.
      return { state: { ...state, shownAt: Math.max(state.floorAt, Math.min(ctx.now, state.floorAt + 30_000)) }, response: { kind: "shown" } };
    }

    const elapsed = Math.max(0, ctx.now - state.shownAt);
    const clockLeft = state.roundMs - state.round.clockUsedMs;

    if (action.type === "timeout") {
      if (!state.timed) throw new GameError("This round isn't timed");
      if (elapsed + TRIVIA_CLOCK_TOLERANCE_MS < clockLeft) {
        // Kiosk clock ran fast; tell it how much time is really left.
        return { state, response: { kind: "resync", remainingMs: clockLeft - elapsed } };
      }
      const next: TriviaState = { ...state, status: "finished", round: { ...state.round, clockUsedMs: state.roundMs } };
      const q = state.questions[state.index];
      const response: TriviaAnswerResult = {
        kind: "answer",
        correct: false,
        correctIndex: q.answerIndex,
        explanation: q.explanation,
        points: 0,
        score: state.round.score,
        streak: 0,
        timedOut: true,
        status: "finished",
      };
      return { state: next, response, finish: finishRound(next, true) };
    }

    if (action.type !== "answer") throw new GameError("Unknown action");
    const choice = payload.choice;
    if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice > 3) throw new GameError("Pick one of the four answers");
    const q = state.questions[state.index];

    if (state.timed && elapsed > clockLeft + TRIVIA_CLOCK_TOLERANCE_MS) {
      // The clock ran out before this answer arrived.
      const next: TriviaState = { ...state, status: "finished", round: { ...state.round, clockUsedMs: state.roundMs } };
      const response: TriviaAnswerResult = {
        kind: "answer",
        correct: false,
        correctIndex: q.answerIndex,
        explanation: q.explanation,
        points: 0,
        score: state.round.score,
        streak: 0,
        timedOut: true,
        status: "finished",
      };
      return { state: next, response, finish: finishRound(next, true) };
    }

    const answerMs = Math.min(Math.max(elapsed, MIN_ANSWER_MS), state.timed ? Math.max(clockLeft, 0) : elapsed);
    const correct = choice === q.answerIndex;
    const { state: round, points } = applyTriviaAnswer(state.round, correct, answerMs, state.timed);
    const answers = [...state.answers, { id: q.id, choice, correct, ms: Math.round(answerMs) }];
    const index = state.index + 1;
    const done = index >= state.questions.length;
    const next: TriviaState = {
      ...state,
      round,
      answers,
      index,
      status: done ? "finished" : "playing",
      floorAt: ctx.now,
      shownAt: ctx.now + REVEAL_FALLBACK_MS,
    };
    const response: TriviaAnswerResult = {
      kind: "answer",
      correct,
      correctIndex: q.answerIndex,
      explanation: q.explanation,
      points,
      score: round.score,
      streak: round.streak,
      timedOut: false,
      status: done ? "finished" : "playing",
      next: done ? undefined : view(next, index, ctx.now),
    };
    return { state: next, response, finish: done ? finishRound(next, false) : undefined };
  },

  giveUp(state) {
    const next: TriviaState = { ...state, status: "finished" };
    const result = finishRound(next, false);
    return { state: next, response: { kind: "ended" }, finish: { ...result, completed: false, stats: { ...result.stats, gaveUp: true } } };
  },
};
