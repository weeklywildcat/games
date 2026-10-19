import type { CSSProperties } from "react";
import type { GameId } from "@wildcat/shared";

/** Big, simple illustrations of each game, used on home tiles and in attract mode. */
export function GameArt({ game }: { game: GameId }) {
  if (game === "word")
    return (
      <div className="art art-word" aria-hidden="true">
        {"GAMES".split("").map((l, i) => (
          <span key={i} className={i === 0 || i === 3 ? "is-correct" : i === 2 ? "is-present" : ""} style={{ "--i": i } as CSSProperties}>
            {l}
          </span>
        ))}
      </div>
    );
  if (game === "connections")
    return (
      <div className="art art-conn" aria-hidden="true">
        <span className="art-conn-row" />
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
    );
  if (game === "trivia")
    return (
      <div className="art art-trivia" aria-hidden="true">
        <span className="art-buzzer display">?</span>
        <span className="art-answer" />
        <span className="art-answer is-right" />
        <span className="art-answer" />
      </div>
    );
  return (
    <div className="art art-match" aria-hidden="true">
      <span className="art-card is-back" />
      <span className="art-card is-front" />
      <span className="art-card is-front is-pair" />
    </div>
  );
}
