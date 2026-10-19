import { shuffle, type ContentItem, type ContentType, type Rng } from "@wildcat/shared";
import type { AppContext } from "../context.ts";
import { getContent, publishedContent } from "../content.ts";
import { GameError } from "./types.ts";

/**
 * Picks puzzles. Every play gets a fresh puzzle: selection is random but steers
 * clear of anything the board showed recently (so the next player doesn't get
 * the word the last one just solved) and anything this visitor already saw.
 * Ranked play draws only from the ranked pool, which editors calibrate for
 * comparable difficulty, so scores stay comparable without repeating puzzles.
 */

const RECENT_GLOBAL = new Map<string, string[]>();
const RECENT_VISIT = new Map<string, { at: number; ids: string[] }>();
const VISIT_TTL_MS = 30 * 60_000;

export function resetSelectionMemory() {
  RECENT_GLOBAL.clear();
  RECENT_VISIT.clear();
}

/** Records that these items were just shown. */
export function rememberServed(type: ContentType, ids: string[], visitId: string | null, poolSize: number) {
  const cap = Math.max(5, Math.floor(poolSize * 0.6));
  RECENT_GLOBAL.set(type, [...(RECENT_GLOBAL.get(type) ?? []), ...ids].slice(-cap));
  if (!visitId) return;
  const now = Date.now();
  const entry = RECENT_VISIT.get(visitId) ?? { at: now, ids: [] };
  entry.at = now;
  entry.ids = [...entry.ids, ...ids].slice(-300);
  RECENT_VISIT.set(visitId, entry);
  if (RECENT_VISIT.size > 500) {
    for (const [k, v] of RECENT_VISIT) if (now - v.at > VISIT_TTL_MS) RECENT_VISIT.delete(k);
  }
}

export interface PickOptions<T extends ContentType> {
  rankedOnly?: boolean;
  filter?: (item: ContentItem<T>) => boolean;
}

/**
 * The eligible pool ordered freshest first: never-recently-seen items in random
 * order, then this visitor's earlier items, then anything shown recently.
 */
export function freshOrder<T extends ContentType>(app: AppContext, type: T, rng: Rng, visitId: string | null, opts: PickOptions<T> = {}): ContentItem<T>[] {
  const all = publishedContent(app, type, opts.rankedOnly).filter(opts.filter ?? (() => true));
  const recent = new Set(RECENT_GLOBAL.get(type) ?? []);
  const seen = new Set(visitId ? (RECENT_VISIT.get(visitId)?.ids ?? []) : []);
  const fresh = all.filter((i) => !recent.has(i.id) && !seen.has(i.id));
  const visitOnly = all.filter((i) => seen.has(i.id) && !recent.has(i.id));
  const stale = all.filter((i) => recent.has(i.id));
  // Within the stale tier, the least recently shown come first.
  const order = RECENT_GLOBAL.get(type) ?? [];
  stale.sort((a, b) => order.lastIndexOf(a.id) - order.lastIndexOf(b.id));
  return [...shuffle(fresh, rng), ...shuffle(visitOnly, rng), ...stale];
}

/** One fresh item. */
export function pickFresh<T extends ContentType>(app: AppContext, type: T, rng: Rng, visitId: string | null, opts: PickOptions<T> = {}): ContentItem<T> {
  const ordered = freshOrder(app, type, rng, visitId, opts);
  if (ordered.length === 0) {
    throw new GameError(opts.rankedOnly ? "No ranked puzzles are published for this game" : "There's no published content for this game yet", 409, opts.rankedOnly ? "no_ranked_content" : "no_content");
  }
  const choice = ordered[0];
  rememberServed(type, [choice.id], visitId, ordered.length);
  return choice;
}

/** Several distinct fresh items (trivia, rush). */
export function pickManyFresh<T extends ContentType>(app: AppContext, type: T, count: number, rng: Rng, visitId: string | null, opts: PickOptions<T> = {}): ContentItem<T>[] {
  const ordered = freshOrder(app, type, rng, visitId, opts);
  const chosen = ordered.slice(0, count);
  rememberServed(type, chosen.map((c) => c.id), visitId, ordered.length);
  return chosen;
}

export function previewItem<T extends ContentType>(app: AppContext, type: T, id: string | undefined): ContentItem<T> {
  if (!id) throw new GameError("Preview needs a content id");
  const item = getContent(app, id);
  if (!item || item.type !== type) throw new GameError("Preview content not found", 404);
  return item as ContentItem<T>;
}

/** Checks whether a mode can start, for the kiosk's game picker. */
export function availability(app: AppContext) {
  const count = (type: ContentType, ranked: boolean) =>
    app.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM content_items WHERE type = ? AND status = 'published' ${ranked ? "AND ranked = 1" : ""}`, [type])?.n ?? 0;
  const has = (type: ContentType, ranked: boolean) => count(type, ranked) > 0;
  const trivia = (ranked: boolean) => count("trivia", ranked) >= 10;
  return {
    word: { practice: has("word", false), ranked: has("word", true) },
    connections: { practice: has("connections", false), ranked: has("connections", true) },
    trivia: { practice: trivia(false), ranked: trivia(true) },
    match: { practice: has("match", false), ranked: has("match", true) },
    rush: { practice: trivia(false) && has("word", false), ranked: trivia(true) && has("word", true) },
  };
}
