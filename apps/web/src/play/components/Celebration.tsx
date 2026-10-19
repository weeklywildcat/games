import { AnimatePresence, motion } from "motion/react";
import { useMemo, type CSSProperties } from "react";
import { useMotionLevel } from "./MotionLevel.tsx";

/**
 * Four celebration levels with distinct personalities:
 *  - small:   a crisp ring pulse (a correct group, a matched pair)
 *  - round:   a banner sweep with a handful of paper bits (solved)
 *  - perfect: a fuller confetti fall and a stamp
 *  - record:  a rotating starburst and a big stamp
 * Everything animates transform/opacity, with a bounded number of elements.
 */

export type CelebrationLevel = "small" | "round" | "perfect" | "record";

const COLORS = ["var(--word)", "var(--word-present)", "var(--trivia)", "var(--match)", "var(--connections)", "var(--rush)"];

function Confetti({ count, spread }: { count: number; spread: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: (Math.random() - 0.5) * spread,
        delay: Math.random() * 0.35,
        rot: Math.random() * 720 - 360,
        color: COLORS[i % COLORS.length],
        w: 0.6 + Math.random() * 0.8,
        h: 1 + Math.random() * 1.4,
        fall: 60 + Math.random() * 40,
      })),
    [count, spread],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-bit"
          style={
            {
              "--x": `${p.x}rem`,
              "--fall": `${p.fall}rem`,
              "--rot": `${p.rot}deg`,
              background: p.color,
              width: `${p.w}rem`,
              height: `${p.h}rem`,
              animationDelay: `${p.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function Celebration({ level, label, onDone }: { level: CelebrationLevel | null; label?: string; onDone?: () => void }) {
  const motionLevel = useMotionLevel();
  const quiet = motionLevel === "minimal";
  const lite = motionLevel === "reduced";

  return (
    <AnimatePresence onExitComplete={onDone}>
      {level ? (
        <motion.div
          key={level + (label ?? "")}
          className={`celebration celebration-${level}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          aria-live="polite"
        >
          {level === "small" && !quiet ? <span className="celebration-ring" aria-hidden="true" /> : null}
          {(level === "round" || level === "perfect" || level === "record") && !quiet && !lite ? (
            <Confetti count={level === "round" ? 18 : level === "perfect" ? 36 : 44} spread={level === "round" ? 60 : 110} />
          ) : null}
          {level === "record" && !quiet ? <span className="celebration-burst" aria-hidden="true" /> : null}
          {label && level !== "small" ? (
            <motion.div
              className={`celebration-stamp display stamp-${level}`}
              initial={quiet ? { opacity: 0 } : { scale: 2.2, rotate: level === "record" ? -14 : -6, opacity: 0 }}
              animate={quiet ? { opacity: 1 } : { scale: 1, rotate: level === "record" ? -6 : -3, opacity: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 16 }}
            >
              {label}
            </motion.div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
