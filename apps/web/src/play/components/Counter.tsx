import { animate, useMotionValue, useMotionValueEvent } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * A number that rolls to its new value. Renders plain text so screen readers
 * read the final value; the animation writes the intermediate digits.
 */
export function Counter({ value, duration = 0.6, format = (n: number) => n.toLocaleString("en-US"), className }: { value: number; duration?: number; format?: (n: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const [display, setDisplay] = useState(value);
  const first = useRef(true);

  useMotionValueEvent(mv, "change", (v) => setDisplay(Math.round(v)));

  useEffect(() => {
    if (first.current) {
      first.current = false;
      mv.set(value);
      setDisplay(value);
      return;
    }
    const controls = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [value, duration, mv]);

  return (
    <span className={`tabular ${className ?? ""}`} aria-label={format(value)}>
      <span aria-hidden="true">{format(display)}</span>
    </span>
  );
}

/** Rolls up from zero on mount (results screens). */
export function CountUp({ to, duration = 1.1, className }: { to: number; duration?: number; className?: string }) {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState(0);
  useMotionValueEvent(mv, "change", (v) => setDisplay(Math.round(v)));
  useEffect(() => {
    const c = animate(mv, to, { duration, ease: [0.16, 1, 0.3, 1], delay: 0.15 });
    return () => c.stop();
  }, [to, duration, mv]);
  return (
    <span className={`tabular ${className ?? ""}`} aria-label={to.toLocaleString("en-US")}>
      <span aria-hidden="true">{display.toLocaleString("en-US")}</span>
    </span>
  );
}
