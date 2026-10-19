import { MotionConfig } from "motion/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { MotionLevel } from "../lib/motion.ts";

/**
 * Combines the admin's animation setting with the OS reduce-motion preference.
 * "minimal" disables transform animation entirely (opacity only).
 */
const Ctx = createContext<MotionLevel>("full");

export function MotionLevelProvider({ level, children }: { level: MotionLevel; children: ReactNode }) {
  const [osReduce, setOsReduce] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setOsReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const effective: MotionLevel = osReduce ? "minimal" : level;

  useEffect(() => {
    document.documentElement.dataset.motion = effective;
  }, [effective]);

  return (
    <Ctx.Provider value={effective}>
      <MotionConfig reducedMotion={effective === "minimal" ? "always" : "never"}>{children}</MotionConfig>
    </Ctx.Provider>
  );
}

export const useMotionLevel = () => useContext(Ctx);
