import type { GameSession } from "../lib/api.ts";
import type { GameLaunch } from "./useGameSession.ts";

export interface GameProps {
  launch: GameLaunch;
  onHome: () => void;
  onLeaderboard: () => void;
  /** Reports the in-progress session (or null) so a board reset can abandon it. */
  onSession: (session: GameSession | null) => void;
}
