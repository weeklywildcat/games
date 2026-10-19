import { AnimatePresence, motion } from "motion/react";
import { Hand, WifiOff } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { connectivity } from "../lib/api.ts";
import { Btn } from "./Button.tsx";
import { Modal } from "./Modal.tsx";

/** "Still there?" warning with a big, obvious way to keep playing. */
export function IdleWarning({ open, seconds, onContinue }: { open: boolean; seconds: number; onContinue: () => void }) {
  return (
    <Modal open={open} onClose={onContinue} tone="ink" size="sm" title="Still playing?">
      <p className="idle-copy">
        The board resets in <strong className="display tabular idle-seconds">{seconds}</strong> seconds so the next player can jump in. Finished results are already saved.
      </p>
      <Btn variant="color" color="var(--word)" size="xl" wide icon={<Hand />} onClick={onContinue} data-autofocus>
        Keep playing
      </Btn>
    </Modal>
  );
}

/** Shown only after the server has been unreachable for a couple of seconds. */
export function ConnectionOverlay({ blocking }: { blocking: boolean }) {
  const online = useSyncExternalStore(connectivity.subscribe, connectivity.get);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (online) {
      setShow(false);
      return;
    }
    const t = window.setTimeout(() => setShow(true), 2500);
    return () => window.clearTimeout(t);
  }, [online]);

  // While offline, poll health so we notice recovery even with no player input.
  useEffect(() => {
    if (online) return;
    const t = window.setInterval(() => {
      fetch("/health", { cache: "no-store" })
        .then((r) => {
          if (r.ok) connectivity.markOnline();
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(t);
  }, [online]);

  return (
    <AnimatePresence>
      {show ? (
        blocking ? (
          <motion.div className="offline-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="alert">
            <div className="offline-card">
              <span className="offline-spinner" aria-hidden="true" />
              <h2 className="display">Reconnecting…</h2>
              <p>The arcade lost touch with its server for a moment. Your game picks up right where you left off.</p>
            </div>
          </motion.div>
        ) : (
          <motion.div className="offline-pill" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} role="status">
            <WifiOff /> Reconnecting…
          </motion.div>
        )
      ) : null}
    </AnimatePresence>
  );
}
