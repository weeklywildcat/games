import {
  isMatchIconKey,
  normalizeTile,
  rushPoints,
  sample,
  shuffle,
  TRIVIA_CATEGORY_LABELS,
  type ConnectionsData,
  type MatchData,
  type Rng,
  type RushAnswerResult,
  type RushRoundView,
  type TriviaData,
  type WordData,
} from "@wildcat/shared";
import type { AppContext } from "../context.ts";
import { publishedContent } from "../content.ts";
import { GameError, type GameEngine } from "./types.ts";

interface RushRound {
  view: RushRoundView;
  /** Correct choice index, or the two duplicate indices for "pair". */
  solution: number[];
  contentId: string;
}

export interface RushState {
  endsAt: number;
  rounds: RushRound[];
  index: number;
  score: number;
  streak: number;
  bestStreak: number;
  correct: number;
  answered: number;
  status: "playing" | "finished";
}

const ROUND_BUDGET = 70;
const CLOCK_TOLERANCE_MS = 1500;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function triviaRound(id: string, d: TriviaData, rng: Rng): RushRound {
  const order = shuffle([0, 1, 2, 3], rng);
  return {
    contentId: id,
    view: { kind: "trivia", prompt: d.prompt, choices: order.map((i) => d.choices[i]), category: TRIVIA_CATEGORY_LABELS[d.category] ?? d.category },
    solution: [order.indexOf(d.answerIndex)],
  };
}

/** Show a category and three members; pick the fourth from words in other puzzles. */
function associationRound(id: string, puzzle: ConnectionsData, others: string[], rng: Rng): RushRound | null {
  const group = puzzle.groups[Math.floor(rng() * puzzle.groups.length)];
  const members = shuffle(group.members.map(normalizeTile), rng);
  const answer = members[3];
  const own = new Set(puzzle.groups.flatMap((g) => g.members.map(normalizeTile)));
  const distractors = sample(
    others.filter((w) => !own.has(w)),
    3,
    rng,
  );
  if (distractors.length < 3) return null;
  const choices = shuffle([answer, ...distractors], rng);
  return { contentId: id, view: { kind: "association", category: group.category, clues: members.slice(0, 3), choices }, solution: [choices.indexOf(answer)] };
}

/** Eight icons, exactly one pair: tap both. */
function pairRound(id: string, theme: MatchData, rng: Rng): RushRound | null {
  const items = theme.items.filter((i) => i.icon && isMatchIconKey(i.icon));
  if (items.length < 7) return null;
  const picked = sample(items, 7, rng);
  const tiles = shuffle([...picked, picked[0]], rng);
  const dup = picked[0].id;
  const solution = tiles.map((t, i) => (t.id === dup ? i : -1)).filter((i) => i >= 0);
  return { contentId: id, view: { kind: "pair", icons: tiles.map((t) => ({ icon: t.icon!, color: t.color, label: t.label })) }, solution };
}

/** A five-letter answer with one blank; exactly one offered letter makes a real word. */
function missingLetterRound(app: AppContext, id: string, word: string, rng: Rng): RushRound | null {
  const pos = Math.floor(rng() * 5);
  const right = word[pos];
  const makes = (l: string) => app.dictionary.isValidGuess(word.slice(0, pos) + l + word.slice(pos + 1));
  const wrong = shuffle(LETTERS.split(""), rng).filter((l) => l !== right && !makes(l)).slice(0, 3);
  if (wrong.length < 3) return null;
  const choices = shuffle([right, ...wrong], rng).map((l) => l.toUpperCase());
  const pattern = (word.slice(0, pos) + "_" + word.slice(pos + 1)).toUpperCase();
  return { contentId: id, view: { kind: "missing-letter", pattern, choices }, solution: [choices.indexOf(right.toUpperCase())] };
}

function buildRounds(app: AppContext, ranked: boolean, rng: Rng): RushRound[] {
  const trivia = shuffle(publishedContent(app, "trivia", ranked), rng);
  const conns = shuffle(publishedContent(app, "connections", ranked), rng);
  const themes = shuffle(publishedContent(app, "match", ranked), rng);
  const words = shuffle(publishedContent(app, "word", ranked), rng);
  const allTiles = publishedContent(app, "connections").flatMap((c) => (c.data as ConnectionsData).groups.flatMap((g) => g.members.map(normalizeTile)));
  if (trivia.length < 10 || words.length < 10) throw new GameError("Rush needs more published trivia and words", 409, "no_content");

  let t = 0;
  let c = 0;
  let m = 0;
  let w = 0;
  const kinds = ["trivia", "missing-letter", "association", "pair"] as const;
  const rounds: RushRound[] = [];
  for (let i = 0; rounds.length < ROUND_BUDGET && i < ROUND_BUDGET * 3; i++) {
    const kind = kinds[i % kinds.length];
    let round: RushRound | null = null;
    if (kind === "trivia" && t < trivia.length) {
      const item = trivia[t++];
      round = triviaRound(item.id, item.data as TriviaData, rng);
    } else if (kind === "association" && conns.length) {
      const item = conns[c++ % conns.length];
      round = associationRound(item.id, item.data as ConnectionsData, allTiles, rng);
    } else if (kind === "pair" && themes.length) {
      const item = themes[m++ % themes.length];
      round = pairRound(item.id, item.data as MatchData, rng);
    } else if (kind === "missing-letter" && w < words.length) {
      const item = words[w++];
      round = missingLetterRound(app, item.id, (item.data as WordData).answer, rng);
    }
    if (round) rounds.push(round);
  }
  return rounds;
}

export const rushEngine: GameEngine<RushState> = {
  start(ctx) {
    if (ctx.mode === "preview") throw new GameError("Rush has no preview");
    const seconds = ctx.app.settings().rush.seconds;
    const rounds = buildRounds(ctx.app, ctx.ranked, ctx.rng);
    const state: RushState = {
      endsAt: ctx.now + seconds * 1000,
      rounds,
      index: 0,
      score: 0,
      streak: 0,
      bestStreak: 0,
      correct: 0,
      answered: 0,
      status: "playing",
    };
    return {
      state,
      contentIds: [...new Set(rounds.map((r) => r.contentId))],
      puzzle: { game: "rush", seconds },
      first: rounds[0].view,
    };
  },

  act(state, action, ctx) {
    if (state.status !== "playing") throw new GameError("This run is over", 409, "finished");
    const payload = (action.payload ?? {}) as { index?: number; choice?: number; pair?: number[] };
    const remaining = state.endsAt - ctx.now;
    const finishState = (s: RushState) => ({
      won: s.correct >= 5,
      completed: true,
      score: s.score,
      stats: { correct: s.correct, answered: s.answered, bestStreak: s.bestStreak, accuracy: s.answered ? Math.round((s.correct / s.answered) * 100) : 0 },
    });

    if (action.type === "timeout") {
      if (remaining > CLOCK_TOLERANCE_MS) return { state, response: { kind: "resync", remainingMs: remaining } };
      const next = { ...state, status: "finished" as const };
      return { state: next, response: { kind: "rush", correct: false, solution: [], points: 0, score: state.score, streak: state.streak, status: "finished", remainingMs: 0 }, finish: finishState(next) };
    }
    if (action.type !== "answer") throw new GameError("Unknown action");
    if (payload.index !== state.index) throw new GameError("That round is already done", 409, "stale");
    const round = state.rounds[state.index];

    if (remaining < -CLOCK_TOLERANCE_MS) {
      const next = { ...state, status: "finished" as const };
      const response: RushAnswerResult = { kind: "rush", correct: false, solution: round.solution, points: 0, score: state.score, streak: 0, status: "finished", remainingMs: 0 };
      return { state: next, response, finish: finishState(next) };
    }

    let correct: boolean;
    if (round.view.kind === "pair") {
      const pair = Array.isArray(payload.pair) ? [...payload.pair].map(Number).sort((a, b) => a - b) : [];
      correct = pair.length === 2 && pair[0] === round.solution[0] && pair[1] === round.solution[1];
    } else {
      if (typeof payload.choice !== "number") throw new GameError("Pick an answer");
      correct = payload.choice === round.solution[0];
    }
    const streak = correct ? state.streak + 1 : 0;
    const points = rushPoints(correct, streak);
    const index = state.index + 1;
    const outOfRounds = index >= state.rounds.length;
    const next: RushState = {
      ...state,
      index,
      score: state.score + points,
      streak,
      bestStreak: Math.max(state.bestStreak, streak),
      correct: state.correct + (correct ? 1 : 0),
      answered: state.answered + 1,
      status: outOfRounds ? "finished" : "playing",
    };
    const response: RushAnswerResult = {
      kind: "rush",
      correct,
      solution: round.solution,
      points,
      score: next.score,
      streak,
      status: next.status,
      remainingMs: Math.max(0, remaining),
      next: outOfRounds ? undefined : state.rounds[index].view,
    };
    return { state: next, response, finish: outOfRounds ? finishState(next) : undefined };
  },

  giveUp(state) {
    const next = { ...state, status: "finished" as const };
    return {
      state: next,
      response: { kind: "ended" },
      finish: { won: false, completed: false, score: state.score, stats: { correct: state.correct, answered: state.answered, bestStreak: state.bestStreak, gaveUp: true } },
    };
  },
};
