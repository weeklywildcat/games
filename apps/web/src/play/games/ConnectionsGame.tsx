import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Eye, Plus, Shuffle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { shuffle, createRng, type ConnectionsGroupReveal, type ConnectionsSubmitResult, type SessionResult } from "@wildcat/shared";
import { Btn } from "../components/Button.tsx";
import { Celebration, type CelebrationLevel } from "../components/Celebration.tsx";
import { GameShell } from "../components/GameShell.tsx";
import { HelpModal } from "../components/Help.tsx";
import { Pips } from "../components/Meters.tsx";
import { ResultPanel } from "../components/ResultPanel.tsx";
import { spring } from "../lib/motion.ts";
import { sfx } from "../lib/sound.ts";
import type { GameProps } from "./types.ts";
import { useGameSession } from "./useGameSession.ts";

type Phase = "idle" | "checking" | "animating" | "done";
const LEVEL_COLOR = ["", "var(--conn-1)", "var(--conn-2)", "var(--conn-3)", "var(--conn-4)"];
const LEVEL_NAME = ["", "Straightforward", "Tricky", "Sneaky", "Devious"];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sizeClass(word: string) {
  const n = word.length;
  return n <= 6 ? "" : n <= 8 ? "is-long" : n <= 10 ? "is-longer" : "is-longest";
}

function SolvedRow({ group, delay = 0 }: { group: ConnectionsGroupReveal; delay?: number }) {
  return (
    <motion.div
      layout
      className="csolved"
      style={{ "--g": LEVEL_COLOR[group.level] } as CSSProperties}
      initial={{ opacity: 0, scale: 0.92, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ ...spring.bouncy, delay }}
      role="group"
      aria-label={`${group.category}: ${group.members.join(", ")}`}
    >
      <span className="csolved-cat display">{group.category}</span>
      <span className="csolved-members">{group.members.join(" · ")}</span>
      <span className="csolved-level label">{LEVEL_NAME[group.level]}</span>
    </motion.div>
  );
}

export function ConnectionsGame({ launch, onHome, onLeaderboard, onSession }: GameProps) {
  const { session, start, error, loading, begin, markFinished, round } = useGameSession("connections", launch, onSession);
  const [tiles, setTiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [solved, setSolved] = useState<ConnectionsGroupReveal[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [hop, setHop] = useState(0);
  const [shakeKey, setShakeKey] = useState(0);
  const [shakeWords, setShakeWords] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [revealedAtEnd, setRevealedAtEnd] = useState<ConnectionsGroupReveal[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [help, setHelp] = useState(false);
  const [celebrate, setCelebrate] = useState<CelebrationLevel | null>(null);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const maxMistakes = start?.puzzle.game === "connections" ? start.puzzle.maxMistakes : 4;
  const rng = useRef(createRng(Date.now() >>> 0));

  useEffect(() => {
    if (start?.puzzle.game !== "connections") return;
    setTiles(start.puzzle.tiles);
    setSelected([]);
    setSolved([]);
    setMistakes(0);
    setPhase("idle");
    setResult(null);
    setRevealedAtEnd([]);
    setShowResults(false);
  }, [start, round]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!confirmGiveUp) return;
    const t = window.setTimeout(() => setConfirmGiveUp(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmGiveUp]);

  const toggle = (word: string) => {
    if (phase !== "idle") return;
    setSelected((sel) => (sel.includes(word) ? sel.filter((w) => w !== word) : sel.length < 4 ? [...sel, word] : sel));
  };

  const endGame = useCallback(
    async (res: ConnectionsSubmitResult & { result?: SessionResult }) => {
      markFinished();
      const reveal = res.reveal ?? [];
      // Reveal any remaining groups one at a time.
      for (const g of reveal) {
        await wait(450);
        setTiles((t) => t.filter((w) => !g.members.includes(w)));
        setRevealedAtEnd((r) => [...r, g]);
      }
      setPhase("done");
      if (res.status === "won") {
        setCelebrate("small");
        window.setTimeout(() => setCelebrate(null), 900);
      }
      setResult(res.result ?? null);
      await wait(res.status === "won" ? 1200 : 900);
      setShowResults(true);
    },
    [markFinished],
  );

  const submit = async () => {
    if (!session || phase !== "idle" || selected.length !== 4) return;
    setPhase("checking");
    setHop((h) => h + 1);
    const picked = selected;
    let res: ConnectionsSubmitResult & { result?: SessionResult };
    try {
      [res] = await Promise.all([session.act<ConnectionsSubmitResult & { result?: SessionResult }>("submit", { tiles: picked }), wait(520)]);
    } catch {
      setToast({ text: "Couldn't check that. Try again.", key: Date.now() });
      setPhase("idle");
      return;
    }

    if (res.outcome === "duplicate" || res.outcome === "invalid") {
      setToast({ text: res.outcome === "duplicate" ? "Already guessed!" : (res.reason ?? "Try a different set"), key: Date.now() });
      setPhase("idle");
      return;
    }

    if (res.outcome === "correct" && res.group) {
      sfx.good();
      setPhase("animating");
      const group = res.group;
      // 1) Slide the group's tiles into the top row, 2) fold them into a colored bar.
      setTiles((t) => [...group.members.filter((w) => t.includes(w)), ...t.filter((w) => !group.members.includes(w))]);
      await wait(420);
      setTiles((t) => t.filter((w) => !group.members.includes(w)));
      const nextSolved = [...solved, group];
      setSolved(nextSolved);
      setSelected([]);
      setCelebrate("small");
      window.setTimeout(() => setCelebrate(null), 700);
      if (res.status === "playing") {
        await wait(250);
        setPhase("idle");
      } else {
        await endGame(res);
      }
      return;
    }

    // Incorrect.
    sfx.bad();
    setShakeKey((k) => k + 1);
    setShakeWords(picked);
    window.setTimeout(() => setShakeWords([]), 480);
    setMistakes(res.mistakes);
    if (res.oneAway) setToast({ text: "One away…", key: Date.now() });
    if (res.status === "lost") {
      setSelected([]);
      setPhase("animating");
      await wait(500);
      await endGame(res);
    } else {
      await wait(450);
      setPhase("idle");
    }
  };

  const giveUp = async () => {
    if (!session || phase !== "idle") return;
    setPhase("animating");
    setSelected([]);
    try {
      const res = await session.act<ConnectionsSubmitResult & { result?: SessionResult }>("give-up");
      await endGame(res);
    } catch {
      setPhase("idle");
    }
  };

  const remaining = maxMistakes - mistakes;
  const allGroups = [...solved, ...revealedAtEnd];
  const won = result?.won ?? false;

  return (
    <GameShell
      game="connections"
      mode={launch.mode}
      onHome={onHome}
      onHelp={() => setHelp(true)}
      status={
        <div className="status-strip">
          <span>
            <span className="label">Groups</span> <strong className="display tabular">{solved.length}/4</strong>
          </span>
          <span className="status-mistakes">
            <span className="label">Mistakes left</span>
            <Pips total={maxMistakes} filled={remaining} label="Mistakes remaining" tone="color" />
          </span>
        </div>
      }
      actions={
        <>
          <Btn
            variant="paper"
            icon={<Eye />}
            onClick={() => (confirmGiveUp ? (setConfirmGiveUp(false), void giveUp()) : setConfirmGiveUp(true))}
            disabled={!session || phase !== "idle"}
          >
            {confirmGiveUp ? "Tap to give up" : "Give up"}
          </Btn>
          <Btn variant="paper" icon={<Plus />} onClick={() => void begin()} disabled={loading}>
            New puzzle
          </Btn>
        </>
      }
    >
      <div className="conn-layout">
        <p className="conn-prompt serif-aside">{phase === "done" ? (won ? "All four groups found." : "Here's how it fit together.") : "Create four groups of four."}</p>
        <LayoutGroup>
          <div className="conn-board">
            <AnimatePresence initial={false}>
              {allGroups.map((g, i) => (
                <SolvedRow key={`g-${g.index}`} group={g} delay={i >= solved.length ? 0.05 : 0} />
              ))}
            </AnimatePresence>
            <motion.div layout className="conn-grid" role="group" aria-label="Word tiles">
              <AnimatePresence initial={false}>
                {tiles.map((word) => {
                  const isSel = selected.includes(word);
                  const order = selected.indexOf(word);
                  return (
                    <motion.button
                      key={word}
                      layout
                      layoutId={`ctile-${round}-${word}`}
                      className={`ctile ${isSel ? "is-selected" : ""} ${sizeClass(word)}`}
                      onClick={() => toggle(word)}
                      aria-pressed={isSel}
                      disabled={phase !== "idle" && !isSel}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: isSel ? 0.95 : 1 }}
                      exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.18 } }}
                      whileTap={phase === "idle" ? { scale: 0.9 } : undefined}
                      transition={spring.layout}
                    >
                      <motion.span
                        key={shakeWords.includes(word) ? `s${shakeKey}` : `h${isSel && phase === "checking" ? hop : 0}`}
                        className="ctile-label"
                        initial={false}
                        animate={
                          shakeWords.includes(word)
                            ? { x: [0, -12, 12, -7, 7, 0], transition: { duration: 0.4 } }
                            : isSel && phase === "checking"
                              ? { y: [0, -18, 0], transition: { delay: order * 0.08, duration: 0.34, ease: "easeOut" } }
                              : { x: 0, y: 0 }
                        }
                      >
                        {word}
                      </motion.span>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          </div>
        </LayoutGroup>

        <div className="conn-controls">
          <Btn variant="paper" size="lg" icon={<Shuffle />} onClick={() => setTiles((t) => shuffle(t, rng.current))} disabled={phase !== "idle"}>
            Shuffle
          </Btn>
          <Btn variant="paper" size="lg" icon={<X />} onClick={() => setSelected([])} disabled={phase !== "idle" || selected.length === 0}>
            Deselect all
          </Btn>
          <Btn variant="ink" size="lg" onClick={() => void submit()} disabled={phase !== "idle" || selected.length !== 4}>
            Submit
          </Btn>
        </div>

        <AnimatePresence>
          {toast ? (
            <motion.div key={toast.key} className="toast conn-toast" role="status" initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={spring.tile}>
              {toast.text}
            </motion.div>
          ) : null}
        </AnimatePresence>
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
      <HelpModal game="connections" mode={launch.mode} open={help} onClose={() => setHelp(false)} />
      {result && showResults ? (
        <ResultPanel
          game="connections"
          result={result}
          session={session}
          headline={won ? (mistakes === 0 ? "Flawless" : "Solved it") : `${solved.length} of 4 groups`}
          perfect={won && mistakes === 0}
          stats={[
            { label: "Groups", value: `${solved.length}/4` },
            { label: "Mistakes", value: mistakes },
            { label: "Time", value: `${Math.round(result.durationMs / 1000)}s` },
          ]}
          extra={
            <ul className="results-groups">
              {[...allGroups]
                .sort((a, b) => a.level - b.level)
                .map((g) => (
                  <li key={g.index} style={{ "--g": LEVEL_COLOR[g.level] } as CSSProperties}>
                    <strong>{g.category}</strong>
                    {g.explanation ? <span>{g.explanation}</span> : null}
                  </li>
                ))}
            </ul>
          }
          againLabel="New puzzle"
          onAgain={() => void begin()}
          onHome={onHome}
          onLeaderboard={onLeaderboard}
        />
      ) : null}
    </GameShell>
  );
}
