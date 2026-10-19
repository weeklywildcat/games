import { motion } from "motion/react";
import { Check, Eye, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { flip, initialMatchState, resolveMiss, type MatchItemView, type MatchState, type SessionResult } from "@wildcat/shared";
import { Btn } from "../components/Button.tsx";
import { Celebration, type CelebrationLevel } from "../components/Celebration.tsx";
import { GameShell } from "../components/GameShell.tsx";
import { HelpModal } from "../components/Help.tsx";
import { formatClock } from "../components/Meters.tsx";
import { useMotionLevel } from "../components/MotionLevel.tsx";
import { ResultPanel } from "../components/ResultPanel.tsx";
import { MATCH_ICONS } from "../matchIcons.ts";
import { spring } from "../lib/motion.ts";
import { sfx } from "../lib/sound.ts";
import type { GameProps } from "./types.ts";
import { useGameSession } from "./useGameSession.ts";

/** How long two mismatched cards stay up before flipping back. */
const MISS_DELAY_MS = 950;

export function CardFace({ item }: { item: MatchItemView | undefined }) {
  if (!item) return null;
  const Icon = item.icon ? MATCH_ICONS[item.icon as keyof typeof MATCH_ICONS] : null;
  return (
    <span className="mcard-face-inner" style={{ "--tint": item.color } as CSSProperties}>
      {item.imageUrl ? <img src={item.imageUrl} alt="" className="mcard-img" /> : Icon ? <Icon className="mcard-icon" strokeWidth={2.1} /> : null}
      <span className="mcard-label">{item.label}</span>
    </span>
  );
}

function Card({
  index,
  item,
  up,
  matched,
  missed,
  celebrate,
  back,
  onFlip,
  disabled,
}: {
  index: number;
  item: MatchItemView | undefined;
  up: boolean;
  matched: boolean;
  missed: boolean;
  celebrate: boolean;
  back: string;
  onFlip: (i: number) => void;
  disabled: boolean;
}) {
  const level = useMotionLevel();
  const flip3d = level !== "minimal";
  return (
    <motion.button
      className={`mcard ${up ? "is-up" : ""} ${matched ? "is-matched" : ""} ${missed ? "is-missed" : ""}`}
      onClick={() => onFlip(index)}
      disabled={disabled}
      aria-label={up && item ? item.label : `Card ${index + 1}, face down`}
      aria-pressed={up}
      initial={{ opacity: 0, y: 30, scale: 0.9 }}
      animate={
        celebrate
          ? { opacity: 1, y: [0, -24, 0], scale: [1, 1.06, 1], transition: { delay: index * 0.05, duration: 0.55 } }
          : missed
            ? { opacity: 1, y: 0, scale: 1, rotate: [0, -3, 3, -2, 0], transition: { duration: 0.4 } }
            : matched
              ? { opacity: 1, y: 0, scale: [1, 1.08, 1], transition: { duration: 0.42 } }
              : { opacity: 1, y: 0, scale: 1, transition: { ...spring.tile, delay: index * 0.025 } }
      }
      whileTap={disabled || up ? undefined : { scale: 0.94 }}
    >
      <motion.span className="mcard-inner" initial={false} animate={{ rotateY: up && flip3d ? 180 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}>
        <span className={`mcard-back back-${back}`} aria-hidden="true">
          <span className="mcard-back-mark display">W</span>
        </span>
        <span className={`mcard-front ${!flip3d ? (up ? "flat-up" : "flat-down") : ""}`} aria-hidden={!up}>
          <CardFace item={item} />
          {matched ? (
            <span className="mcard-check" aria-hidden="true">
              <Check />
            </span>
          ) : null}
        </span>
      </motion.span>
    </motion.button>
  );
}

export function MatchGame({ launch, onHome, onLeaderboard, onSession }: GameProps) {
  const { session, start, error, loading, begin, markFinished, round } = useGameSession("match", launch, onSession);
  const [board, setBoard] = useState<{ sessionId: string; state: MatchState } | null>(null);
  const [missed, setMissed] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [final, setFinal] = useState<SessionResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [wave, setWave] = useState(false);
  const [revealAll, setRevealAll] = useState(false);
  const [help, setHelp] = useState(false);
  const [celebrate, setCelebrate] = useState<CelebrationLevel | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const flips = useRef<[number, number][]>([]);
  const t0 = useRef(0);
  const stopAt = useRef<number | null>(null);
  const missTimer = useRef<number | undefined>(undefined);

  const puzzle = start?.puzzle.game === "match" ? start.puzzle : null;
  const items = new Map((puzzle?.items ?? []).map((i) => [i.id, i]));
  // The board only counts if it belongs to the session on screen.
  const state = board && start && board.sessionId === start.sessionId ? board.state : null;
  const setState = useCallback(
    (next: MatchState | ((s: MatchState | null) => MatchState | null)) =>
      setBoard((b) => {
        if (!b) return b;
        const value = typeof next === "function" ? next(b.state) : next;
        return value ? { ...b, state: value } : b;
      }),
    [],
  );

  useEffect(() => {
    if (!puzzle || !start) return;
    setBoard({ sessionId: start.sessionId, state: initialMatchState(puzzle.deck) });
    setMissed([]);
    setFinal(null);
    setShowResults(false);
    setWave(false);
    setRevealAll(false);
    setSubmitError(false);
    flips.current = [];
    t0.current = performance.now();
    stopAt.current = null;
    setElapsed(0);
    window.clearTimeout(missTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, round]);

  useEffect(() => {
    if (!state || final) return;
    const t = window.setInterval(() => setElapsed((stopAt.current ?? performance.now()) - t0.current), 250);
    return () => window.clearInterval(t);
  }, [state, final]);

  useEffect(() => () => window.clearTimeout(missTimer.current), []);

  const submit = useCallback(async () => {
    if (!session) return;
    setSubmitError(false);
    try {
      const res = await session.act<{ ok: boolean; result?: SessionResult }>("finish", { flips: flips.current });
      markFinished();
      if (res.result) {
        setFinal(res.result);
        window.setTimeout(() => setShowResults(true), 600);
      }
    } catch {
      setSubmitError(true);
    }
  }, [session, markFinished]);

  const onFlip = (index: number) => {
    if (!state || revealAll) return;
    const { state: next, outcome } = flip(state, index);
    if (outcome.kind === "ignored") return;
    flips.current.push([index, Math.round(performance.now() - t0.current)]);
    setState(next);
    if (outcome.kind === "match") {
      sfx.good();
      if (next.phase === "done") {
        stopAt.current = performance.now();
        setElapsed(stopAt.current - t0.current);
        window.setTimeout(() => {
          setWave(true);
          setCelebrate("small");
          window.setTimeout(() => setCelebrate(null), 800);
        }, 350);
        window.setTimeout(() => void submit(), 900);
      }
    } else if (outcome.kind === "miss") {
      sfx.bad();
      setMissed(outcome.pair);
      missTimer.current = window.setTimeout(() => {
        setMissed([]);
        setState((s) => (s ? resolveMiss(s) : s));
      }, MISS_DELAY_MS);
    }
  };

  const giveUp = async () => {
    if (!session || final) return;
    setRevealAll(true);
    stopAt.current = performance.now();
    try {
      const res = await session.act<{ result?: SessionResult }>("give-up");
      markFinished();
      if (res.result) setFinal(res.result);
    } catch {
      // Keep the reveal; "New game" still works.
    }
  };

  const pairsFound = state ? state.matched.length / 2 : 0;
  const attempts = state?.attempts ?? 0;
  const perfect = Boolean(final?.stats.perfect);

  return (
    <GameShell
      game="match"
      mode={launch.mode}
      onHome={onHome}
      onHelp={() => setHelp(true)}
      status={
        <div className="status-strip">
          <span>
            <span className="label">Pairs</span> <strong className="display tabular">{pairsFound}/6</strong>
          </span>
          <span>
            <span className="label">Tries</span> <strong className="display tabular">{attempts}</strong>
          </span>
          <motion.span animate={stopAt.current ? { scale: [1, 1.15, 1] } : { scale: 1 }} transition={{ duration: 0.4 }}>
            <span className="label">Time</span> <strong className={`display tabular ${stopAt.current ? "is-frozen" : ""}`}>{formatClock(elapsed)}</strong>
          </motion.span>
        </div>
      }
      actions={
        <>
          <Btn variant="paper" icon={<Eye />} onClick={() => void giveUp()} disabled={!session || Boolean(final) || revealAll}>
            Reveal
          </Btn>
          <Btn variant="paper" icon={<RotateCcw />} onClick={() => void begin()} disabled={loading}>
            New game
          </Btn>
        </>
      }
    >
      <div className="match-layout">
        {puzzle ? (
          <p className="match-theme">
            <span className="label">Theme</span> <span className="display">{puzzle.theme.name}</span>
          </p>
        ) : null}
        <div className="match-grid" style={{ "--cols": puzzle?.columns ?? 4 } as CSSProperties}>
          {state && puzzle
            ? state.deck.map((card) => {
                const item = items.get(card.itemId);
                const up = revealAll || state.matched.includes(card.index) || state.open.includes(card.index);
                return (
                  <Card
                    key={`${round}-${card.index}`}
                    index={card.index}
                    item={item}
                    up={up}
                    matched={state.matched.includes(card.index)}
                    missed={missed.includes(card.index)}
                    celebrate={wave}
                    back={puzzle.theme.back}
                    onFlip={onFlip}
                    disabled={Boolean(final) || revealAll || state.phase === "done"}
                  />
                );
              })
            : null}
        </div>
        {revealAll && final && !final.completed ? (
          <div className="match-revealed">
            <Btn variant="ink" size="lg" icon={<RotateCcw />} onClick={() => void begin()}>
              Play again
            </Btn>
          </div>
        ) : null}
        {submitError ? (
          <div className="game-error" role="alert">
            <p>Your time didn't save yet.</p>
            <Btn variant="ink" onClick={() => void submit()}>
              Try again
            </Btn>
          </div>
        ) : null}
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
      <HelpModal game="match" mode={launch.mode} open={help} onClose={() => setHelp(false)} />
      {final && showResults && final.completed ? (
        <ResultPanel
          game="match"
          result={final}
          session={session}
          headline={perfect ? "Perfect memory" : attempts <= 8 ? "Sharp!" : "All matched"}
          perfect={perfect}
          stats={[
            { label: "Time", value: formatClock(final.durationMs) },
            { label: "Tries", value: String(final.stats.attempts ?? attempts) },
            { label: "Accuracy", value: `${String(final.stats.accuracy ?? 0)}%` },
          ]}
          againLabel="Rematch"
          onAgain={() => void begin()}
          onHome={onHome}
          onLeaderboard={onLeaderboard}
        />
      ) : null}
    </GameShell>
  );
}
