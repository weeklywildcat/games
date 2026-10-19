import {
  createDeck,
  MATCH_COLUMNS,
  MATCH_PAIRS,
  matchAccuracy,
  replayMatch,
  scoreMatch,
  type MatchCard,
  type MatchData,
  type MatchItemView,
} from "@wildcat/shared";
import { pickFresh, previewItem } from "./selection.ts";
import { GameError, type ActResult, type GameEngine } from "./types.ts";

export interface MatchState {
  themeId: string;
  deck: MatchCard[];
  status: "playing" | "done";
}

/** Slack between the kiosk's flip clock and the server's session clock. */
const CLOCK_SLACK_MS = 3000;

export function itemViews(data: MatchData): MatchItemView[] {
  return data.items.map((i) => ({ id: i.id, label: i.label, icon: i.icon, imageUrl: i.imageId ? `/uploads/${i.imageId}` : undefined, color: i.color }));
}

/**
 * The kiosk receives the shuffled deck so flips feel instant, then submits its
 * flip log. The server replays the log against the deck it stored, rejecting
 * impossible sequences, and times the game itself.
 */
export const matchEngine: GameEngine<MatchState> = {
  start(ctx) {
    let item;
    if (ctx.mode === "preview") item = previewItem(ctx.app, "match", ctx.contentId);
    else item = pickFresh(ctx.app, "match", ctx.rng, ctx.visitId, { rankedOnly: ctx.ranked });
    const data = item.data as MatchData;
    const deck = createDeck(
      data.items.map((i) => i.id),
      ctx.seed,
      MATCH_PAIRS,
    );
    const used = new Set(deck.map((c) => c.itemId));
    return {
      state: { themeId: item.id, deck, status: "playing" },
      contentIds: [item.id],
      puzzle: {
        game: "match",
        theme: { name: data.name, back: data.back },
        items: itemViews(data).filter((i) => used.has(i.id)),
        deck,
        columns: MATCH_COLUMNS,
      },
    };
  },

  act(state, action, ctx): ActResult<MatchState> {
    if (action.type !== "finish") throw new GameError("Unknown action");
    if (state.status !== "playing") throw new GameError("This game is over", 409, "finished");
    const flips = (action.payload as { flips?: unknown })?.flips;
    if (!Array.isArray(flips) || flips.length > 400) throw new GameError("Send the flip log");
    const log = flips.map((f) => (Array.isArray(f) && f.length === 2 ? [Number(f[0]), Number(f[1])] : [-1, -1])) as [number, number][];
    const replay = replayMatch(state.deck, log);
    const serverMs = ctx.now - (ctx.startedAt ?? ctx.now);
    const lastT = log.length ? log[log.length - 1][1] : 0;
    let invalid = replay.ok ? undefined : `replay-${replay.reason}`;
    if (!invalid && lastT > serverMs + CLOCK_SLACK_MS) invalid = "clock-mismatch";
    const next: MatchState = { ...state, status: "done" };
    const attempts = replay.attempts;
    const response = { kind: "finished", ok: !invalid, attempts };
    if (invalid && !replay.ok) {
      return {
        state: next,
        response,
        finish: { won: false, completed: false, score: 0, stats: { attempts, pairs: MATCH_PAIRS }, invalid },
      };
    }
    return {
      state: next,
      response,
      finish: {
        won: true,
        completed: true,
        score: scoreMatch({ attempts, durationMs: serverMs }),
        stats: { attempts, pairs: MATCH_PAIRS, accuracy: Math.round(matchAccuracy(attempts) * 100), perfect: attempts === MATCH_PAIRS },
        invalid,
      },
    };
  },

  giveUp(state) {
    return {
      state: { ...state, status: "done" },
      response: { kind: "ended" },
      finish: { won: false, completed: false, score: 0, stats: { pairs: MATCH_PAIRS, revealed: true } },
    };
  },
};
