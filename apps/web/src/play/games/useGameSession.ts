import { useCallback, useEffect, useRef, useState } from "react";
import type { GameId, PlayMode, StartSessionResponse } from "@wildcat/shared";
import { ApiError, GameSession } from "../lib/api.ts";
import { useVisit } from "../lib/visit.tsx";

export interface GameLaunch {
  mode: PlayMode;
  options?: { timed?: boolean };
  previewToken?: string;
}

/**
 * Starts (and restarts) a server session for a game. The current session is
 * reported upward so the shell can abandon it if the board resets.
 */
export function useGameSession(game: GameId, launch: GameLaunch, onSession: (s: GameSession | null) => void, autoStart = true) {
  const { visit } = useVisit();
  const [session, setSession] = useState<GameSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(autoStart);
  const [round, setRound] = useState(0);
  const current = useRef<GameSession | null>(null);
  const finished = useRef(false);
  const requestId = useRef(0);
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;

  const begin = useCallback(async () => {
    if (current.current && !finished.current) current.current.abandon();
    const myRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    finished.current = false;
    try {
      const s =
        launch.mode === "preview" && launch.previewToken
          ? await GameSession.preview(launch.previewToken)
          : await GameSession.begin(game, launch.mode === "ranked" ? "ranked" : "practice", visit.id, launch.options);
      // A newer start (double tap, StrictMode remount) wins; drop this one.
      if (myRequest !== requestId.current || !mounted.current) {
        s.abandon();
        return;
      }
      current.current = s;
      setSession(s);
      setRound((r) => r + 1);
      onSessionRef.current(s);
    } catch (err) {
      if (myRequest !== requestId.current) return;
      const e = err as ApiError;
      setError(e.status === 0 ? "The arcade server isn't answering. Try again in a moment." : e.message);
      setSession(null);
      onSessionRef.current(null);
    } finally {
      if (myRequest === requestId.current) setLoading(false);
    }
  }, [game, launch.mode, launch.previewToken, launch.options, visit.id]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (autoStart) void begin();
    return () => {
      mounted.current = false;
      requestId.current++;
      if (current.current && !finished.current) current.current.abandon();
      onSessionRef.current(null);
    };
    // Start once per mount; "new puzzle" calls begin() explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markFinished = useCallback(() => {
    finished.current = true;
    current.current?.markClosed();
    onSessionRef.current(null);
  }, []);

  const start: StartSessionResponse | null = session?.start ?? null;
  return { session, start, error, loading, round, begin, markFinished };
}
