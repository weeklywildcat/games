import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { GameId } from "@wildcat/shared";

/**
 * A "visit" is one person (or group) at the board, from the first touch until
 * the board resets. It remembers a claimed nickname and personal bests so a
 * returning player within the visit doesn't have to pick again. Nothing here is
 * stored beyond the visit.
 */

export interface Visit {
  id: string;
  nickname: string | null;
  bests: Partial<Record<GameId, number>>;
}

interface VisitState {
  visit: Visit;
  newVisit: () => Visit;
  setNickname: (name: string) => void;
  recordScore: (game: GameId, score: number) => { personalBest: boolean };
}

function makeId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const fresh = (): Visit => ({ id: makeId(), nickname: null, bests: {} });
const Ctx = createContext<VisitState | null>(null);

export function VisitProvider({ children }: { children: ReactNode }) {
  const [visit, setVisit] = useState<Visit>(fresh);

  const newVisit = useCallback(() => {
    const v = fresh();
    setVisit(v);
    return v;
  }, []);

  const setNickname = useCallback((name: string) => setVisit((v) => ({ ...v, nickname: name })), []);

  const recordScore = useCallback(
    (game: GameId, score: number) => {
      const prev = visit.bests[game];
      const personalBest = prev === undefined ? score > 0 : score > prev;
      if (personalBest) setVisit((v) => ({ ...v, bests: { ...v.bests, [game]: score } }));
      return { personalBest: personalBest && prev !== undefined };
    },
    [visit.bests],
  );

  const value = useMemo(() => ({ visit, newVisit, setNickname, recordScore }), [visit, newVisit, setNickname, recordScore]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVisit() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVisit outside VisitProvider");
  return v;
}
