import { randomBytes } from "node:crypto";
import type { GameId } from "@wildcat/shared";

/**
 * Preview links let an admin play any item (even a draft) on the touchscreen
 * layout. Tokens are random, short-lived, held in memory, and never recorded
 * as scores.
 */

const TTL_MS = 30 * 60_000;
const tokens = new Map<string, { contentId: string; game: GameId; expires: number }>();

export function createPreviewToken(contentId: string, game: GameId): { token: string; expiresAt: string } {
  const now = Date.now();
  for (const [k, v] of tokens) if (v.expires < now) tokens.delete(k);
  const token = randomBytes(18).toString("base64url");
  tokens.set(token, { contentId, game, expires: now + TTL_MS });
  return { token, expiresAt: new Date(now + TTL_MS).toISOString() };
}

/** Tokens are reusable until they expire so the preview can be restarted. */
export function consumePreviewToken(token: string) {
  const entry = tokens.get(token);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    tokens.delete(token);
    return null;
  }
  return entry;
}
