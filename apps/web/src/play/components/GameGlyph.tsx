import type { GameId } from "@wildcat/shared";

/**
 * Small, recognizable marks for each game, drawn with plain shapes so they
 * read from across the room: Word's tile row, Connections' sorted grid,
 * Trivia's buzzer, Match's card pair, Rush's speed bars.
 */
export function GameGlyph({ game, size = "md" }: { game: GameId; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`glyph glyph--${game} glyph-${size}`} aria-hidden="true">
      {game === "word" ? (
        <span className="glyph-word">
          <i className="g-correct">W</i>
          <i className="g-present">I</i>
          <i>L</i>
        </span>
      ) : null}
      {game === "connections" ? (
        <span className="glyph-conn">
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} className={i < 3 ? "g-row" : ""} />
          ))}
        </span>
      ) : null}
      {game === "trivia" ? (
        <span className="glyph-trivia">
          <i>?</i>
        </span>
      ) : null}
      {game === "match" ? (
        <span className="glyph-match">
          <i />
          <i />
        </span>
      ) : null}
      {game === "rush" ? (
        <span className="glyph-rush">
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </span>
  );
}
