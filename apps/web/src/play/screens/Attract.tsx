import { AnimatePresence, motion } from "motion/react";
import { Hand, Trophy } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { GAME_META, type GameId } from "@wildcat/shared";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { GAME_COLOR } from "../components/GameShell.tsx";
import { TileTitle } from "../components/TileTitle.tsx";
import { useKiosk } from "../lib/config.tsx";
import { spring } from "../lib/motion.ts";

/**
 * The idle screen: the paper's logo, the arcade's name flipping between
 * WILDCAT and GAMES, and the games on offer. Any touch opens the arcade.
 * Optional staff headlines rotate under the title.
 */
export function Attract({ onStart }: { onStart: () => void }) {
  const { config, stats } = useKiosk();
  const leader = stats?.weekLeader ?? null;
  const games = useMemo(() => (["word", "connections", "trivia", "match", "rush"] as GameId[]).filter((g) => (config ? config.games[g].enabled : g !== "rush")), [config]);
  const headlines = config?.attract.headlines ?? [];
  const still = config?.attract.mode === "static";
  const rotateMs = (config?.attract.sceneSeconds ?? 18) * 1000;

  const [line, setLine] = useState(0);
  useEffect(() => {
    if (headlines.length < 2) return;
    const t = window.setInterval(() => setLine((i) => (i + 1) % headlines.length), rotateMs);
    return () => window.clearInterval(t);
  }, [headlines.length, rotateMs]);
  const headline = headlines.length ? headlines[line % headlines.length] : null;

  return (
    <div
      className={`attract ${still ? "is-static" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onStart();
      }}
      aria-label="Touch to play Wildcat Games"
    >
      <header className="attract-top">
        <BrandLogo size="xl" />
      </header>

      <div className="attract-stage">
        <h1 className="welcome-title">
          <motion.span initial={still ? false : { opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={spring.bouncy} style={{ display: "inline-block" }}>
            <TileTitle size="hero" holdMs={still ? 6000 : 2800} />
          </motion.span>
        </h1>
        <AnimatePresence mode="wait">
          {headline ? (
            <motion.p key={headline} className="welcome-line display" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={spring.panel}>
              {headline}
            </motion.p>
          ) : null}
        </AnimatePresence>
        <motion.div className="welcome-leader" initial={still ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.panel, delay: 0.3 }}>
          <span className="welcome-leader-icon" aria-hidden="true">
            <Trophy />
          </span>
          {leader ? (
            <>
              <span className="label">Top scorer this week</span>
              <strong className="display">{leader.nickname}</strong>
              <span className="welcome-leader-pts tabular">{leader.score.toLocaleString("en-US")} pts</span>
            </>
          ) : (
            <span className="welcome-leader-empty">This week's leaderboard is wide open. Be the first name on it.</span>
          )}
        </motion.div>
        <ul className="welcome-games" aria-label="Games">
          {games.map((g) => (
            <li key={g} style={{ "--c": GAME_COLOR[g] } as CSSProperties}>
              <i aria-hidden="true" />
              <span>{GAME_META[g].name}</span>
            </li>
          ))}
        </ul>
      </div>

      <footer className="attract-cta">
        <span className="touch-pill">
          <span className="touch-ring" aria-hidden="true" />
          <Hand className="touch-hand" aria-hidden="true" />
          <span className="display">Touch to play</span>
        </span>
      </footer>
    </div>
  );
}
