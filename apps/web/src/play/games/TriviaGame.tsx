import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Plus, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { SessionResult, TriviaAnswerResult, TriviaQuestionView } from "@wildcat/shared";
import { Btn } from "../components/Button.tsx";
import { Celebration, type CelebrationLevel } from "../components/Celebration.tsx";
import { GameShell } from "../components/GameShell.tsx";
import { HelpModal } from "../components/Help.tsx";
import { ScoreBox, Streak, TimeBar } from "../components/Meters.tsx";
import { ResultPanel } from "../components/ResultPanel.tsx";
import { spring } from "../lib/motion.ts";
import { sfx } from "../lib/sound.ts";
import type { GameProps } from "./types.ts";
import { useGameSession } from "./useGameSession.ts";

const LETTERS = ["A", "B", "C", "D"];
const AUTO_ADVANCE_MS = 3200;

type Answered = { choice: number; res: TriviaAnswerResult };

export function TriviaGame({ launch, onHome, onLeaderboard, onSession }: GameProps) {
  const { session, start, error, loading, begin, markFinished, round } = useGameSession("trivia", launch, onSession);
  const [question, setQuestion] = useState<TriviaQuestionView | null>(null);
  const [queued, setQueued] = useState<TriviaQuestionView | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [score, setScore] = useState(0);
  const [gain, setGain] = useState<{ n: number; key: number } | null>(null);
  const [streak, setStreak] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [final, setFinal] = useState<SessionResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [help, setHelp] = useState(false);
  const [celebrate, setCelebrate] = useState<CelebrationLevel | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const puzzle = start?.puzzle.game === "trivia" ? start.puzzle : null;
  const timed = puzzle?.timed ?? false;
  const totalMs = (puzzle?.roundSeconds ?? 75) * 1000;
  const clock = useRef<{ left: number; since: number | null }>({ left: 0, since: null });
  const timeoutSent = useRef(false);

  const runClock = (left: number) => {
    clock.current = { left, since: performance.now() };
    setRemaining(left);
  };
  const pauseClock = () => {
    const c = clock.current;
    if (c.since !== null) clock.current = { left: Math.max(0, c.left - (performance.now() - c.since)), since: null };
    setRemaining(clock.current.left);
  };

  // New round.
  useEffect(() => {
    if (!start || start.puzzle.game !== "trivia" || !start.first || !("prompt" in start.first)) return;
    const first = start.first as TriviaQuestionView;
    setQuestion(first);
    setQueued(null);
    setAnswered(null);
    setScore(0);
    setStreak(0);
    setResults([]);
    setFinal(null);
    setShowResults(false);
    setTimedOut(false);
    setBusy(false);
    timeoutSent.current = false;
    if (start.puzzle.timed) runClock(first.remainingMs ?? start.puzzle.roundSeconds * 1000);
  }, [start, round]);

  const finish = useCallback(
    (res: TriviaAnswerResult & { result?: SessionResult }) => {
      markFinished();
      pauseClock();
      if (res.result) setFinal(res.result);
      if (res.result?.won) {
        setCelebrate("small");
        window.setTimeout(() => setCelebrate(null), 800);
      }
      window.setTimeout(() => setShowResults(true), res.timedOut ? 1600 : 1900);
    },
    [markFinished],
  );

  const sendTimeout = useCallback(async () => {
    if (!session || !question || timeoutSent.current || answered) return;
    timeoutSent.current = true;
    setBusy(true);
    try {
      const res = await session.act<TriviaAnswerResult & { result?: SessionResult; kind: string; remainingMs?: number }>("timeout", { index: question.index });
      if ((res as { kind: string }).kind === "resync") {
        timeoutSent.current = false;
        setBusy(false);
        runClock((res as { remainingMs?: number }).remainingMs ?? 1000);
        return;
      }
      setTimedOut(true);
      setAnswered({ choice: -1, res });
      sfx.bad();
      finish(res);
    } catch {
      timeoutSent.current = false;
      setBusy(false);
    }
  }, [session, question, answered, finish]);

  // Clock tick.
  useEffect(() => {
    if (!timed || final) return;
    const t = window.setInterval(() => {
      const c = clock.current;
      if (c.since === null) return;
      const left = Math.max(0, c.left - (performance.now() - c.since));
      setRemaining(left);
      if (left <= 0) void sendTimeout();
    }, 100);
    return () => window.clearInterval(t);
  }, [timed, final, sendTimeout]);

  const answer = async (choice: number) => {
    if (!session || !question || answered || busy || final) return;
    setBusy(true);
    pauseClock();
    try {
      const res = await session.act<TriviaAnswerResult & { result?: SessionResult }>("answer", { index: question.index, choice });
      setAnswered({ choice, res });
      setResults((r) => [...r, res.correct]);
      setStreak(res.streak);
      setScore(res.score);
      if (res.correct) {
        sfx.good();
        setGain({ n: res.points, key: Date.now() });
        if (res.streak >= 3) {
          setCelebrate("small");
          window.setTimeout(() => setCelebrate(null), 700);
        }
      } else sfx.bad();
      if (res.timedOut) setTimedOut(true);
      if (res.status === "finished") finish(res);
      else setQueued(res.next ?? null);
    } catch {
      setBusy(false);
      if (timed) runClock(clock.current.left);
    }
  };

  const next = useCallback(() => {
    if (!queued || !session) return;
    setQuestion(queued);
    setQueued(null);
    setAnswered(null);
    setBusy(false);
    setGain(null);
    void session.act("show", { index: queued.index }).catch(() => undefined);
    if (timed) runClock(queued.remainingMs ?? clock.current.left);
  }, [queued, session, timed]);

  // Timed rounds move on automatically; casual rounds wait for a tap.
  useEffect(() => {
    if (!queued || !timed) return;
    const t = window.setTimeout(next, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [queued, timed, next]);

  const endRound = async () => {
    if (!session || final) return;
    setBusy(true);
    try {
      const res = await session.act<TriviaAnswerResult & { result?: SessionResult }>("give-up");
      finish(res);
    } catch {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!confirmEnd) return;
    const t = window.setTimeout(() => setConfirmEnd(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmEnd]);

  const total = puzzle?.total ?? 10;
  const correctCount = results.filter(Boolean).length;
  const statsFromResult = final?.stats ?? {};

  return (
    <GameShell
      game="trivia"
      mode={launch.mode}
      onHome={onHome}
      onHelp={() => setHelp(true)}
      status={
        <div className="trivia-status">
          <div className="trivia-progress" aria-label={`Question ${Math.min((question?.index ?? 0) + 1, total)} of ${total}`}>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`seg ${i < results.length ? (results[i] ? "is-right" : "is-wrong") : i === (question?.index ?? 0) ? "is-now" : ""}`} />
            ))}
          </div>
          {timed ? <TimeBar remainingMs={remaining} totalMs={totalMs} paused={Boolean(answered)} /> : <span className="label untimed-chip">Untimed · take your time</span>}
        </div>
      }
      actions={
        <>
          <ScoreBox score={score} gain={gain?.n} gainKey={gain?.key} />
          <Streak streak={streak} />
          {final ? (
            <Btn variant="paper" icon={<Plus />} onClick={() => void begin()}>
              New round
            </Btn>
          ) : (
            <Btn variant="paper" icon={<Square />} onClick={() => (confirmEnd ? (setConfirmEnd(false), void endRound()) : setConfirmEnd(true))} disabled={!session || busy}>
              {confirmEnd ? "Tap to end" : "End round"}
            </Btn>
          )}
        </>
      }
    >
      <div className="trivia-layout">
        <AnimatePresence mode="wait">
          {question ? (
            <motion.section
              key={`${round}-${question.index}`}
              className="trivia-card"
              initial={{ opacity: 0, x: 80 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -80 }}
              transition={spring.panel}
              aria-live="polite"
            >
              <div className="trivia-meta">
                <span className="trivia-cat label">{question.category}</span>
                <span className="label tabular">
                  Question {question.index + 1} of {question.total}
                </span>
              </div>
              <h2 className="trivia-prompt">{question.prompt}</h2>
              <div className="trivia-answers">
                {question.choices.map((choice, i) => {
                  const isPicked = answered?.choice === i;
                  const isRight = answered ? answered.res.correctIndex === i : false;
                  const state = answered ? (isRight ? "is-right" : isPicked ? "is-wrong" : "is-dim") : "";
                  return (
                    <motion.button
                      key={i}
                      className={`tanswer ${state}`}
                      onClick={() => void answer(i)}
                      disabled={Boolean(answered) || busy || Boolean(final)}
                      initial={{ opacity: 0, y: 24 }}
                      animate={
                        isPicked && !isRight
                          ? { opacity: 1, y: 0, x: [0, -10, 10, -6, 0] }
                          : isRight && answered
                            ? { opacity: 1, y: 0, scale: [1, 1.04, 1] }
                            : { opacity: answered ? 0.4 : 1, y: 0 }
                      }
                      transition={{ ...spring.tile, delay: answered ? 0 : 0.08 + i * 0.05 }}
                      whileTap={answered ? undefined : { scale: 0.97, y: 3 }}
                      style={{ "--i": i } as CSSProperties}
                    >
                      <span className="tanswer-letter display">{answered && isRight ? <Check /> : answered && isPicked ? <X /> : LETTERS[i]}</span>
                      <span className="tanswer-text">{choice}</span>
                    </motion.button>
                  );
                })}
              </div>
              <AnimatePresence>
                {answered ? (
                  <motion.div className={`trivia-reveal ${answered.res.correct ? "is-right" : "is-wrong"}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring.tile}>
                    <strong className="display">{timedOut && answered.choice === -1 ? "Time!" : answered.res.correct ? (streak >= 3 ? `${streak} in a row!` : "Correct!") : "Not quite."}</strong>
                    {answered.res.explanation ? <span>{answered.res.explanation}</span> : null}
                    {queued ? (
                      <Btn variant="ink" size="lg" icon={<ArrowRight />} onClick={next} data-autofocus>
                        Next
                      </Btn>
                    ) : null}
                    {queued && timed ? <span className="auto-bar" style={{ animationDuration: `${AUTO_ADVANCE_MS}ms` }} aria-hidden="true" /> : null}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.section>
          ) : null}
        </AnimatePresence>
        {loading && !question ? <div className="loading-dots" aria-label="Loading" /> : null}
        {error ? (
          <div className="game-error" role="alert">
            <p>{error}</p>
            <Btn variant="ink" onClick={() => void begin()}>
              Try again
            </Btn>
          </div>
        ) : null}
      </div>

      <Celebration level={celebrate} />
      <HelpModal game="trivia" mode={launch.mode} open={help} onClose={() => setHelp(false)} />
      {final && showResults ? (
        <ResultPanel
          game="trivia"
          result={final}
          session={session}
          headline={timedOut ? "Time's up!" : correctCount === total ? "Ten for ten!" : correctCount >= 7 ? "Brilliant" : correctCount >= 5 ? "Nice round" : "Good effort"}
          perfect={correctCount === total}
          stats={[
            { label: "Correct", value: `${String(statsFromResult.correct ?? correctCount)}/${total}` },
            { label: "Accuracy", value: `${String(statsFromResult.accuracy ?? 0)}%` },
            { label: "Best streak", value: String(statsFromResult.bestStreak ?? 0) },
          ]}
          againLabel="New round"
          onAgain={() => void begin()}
          onHome={onHome}
          onLeaderboard={onLeaderboard}
        />
      ) : null}
    </GameShell>
  );
}
