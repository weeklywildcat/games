import { motion, useAnimationControls } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMotionLevel } from "./MotionLevel.tsx";

/**
 * The arcade's name as a row of letter tiles that flips between WILDCAT and
 * GAMES, Word-style: each tile turns over in sequence and lands on its new
 * letter. Unused tiles fold away so GAMES sits centered.
 */

const WORDS = ["WILDCAT", "GAMES"] as const;
const SLOTS = Math.max(...WORDS.map((w) => w.length));
const COLORS = ["var(--word)", "var(--word-present)", "var(--trivia)", "var(--match)", "var(--connections)", "var(--rush)", "var(--word)"];
const STAGGER_S = 0.09;
const HALF_FLIP_S = 0.17;

function Slot({ letter, index, animate }: { letter: string; index: number; animate: boolean }) {
  const controls = useAnimationControls();
  const [shown, setShown] = useState(letter);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (letter === shown) return;
    if (!animate) {
      setShown(letter);
      return;
    }
    let cancelled = false;
    void (async () => {
      await controls.start({ rotateX: 90, transition: { delay: index * STAGGER_S, duration: HALF_FLIP_S, ease: "easeIn" } });
      if (cancelled) return;
      setShown(letter);
      await controls.start({ rotateX: 0, transition: { duration: HALF_FLIP_S, ease: "easeOut" } });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, animate]);

  return (
    <motion.span className={`tt-tile ${shown ? "" : "is-empty"}`} animate={controls} style={{ "--tile": COLORS[index % COLORS.length] } as CSSProperties} aria-hidden="true">
      {shown}
    </motion.span>
  );
}

export function TileTitle({ size = "md", holdMs = 3200 }: { size?: "sm" | "md" | "lg" | "xl" | "hero"; holdMs?: number }) {
  const motionLevel = useMotionLevel();
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setWordIndex((i) => (i + 1) % WORDS.length), holdMs);
    return () => window.clearInterval(t);
  }, [holdMs]);

  const word = WORDS[wordIndex];
  return (
    <span className={`tile-title tile-title-${size}`} role="img" aria-label="Wildcat Games">
      {Array.from({ length: SLOTS }, (_, i) => (
        <Slot key={i} index={i} letter={word[i] ?? ""} animate={motionLevel !== "minimal"} />
      ))}
    </span>
  );
}
