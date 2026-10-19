import { CircleHelp, House } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { GAME_META, type GameId, type PlayMode } from "@wildcat/shared";
import { Btn } from "./Button.tsx";
import { GameGlyph } from "./GameGlyph.tsx";

export const GAME_COLOR: Record<GameId, string> = {
  word: "var(--word)",
  connections: "var(--connections)",
  trivia: "var(--trivia)",
  match: "var(--match)",
  rush: "var(--rush)",
};

export const GAME_DEEP: Record<GameId, string> = {
  word: "var(--word-deep)",
  connections: "var(--connections-deep)",
  trivia: "var(--trivia-deep)",
  match: "var(--match-deep)",
  rush: "var(--rush-deep)",
};

/** Every game screen: a consistent top bar with Home, title, mode, Help, and game actions. */
export function GameShell({
  game,
  mode,
  onHome,
  onHelp,
  actions,
  status,
  children,
}: {
  game: GameId;
  mode: PlayMode;
  onHome: () => void;
  onHelp: () => void;
  actions?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`game game-${game}`} style={{ "--c": GAME_COLOR[game], "--c-deep": GAME_DEEP[game] } as CSSProperties}>
      <header className="game-bar">
        <div className="game-bar-left">
          <Btn variant="paper" size="md" icon={<House />} onClick={onHome} aria-label="Home">
            Home
          </Btn>
          <div className="game-title">
            <GameGlyph game={game} size="sm" />
            <div>
              <h1 className="display game-title-name">{GAME_META[game].name}</h1>
              {mode === "preview" ? <span className="mode-chip mode-preview">Preview · not saved</span> : null}
            </div>
          </div>
        </div>
        <div className="game-bar-status">{status}</div>
        <div className="game-bar-right">
          {actions}
          <Btn variant="paper" size="md" icon={<CircleHelp />} onClick={onHelp} aria-label="How to play">
            Help
          </Btn>
        </div>
      </header>
      <main className="game-body">{children}</main>
    </div>
  );
}
