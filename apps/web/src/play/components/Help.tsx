import { Check } from "lucide-react";
import type { GameId, PlayMode } from "@wildcat/shared";
import { GAME_META } from "@wildcat/shared";
import { Btn } from "./Button.tsx";
import { Modal } from "./Modal.tsx";

const RULES: Record<GameId, { steps: string[]; scoring: string }> = {
  word: {
    steps: [
      "Guess the hidden five-letter word. You get six tries.",
      "Type with the on-screen keys, then press Enter.",
      "Tiles change color to show how close you are.",
    ],
    scoring: "1,000 points for a first-try solve, minus 100 for each extra guess. After 30 seconds the clock nibbles off up to 100 more, so think, don't rush.",
  },
  connections: {
    steps: [
      "Find four groups of four words that share something.",
      "Tap four tiles, then Submit. Tap a tile again to deselect it.",
      "Four mistakes and the round ends. Watch for red herrings.",
    ],
    scoring: "Solve all four groups for 1,000 points, minus 100 per mistake. Run out of tries and each group you found is still worth 150.",
  },
  trivia: {
    steps: [
      "Ten questions, four answers each. Tap the one you think is right.",
      "A 75-second clock runs while questions are on screen.",
      "Correct answers in a row build your streak.",
    ],
    scoring: "60 points per correct answer, up to 20 more for speed, and up to 20 more for a streak.",
  },
  match: {
    steps: ["Tap a card to flip it, then tap another to find its match.", "Matches stay face up. Misses flip back after a moment.", "Find all six pairs."],
    scoring: "A perfect six-try clear inside 20 seconds earns 1,000. Each extra try costs 60 and each second after 20 costs 4.",
  },
  rush: {
    steps: [
      "Ninety seconds. Answer as many quick rounds as you can.",
      "Rounds mix trivia, missing letters, word groups, and spot-the-pair.",
      "A wrong answer just resets your streak. Keep going.",
    ],
    scoring: "100 points per correct answer, plus 20 more for each answer in a row (up to +100).",
  },
};

export function HelpModal({ game, mode, open, onClose }: { game: GameId; mode: PlayMode; open: boolean; onClose: () => void }) {
  const rules = RULES[game];
  return (
    <Modal open={open} onClose={onClose} title={`How to play ${GAME_META[game].name}`} size="lg">
      <ol className="help-steps">
        {rules.steps.map((s, i) => (
          <li key={i}>
            <span className="help-num display">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {game === "word" ? (
        <div className="help-legend">
          <span className="legend-tile is-correct">C</span> right letter, right spot
          <span className="legend-tile is-present">A</span> in the word, wrong spot
          <span className="legend-tile is-absent">T</span> not in the word
        </div>
      ) : null}
      <p className="help-scoring">
        <strong className="label">Scoring</strong> {rules.scoring}
      </p>
      <p className="help-mode">
        {mode === "preview"
          ? "This is a staff preview. Nothing here is saved."
          : "Every game is a fresh puzzle of similar difficulty. When you finish, you can put your score on the leaderboard with a generated name. No sign-in, no real names."}
      </p>
      <Btn variant="ink" size="lg" icon={<Check />} onClick={onClose} data-autofocus>
        Got it
      </Btn>
    </Modal>
  );
}
