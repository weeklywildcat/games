import type { Transition } from "motion/react";

/**
 * The motion language. Short crisp reactions for touches, springs for things
 * that move, and longer choreography only for wins and records.
 */

export const spring = {
  /** Instant press feedback. */
  tap: { type: "spring", stiffness: 900, damping: 40, mass: 0.6 },
  /** Tiles, cards, chips. */
  tile: { type: "spring", stiffness: 520, damping: 32 },
  /** Layout reflow (Connections tiles collapsing into rows). */
  layout: { type: "spring", stiffness: 380, damping: 34 },
  /** Panels and screens. */
  panel: { type: "spring", stiffness: 260, damping: 30 },
  /** Celebratory overshoot. */
  bouncy: { type: "spring", stiffness: 420, damping: 14 },
} satisfies Record<string, Transition>;

export const duration = {
  instant: 0.08,
  quick: 0.16,
  base: 0.28,
  slow: 0.52,
  dramatic: 0.9,
} as const;

export const ease = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

/** Screen-to-screen transition used by the app shell. */
export const screenVariants = {
  initial: { opacity: 0, y: 24, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { ...spring.panel } },
  exit: { opacity: 0, y: -16, scale: 0.99, transition: { duration: duration.quick, ease: ease.inOut } },
};

/** Press feedback for any touch target built on motion elements. */
export const pressable = {
  whileTap: { scale: 0.96, y: 2 },
  transition: spring.tap,
};

export type MotionLevel = "full" | "reduced" | "minimal";
