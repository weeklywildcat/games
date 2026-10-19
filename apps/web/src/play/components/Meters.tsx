import { AnimatePresence, motion } from "motion/react";
import { Flame } from "lucide-react";
import type { CSSProperties } from "react";
import { spring } from "../lib/motion.ts";
import { Counter } from "./Counter.tsx";

/** A draining time bar that warms up and pulses in the last stretch. */
export function TimeBar({ remainingMs, totalMs, paused = false }: { remainingMs: number; totalMs: number; paused?: boolean }) {
  const pct = Math.max(0, Math.min(1, remainingMs / totalMs));
  const urgent = remainingMs <= 10_000;
  const critical = remainingMs <= 5_000;
  const seconds = Math.ceil(remainingMs / 1000);
  return (
    <div className={`timebar ${urgent ? "is-urgent" : ""} ${critical ? "is-critical" : ""} ${paused ? "is-paused" : ""}`} role="timer" aria-label={`${seconds} seconds left`}>
      <div className="timebar-track">
        <div className="timebar-fill" style={{ transform: `scaleX(${pct})` }} />
      </div>
      <span className="timebar-num tabular display" aria-hidden="true">
        {seconds}
      </span>
    </div>
  );
}

/** Score with a floating "+points" that rises from it. */
export function ScoreBox({ score, gain, gainKey, label = "Score" }: { score: number; gain?: number; gainKey?: number; label?: string }) {
  return (
    <div className="scorebox">
      <span className="label">{label}</span>
      <span className="scorebox-value display">
        <Counter value={score} duration={0.5} />
      </span>
      <AnimatePresence>
        {gain && gain > 0 ? (
          <motion.span
            key={gainKey}
            className="scorebox-gain display"
            initial={{ opacity: 0, y: 12, scale: 0.8 }}
            animate={{ opacity: 1, y: -26, scale: 1 }}
            exit={{ opacity: 0, y: -48 }}
            transition={spring.bouncy}
          >
            +{gain}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Streak flames grow and recolor as the streak climbs. */
export function Streak({ streak }: { streak: number }) {
  const heat = Math.min(streak, 6);
  return (
    <div className={`streak heat-${heat}`} aria-label={`Streak: ${streak}`}>
      <motion.span key={streak} className="streak-flame" initial={{ scale: streak > 0 ? 1.6 : 1, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy}>
        <Flame />
      </motion.span>
      <span className="streak-num display tabular">{streak}</span>
      <span className="label">streak</span>
    </div>
  );
}

/** A row of dots used for remaining mistakes or progress. */
export function Pips({ total, filled, label, tone = "ink" }: { total: number; filled: number; label: string; tone?: "ink" | "color" }) {
  return (
    <div className="pips" aria-label={`${label}: ${filled} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <motion.span
          key={i}
          className={`pip pip-${tone} ${i < filled ? "is-on" : ""}`}
          animate={{ scale: i < filled ? 1 : 0.55, opacity: i < filled ? 1 : 0.35 }}
          transition={spring.tile}
          style={{ "--i": i } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
