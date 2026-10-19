import { motion } from "motion/react";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { spring } from "../lib/motion.ts";
import { Btn } from "./Button.tsx";

/**
 * Score claiming uses generated names only, so nothing typed can reach the
 * public board and no real names are collected.
 */
export function NicknamePicker({ current, onPick, onSkip, busy }: { current: string | null; onPick: (name: string) => void; onSkip: () => void; busy?: boolean }) {
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const res = await api<{ names: string[] }>("/api/nicknames");
      setNames(res.names);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="nick">
      <p className="nick-lede">Pick a name for the board. No real names, no sign-in.</p>
      <div className="nick-options">
        {current ? (
          <motion.button className="nick-option is-current" whileTap={{ scale: 0.97 }} transition={spring.tap} onClick={() => onPick(current)} disabled={busy} data-autofocus>
            <span className="label">Keep</span>
            <span className="display">{current}</span>
          </motion.button>
        ) : null}
        {names.map((n, i) => (
          <motion.button
            key={n}
            className="nick-option"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.tile, delay: i * 0.05 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onPick(n)}
            disabled={busy}
          >
            <span className="display">{n}</span>
          </motion.button>
        ))}
        {error ? <p className="nick-error">Names didn't load. Tap “New names” to try again.</p> : null}
      </div>
      <div className="nick-actions">
        <Btn variant="paper" icon={<RefreshCw />} onClick={load} disabled={busy}>
          New names
        </Btn>
        <Btn variant="ghost" onClick={onSkip} disabled={busy}>
          Skip
        </Btn>
      </div>
    </div>
  );
}
