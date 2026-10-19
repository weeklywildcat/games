import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Inactivity handling. After `timeoutMs` without a touch the board warns for
 * the last `warningMs`, then resets for the next visitor. Pure phase logic is
 * separate from the hook so it can be unit tested.
 */

export type IdlePhase = "active" | "warning" | "expired";

export function idlePhase(lastActivity: number, now: number, timeoutMs: number, warningMs: number): IdlePhase {
  const idle = now - lastActivity;
  if (idle >= timeoutMs) return "expired";
  if (idle >= timeoutMs - warningMs) return "warning";
  return "active";
}

export function secondsUntilReset(lastActivity: number, now: number, timeoutMs: number): number {
  return Math.max(0, Math.ceil((timeoutMs - (now - lastActivity)) / 1000));
}

export interface IdleOptions {
  enabled: boolean;
  timeoutMs: number;
  warningMs: number;
  onExpire: () => void;
}

/** Events that count as a person at the board. */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

export function useIdle({ enabled, timeoutMs, warningMs, onExpire }: IdleOptions) {
  const last = useRef(Date.now());
  const [phase, setPhase] = useState<IdlePhase>("active");
  const [remaining, setRemaining] = useState(Math.ceil(warningMs / 1000));
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  const poke = useCallback(() => {
    last.current = Date.now();
    setPhase((p) => (p === "active" ? p : "active"));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    last.current = Date.now();
    setPhase("active");
    const onActivity = () => {
      last.current = Date.now();
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true });
    const timer = window.setInterval(() => {
      const now = Date.now();
      const p = idlePhase(last.current, now, timeoutMs, warningMs);
      setPhase((prev) => (prev === p ? prev : p));
      if (p === "warning") setRemaining(secondsUntilReset(last.current, now, timeoutMs));
      if (p === "expired") {
        last.current = now;
        expireRef.current();
      }
    }, 250);
    return () => {
      window.clearInterval(timer);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, { capture: true });
    };
  }, [enabled, timeoutMs, warningMs]);

  return { phase: enabled ? phase : "active", remaining, poke };
}
