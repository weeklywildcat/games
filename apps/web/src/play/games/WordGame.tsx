import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { Delete, Eye, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { keyboardStates, type LetterState, type SessionResult, type WordGuessResult } from "@wildcat/shared";
import { Btn } from "../components/Button.tsx";
import { Celebration, type CelebrationLevel } from "../components/Celebration.tsx";
import { GameShell } from "../components/GameShell.tsx";
import { HelpModal } from "../components/Help.tsx";
import { formatClock } from "../components/Meters.tsx";
import { useMotionLevel } from "../components/MotionLevel.tsx";
import { ResultPanel } from "../components/ResultPanel.tsx";
import type { GameSession } from "../lib/api.ts";
import { spring } from "../lib/motion.ts";
import { sfx } from "../lib/sound.ts";
import type { GameProps } from "./types.ts";
import { useGameSession } from "./useGameSession.ts";

const ROWS = 6;
const COLS = 5;
const FLIP_STAGGER = 0.22;
const FLIP_DURATION = 0.5;
const KEYS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

interface Row {
  guess: string;
  result: LetterState[];
}

type Finished = { result: SessionResult; answer: string; guesses: number; won: boolean };

function Tile({ letter, state, index, revealed, active, win }: { letter: string; state?: LetterState; index: number; revealed: boolean; active: boolean; win: boolean }) {
  const level = useMotionLevel();
  const flip = level !== "minimal";
  return (
    <motion.div
      className={`wtile ${letter ? "has-letter" : ""} ${active ? "is-active" : ""}`}
      animate={win ? { y: [0, -28, 0, -8, 0] } : { y: 0 }}
      transition={win ? { delay: COLS * FLIP_STAGGER + 0.1 + index * 0.08, duration: 0.6, ease: "easeOut" } : { duration: 0 }}
    >
      <motion.div
        className="wtile-inner"
        initial={false}
        animate={{ rotateX: revealed && flip ? 180 : 0 }}
        transition={{ delay: index * FLIP_STAGGER, duration: FLIP_DURATION, ease: [0.45, 0, 0.55, 1] }}
      >
        <motion.span
          key={letter || "empty"}
          className="wtile-face wtile-front display"
          initial={letter && !revealed ? { scale: 1.25 } : false}
          animate={{ scale: 1 }}
          transition={spring.bouncy}
        >
          {letter}
        </motion.span>
        <span className={`wtile-face wtile-back display is-${state ?? "absent"} ${!flip && revealed ? "no-flip" : ""}`} aria-hidden={!revealed}>
          {letter}
        </span>
      </motion.div>
      {revealed && state ? <span className="sr-only">{`${letter} ${state === "correct" ? "correct" : state === "present" ? "in the word" : "not in the word"}`}</span> : null}
    </motion.div>
  );
}

function BoardRow({ row, typed, revealed, active, shakeKey, win }: { row?: Row; typed?: string; revealed: boolean; active: boolean; shakeKey: number; win: boolean }) {
  const controls = useAnimationControls();
  useEffect(() => {
    if (shakeKey > 0 && active) void controls.start({ x: [0, -14, 14, -10, 10, -4, 0], transition: { duration: 0.42 } });
  }, [shakeKey, active, controls]);
  const letters = (row?.guess ?? typed ?? "").toUpperCase().padEnd(COLS, " ").slice(0, COLS).split("");
  return (
    <motion.div className="wrow" animate={controls} role="row">
      {letters.map((l, i) => (
        <Tile key={i} index={i} letter={l.trim()} state={row?.result[i]} revealed={revealed} active={active && i === (typed?.length ?? 0)} win={win} />
      ))}
    </motion.div>
  );
}

function Keyboard({ states, onKey, disabled }: { states: Record<string, LetterState>; onKey: (k: string) => void; disabled: boolean }) {
  return (
    <div className="wkeys" aria-label="Keyboard">
      {KEYS.map((row, r) => (
        <div key={r} className="wkeys-row">
          {r === 2 ? (
            <motion.button className="wkey wkey-wide" whileTap={{ y: 3, scale: 0.97 }} transition={spring.tap} onClick={() => onKey("enter")} disabled={disabled}>
              Enter
            </motion.button>
          ) : null}
          {row.split("").map((k) => (
            <motion.button
              key={k}
              className={`wkey ${states[k] ? `is-${states[k]}` : ""}`}
              whileTap={{ y: 3, scale: 0.94 }}
              transition={spring.tap}
              onClick={() => onKey(k)}
              disabled={disabled}
              aria-label={`${k.toUpperCase()}${states[k] ? `, ${states[k]}` : ""}`}
            >
              {k.toUpperCase()}
            </motion.button>
          ))}
          {r === 2 ? (
            <motion.button className="wkey wkey-wide" whileTap={{ y: 3, scale: 0.97 }} transition={spring.tap} onClick={() => onKey("back")} disabled={disabled} aria-label="Delete letter">
              <Delete />
            </motion.button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function WordGame({ launch, onHome, onLeaderboard, onSession }: GameProps) {
  const { session, start, error, loading, begin, markFinished, round } = useGameSession("word", launch, onSession);
  const [rows, setRows] = useState<Row[]>([]);
  const [typed, setTyped] = useState("");
  const [revealedCount, setRevealedCount] = useState(0);
  const [keyStates, setKeyStates] = useState<Record<string, LetterState>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [shake, setShake] = useState(0);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [help, setHelp] = useState(false);
  const [celebrate, setCelebrate] = useState<CelebrationLevel | null>(null);
  const [winStreak, setWinStreak] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const sessionRef = useRef<GameSession | null>(null);
  sessionRef.current = session;
  const startedAt = useRef(Date.now());

  // Reset the board for each new puzzle.
  useEffect(() => {
    setRows([]);
    setTyped("");
    setRevealedCount(0);
    setKeyStates({});
    setFinished(null);
    setShowResults(false);
    setBusy(false);
    startedAt.current = Date.now();
    setElapsed(0);
  }, [round]);

  useEffect(() => {
    if (finished || loading) return;
    const t = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 500);
    return () => window.clearInterval(t);
  }, [finished, loading, round]);

  const flash = (text: string) => setToast({ text, key: Date.now() });
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const revealDelayMs = (COLS - 1) * FLIP_STAGGER * 1000 + FLIP_DURATION * 1000 + 80;

  const finish = useCallback(
    (res: WordGuessResult & { result?: SessionResult }, allRows: Row[]) => {
      const sr = res.result!;
      markFinished();
      const won = res.status === "won";
      setWinStreak((s) => (won ? s + 1 : 0));
      setFinished({ result: sr, answer: res.answer ?? String(sr.stats.answer ?? ""), guesses: allRows.length, won });
      if (won) {
        setCelebrate("small");
        window.setTimeout(() => setCelebrate(null), 900);
      }
      window.setTimeout(() => setShowResults(true), won ? 1400 : 900);
    },
    [markFinished],
  );

  const submit = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || busy || finished) return;
    if (typed.length < COLS) {
      setShake((n) => n + 1);
      flash("Not enough letters");
      sfx.bad();
      return;
    }
    setBusy(true);
    try {
      const res = await s.act<WordGuessResult & { result?: SessionResult }>("guess", { word: typed });
      if (!res.valid) {
        setShake((n) => n + 1);
        flash(res.reason ?? "Not in word list");
        sfx.bad();
        setBusy(false);
        return;
      }
      const row = { guess: typed, result: res.result ?? [] };
      const next = res.result ? [...rows, row] : rows;
      setRows(next);
      setTyped("");
      // Start the staggered flip now; keys and the next row unlock once it lands.
      setRevealedCount(next.length);
      window.setTimeout(() => {
        setKeyStates(keyboardStates(next));
        if (res.status === "playing") setBusy(false);
        else finish(res, next);
      }, revealDelayMs);
    } catch {
      flash("Couldn't check that word. Try again.");
      setBusy(false);
    }
  }, [busy, finished, typed, rows, finish, revealDelayMs]);

  const onKey = useCallback(
    (k: string) => {
      if (busy || finished || loading) return;
      if (k === "enter") void submit();
      else if (k === "back") setTyped((t) => t.slice(0, -1));
      else if (/^[a-z]$/.test(k)) setTyped((t) => (t.length < COLS ? t + k : t));
    },
    [busy, finished, loading, submit],
  );

  // Hardware keyboard for development and alternate input.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (help || showResults || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") onKey("enter");
      else if (e.key === "Backspace") onKey("back");
      else if (/^[a-zA-Z]$/.test(e.key)) onKey(e.key.toLowerCase());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKey, help, showResults]);

  const giveUp = async () => {
    const s = sessionRef.current;
    if (!s || finished) return;
    setBusy(true);
    try {
      const res = await s.act<WordGuessResult & { result?: SessionResult }>("give-up");
      finish(res, rows);
    } catch {
      setBusy(false);
    }
  };

  const [confirmReveal, setConfirmReveal] = useState(false);
  useEffect(() => {
    if (!confirmReveal) return;
    const t = window.setTimeout(() => setConfirmReveal(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmReveal]);

  const activeRow = rows.length;
  const won = finished?.won ?? false;

  return (
    <GameShell
      game="word"
      mode={launch.mode}
      onHome={onHome}
      onHelp={() => setHelp(true)}
      status={
        <div className="status-strip">
          <span>
            <span className="label">Guess</span> <strong className="display tabular">{Math.min(rows.length + (finished ? 0 : 1), ROWS)}/{ROWS}</strong>
          </span>
          <span>
            <span className="label">Time</span> <strong className="display tabular">{formatClock(finished ? (finished.result.durationMs ?? elapsed) : elapsed)}</strong>
          </span>
          {winStreak > 1 ? (
            <span>
              <span className="label">Win streak</span> <strong className="display tabular">{winStreak}</strong>
            </span>
          ) : null}
        </div>
      }
      actions={
        <>
          <Btn
            variant="paper"
            icon={<Eye />}
            onClick={() => (confirmReveal ? (setConfirmReveal(false), void giveUp()) : setConfirmReveal(true))}
            disabled={!session || Boolean(finished) || busy}
          >
            {confirmReveal ? "Tap to reveal" : "Reveal"}
          </Btn>
          <Btn variant="paper" icon={<Plus />} onClick={() => void begin()} disabled={loading}>
            New puzzle
          </Btn>
        </>
      }
    >
      <div className="word-layout">
        <div className="word-board" role="grid" aria-label="Guesses" aria-busy={busy}>
          {Array.from({ length: ROWS }, (_, r) => (
            <BoardRow
              key={`${round}-${r}`}
              row={rows[r]}
              typed={r === activeRow && !finished ? typed : undefined}
              revealed={r < revealedCount}
              active={r === activeRow && !finished}
              shakeKey={r === activeRow ? shake : 0}
              win={won && r === rows.length - 1}
            />
          ))}
          <AnimatePresence>
            {toast ? (
              <motion.div key={toast.key} className="toast" role="status" initial={{ opacity: 0, y: -10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={spring.tile}>
                {toast.text}
              </motion.div>
            ) : null}
          </AnimatePresence>
          {finished && !finished.won && !showResults ? (
            <motion.div className="toast toast-answer" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              {finished.answer}
            </motion.div>
          ) : null}
        </div>
        <Keyboard states={keyStates} onKey={onKey} disabled={busy || Boolean(finished) || loading} />
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
      <HelpModal game="word" mode={launch.mode} open={help} onClose={() => setHelp(false)} />
      {finished && showResults && start ? (
        <ResultPanel
          game="word"
          result={finished.result}
          session={session}
          headline={finished.won ? (finished.guesses === 1 ? "First try!" : `Solved in ${finished.guesses}`) : finished.result.stats.revealed ? "Revealed" : "So close"}
          subline={
            <span className="answer-reveal">
              The word was <strong className="display">{finished.answer}</strong>
            </span>
          }
          perfect={finished.won && finished.guesses <= 2}
          stats={[
            { label: "Guesses", value: finished.won ? `${finished.guesses}/6` : "—" },
            { label: "Time", value: formatClock(finished.result.durationMs) },
            { label: "Win streak", value: winStreak },
          ]}
          againLabel="New puzzle"
          onAgain={() => void begin()}
          onHome={onHome}
          onLeaderboard={onLeaderboard}
        />
      ) : null}
    </GameShell>
  );
}
