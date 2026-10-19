import { AnimatePresence, motion } from "motion/react";
import { Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { RushAnswerResult, RushRoundView, SessionResult } from "@wildcat/shared";
import { Btn } from "../components/Button.tsx";
import { Celebration, type CelebrationLevel } from "../components/Celebration.tsx";
import { GameShell } from "../components/GameShell.tsx";
import { HelpModal } from "../components/Help.tsx";
import { ScoreBox, Streak, TimeBar } from "../components/Meters.tsx";
import { ResultPanel } from "../components/ResultPanel.tsx";
import { MATCH_ICONS } from "../matchIcons.ts";
import { spring } from "../lib/motion.ts";
import { sfx } from "../lib/sound.ts";
import type { GameProps } from "./types.ts";
import { useGameSession } from "./useGameSession.ts";

const FEEDBACK_MS = 420;
const KIND_LABEL: Record<RushRoundView["kind"], string> = {
  trivia: "Trivia",
  association: "Which word fits?",
  "missing-letter": "Missing letter",
  pair: "Spot the pair",
};

function Choices({ choices, onPick, feedback, big }: { choices: string[]; onPick: (i: number) => void; feedback: { picked: number; solution: number[] } | null; big?: boolean }) {
  return (
    <div className={`rush-choices ${big ? "is-big" : ""}`}>
      {choices.map((c, i) => {
        const state = feedback ? (feedback.solution.includes(i) ? "is-right" : feedback.picked === i ? "is-wrong" : "is-dim") : "";
        return (
          <motion.button key={i} className={`rchoice ${state}`} onClick={() => onPick(i)} disabled={Boolean(feedback)} whileTap={{ scale: 0.95, y: 3 }} transition={spring.tap}>
            {c}
          </motion.button>
        );
      })}
    </div>
  );
}

function PairRound({ round, onPair, feedback }: { round: Extract<RushRoundView, { kind: "pair" }>; onPair: (pair: number[]) => void; feedback: { picked: number; solution: number[] } | null }) {
  const [first, setFirst] = useState<number | null>(null);
  return (
    <div className="rush-pairs">
      {round.icons.map((ic, i) => {
        const Icon = MATCH_ICONS[ic.icon as keyof typeof MATCH_ICONS];
        const state = feedback ? (feedback.solution.includes(i) ? "is-right" : "is-dim") : first === i ? "is-picked" : "";
        return (
          <motion.button
            key={i}
            className={`rpair ${state}`}
            style={{ "--tint": ic.color } as CSSProperties}
            onClick={() => {
              if (feedback) return;
              if (first === null) setFirst(i);
              else if (first === i) setFirst(null);
              else {
                onPair([first, i]);
                setFirst(null);
              }
            }}
            disabled={Boolean(feedback)}
            aria-label={ic.label}
            aria-pressed={first === i}
            whileTap={{ scale: 0.92 }}
            transition={spring.tap}
          >
            {Icon ? <Icon strokeWidth={2.2} /> : null}
          </motion.button>
        );
      })}
    </div>
  );
}

export function RushGame({ launch, onHome, onLeaderboard, onSession }: GameProps) {
  const { session, start, error, loading, begin, markFinished, round: runId } = useGameSession("rush", launch, onSession, false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [current, setCurrent] = useState<RushRoundView | null>(null);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ picked: number; solution: number[] } | null>(null);
  const [score, setScore] = useState(0);
  const [gain, setGain] = useState<{ n: number; key: number } | null>(null);
  const [streak, setStreak] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [final, setFinal] = useState<SessionResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [help, setHelp] = useState(false);
  const [celebrate, setCelebrate] = useState<CelebrationLevel | null>(null);
  const endsAt = useRef(0);
  const timeoutSent = useRef(false);
  const totalMs = (start?.puzzle.game === "rush" ? start.puzzle.seconds : 90) * 1000;

  const ready = useCallback(() => {
    setFinal(null);
    setShowResults(false);
    setCurrent(null);
    setCountdown(3);
  }, []);

  // 3-2-1 before the clock (and the server session) starts.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      void begin();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 800);
    return () => window.clearTimeout(t);
  }, [countdown, begin]);

  useEffect(() => {
    if (!start || start.puzzle.game !== "rush" || !start.first) return;
    setCurrent(start.first as RushRoundView);
    setIndex(0);
    setScore(0);
    setStreak(0);
    setFeedback(null);
    setFinal(null);
    timeoutSent.current = false;
    endsAt.current = performance.now() + start.puzzle.seconds * 1000;
    setRemaining(start.puzzle.seconds * 1000);
  }, [start, runId]);

  const finish = useCallback(
    (res: { result?: SessionResult }) => {
      markFinished();
      if (res.result) {
        setFinal(res.result);
        if (res.result.won) {
          setCelebrate("small");
          window.setTimeout(() => setCelebrate(null), 800);
        }
        window.setTimeout(() => setShowResults(true), 900);
      }
    },
    [markFinished],
  );

  const sendTimeout = useCallback(async () => {
    if (!session || timeoutSent.current || final) return;
    timeoutSent.current = true;
    try {
      const res = await session.act<(RushAnswerResult & { result?: SessionResult }) | { kind: "resync"; remainingMs: number }>("timeout");
      if (res.kind === "resync") {
        timeoutSent.current = false;
        endsAt.current = performance.now() + res.remainingMs;
        return;
      }
      setFeedback(null);
      finish(res);
    } catch {
      timeoutSent.current = false;
    }
  }, [session, final, finish]);

  useEffect(() => {
    if (!current || final) return;
    const t = window.setInterval(() => {
      const left = Math.max(0, endsAt.current - performance.now());
      setRemaining(left);
      if (left <= 0) void sendTimeout();
    }, 100);
    return () => window.clearInterval(t);
  }, [current, final, sendTimeout]);

  const respond = async (payload: { choice?: number; pair?: number[] }, picked: number) => {
    if (!session || !current || feedback || final) return;
    try {
      const res = await session.act<RushAnswerResult & { result?: SessionResult }>("answer", { index, ...payload });
      setFeedback({ picked, solution: res.solution });
      setScore(res.score);
      setStreak(res.streak);
      if (res.correct) {
        sfx.good();
        setGain({ n: res.points, key: Date.now() });
      } else sfx.bad();
      endsAt.current = performance.now() + res.remainingMs;
      window.setTimeout(() => {
        setFeedback(null);
        if (res.status === "finished") finish(res);
        else if (res.next) {
          setCurrent(res.next);
          setIndex((i) => i + 1);
        }
      }, FEEDBACK_MS);
    } catch {
      // A retry happens inside the session client; nothing to undo here.
    }
  };

  const started = Boolean(current) || Boolean(final);

  return (
    <GameShell
      game="rush"
      mode={launch.mode}
      onHome={onHome}
      onHelp={() => setHelp(true)}
      status={started ? <TimeBar remainingMs={final ? 0 : remaining} totalMs={totalMs} /> : <span className="label">Ninety seconds. Everything goes.</span>}
      actions={
        <>
          <ScoreBox score={score} gain={gain?.n} gainKey={gain?.key} />
          <Streak streak={streak} />
          {final ? (
            <Btn variant="paper" icon={<RotateCcw />} onClick={ready}>
              Run it back
            </Btn>
          ) : null}
        </>
      }
    >
      <div className="rush-layout">
        {!started && countdown === null && !loading ? (
          <motion.div className="rush-start" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={spring.panel}>
            <h2 className="display">Ready?</h2>
            <p>Trivia, word groups, missing letters, and spot-the-pair, as fast as you can. Wrong answers just reset your streak.</p>
            <Btn variant="color" color="var(--rush)" size="xl" icon={<Play />} onClick={ready} data-autofocus>
              Start
            </Btn>
          </motion.div>
        ) : null}
        <AnimatePresence>
          {countdown !== null && countdown > 0 ? (
            <motion.div key={countdown} className="rush-count display" initial={{ scale: 2.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={spring.bouncy}>
              {countdown}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <AnimatePresence mode="popLayout">
          {current && !final ? (
            <motion.section
              key={`${runId}-${index}`}
              className={`rush-card kind-${current.kind}`}
              initial={{ opacity: 0, x: 120, rotate: 2 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              exit={{ opacity: 0, x: -120, rotate: -2, transition: { duration: 0.16 } }}
              transition={spring.tile}
            >
              <span className="label rush-kind">{KIND_LABEL[current.kind]}</span>
              {current.kind === "trivia" ? (
                <>
                  <h2 className="rush-prompt">{current.prompt}</h2>
                  <Choices choices={current.choices} feedback={feedback} onPick={(i) => void respond({ choice: i }, i)} />
                </>
              ) : null}
              {current.kind === "association" ? (
                <>
                  <h2 className="rush-prompt">
                    <span className="display rush-cat">{current.category}</span>
                  </h2>
                  <div className="rush-clues">
                    {current.clues.map((c) => (
                      <span key={c} className="rush-clue">
                        {c}
                      </span>
                    ))}
                    <span className="rush-clue is-blank">?</span>
                  </div>
                  <Choices choices={current.choices} feedback={feedback} onPick={(i) => void respond({ choice: i }, i)} />
                </>
              ) : null}
              {current.kind === "missing-letter" ? (
                <>
                  <div className="rush-pattern" aria-label={current.pattern.replace("_", " blank ")}>
                    {current.pattern.split("").map((ch, i) => (
                      <span key={i} className={`rush-ptile display ${ch === "_" ? "is-blank" : ""}`}>
                        {ch === "_" ? (feedback ? current.choices[feedback.solution[0]] : "") : ch}
                      </span>
                    ))}
                  </div>
                  <Choices big choices={current.choices} feedback={feedback} onPick={(i) => void respond({ choice: i }, i)} />
                </>
              ) : null}
              {current.kind === "pair" ? <PairRound round={current} feedback={feedback} onPair={(pair) => void respond({ pair }, -1)} /> : null}
            </motion.section>
          ) : null}
        </AnimatePresence>
        {error ? (
          <div className="game-error" role="alert">
            <p>{error}</p>
            <Btn variant="ink" onClick={ready}>
              Try again
            </Btn>
          </div>
        ) : null}
      </div>
      <Celebration level={celebrate} />
      <HelpModal game="rush" mode={launch.mode} open={help} onClose={() => setHelp(false)} />
      {final && showResults ? (
        <ResultPanel
          game="rush"
          result={final}
          session={session}
          headline={Number(final.stats.correct ?? 0) >= 15 ? "Unstoppable" : Number(final.stats.correct ?? 0) >= 8 ? "Speed demon" : "Run complete"}
          perfect={Number(final.stats.answered ?? 0) >= 10 && final.stats.accuracy === 100}
          stats={[
            { label: "Correct", value: String(final.stats.correct ?? 0) },
            { label: "Accuracy", value: `${String(final.stats.accuracy ?? 0)}%` },
            { label: "Best streak", value: String(final.stats.bestStreak ?? 0) },
          ]}
          againLabel="Run it back"
          onAgain={ready}
          onHome={onHome}
          onLeaderboard={onLeaderboard}
        />
      ) : null}
    </GameShell>
  );
}
