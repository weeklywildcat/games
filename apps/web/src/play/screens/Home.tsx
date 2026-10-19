import { motion } from "motion/react";
import { ArrowLeft, ListOrdered, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import { CORE_GAMES, GAME_META, type GameId } from "@wildcat/shared";
import { Btn } from "../components/Button.tsx";
import { GameArt } from "../components/GameArt.tsx";
import { GameGlyph } from "../components/GameGlyph.tsx";
import { GAME_COLOR, GAME_DEEP } from "../components/GameShell.tsx";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { useKiosk } from "../lib/config.tsx";
import { spring } from "../lib/motion.ts";

export function Home({ onPick, onLeaderboards, onAttract }: { onPick: (g: GameId) => void; onLeaderboards: () => void; onAttract: () => void }) {
  const { config, stats } = useKiosk();
  const featured = config?.attract.featuredGame ?? null;
  const games = CORE_GAMES.filter((g) => config?.games[g].enabled ?? true);
  const rushOn = config?.games.rush.enabled ?? false;
  const challenge = stats?.challenge;
  const pct = challenge ? Math.min(1, challenge.progress / challenge.target) : 0;

  return (
    <div className="home">
      <header className="home-top">
        <div className="home-top-left">
          <Btn variant="paper" icon={<ArrowLeft />} onClick={onAttract} aria-label="Back to start">
            Done
          </Btn>
        </div>
        <div className="home-brand">
          <BrandLogo size="lg" />
          <h1 className="sr-only">Wildcat Games</h1>
        </div>
        <div className="home-top-actions">
          <Btn variant="paper" icon={<ListOrdered />} onClick={onLeaderboards}>
            Leaderboards
          </Btn>
        </div>
      </header>

      <div className="home-grid" style={{ "--n": games.length } as CSSProperties}>
        {games.map((g, i) => (
          <motion.button
            key={g}
            className={`gtile gtile-${g} ${featured === g ? "is-featured" : ""}`}
            style={{ "--c": GAME_COLOR[g], "--c-deep": GAME_DEEP[g] } as CSSProperties}
            onClick={() => onPick(g)}
            initial={{ opacity: 0, y: 60, rotate: i % 2 ? 2 : -2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ ...spring.panel, delay: 0.05 + i * 0.07 }}
            whileTap={{ scale: 0.97, y: 4 }}
          >
            {featured === g ? <span className="gtile-flag label">Featured</span> : null}
            <GameArt game={g} />
            <span className="gtile-text">
              <span className="gtile-name display">{GAME_META[g].name}</span>
              <span className="gtile-blurb">{GAME_META[g].blurb}</span>
            </span>
            <span className="gtile-go label">Play</span>
          </motion.button>
        ))}
      </div>

      <div className={`home-bottom ${rushOn ? "" : "is-solo"}`}>
        {rushOn ? (
          <motion.button
            className="rush-band"
            style={{ "--c": GAME_COLOR.rush } as CSSProperties}
            onClick={() => onPick("rush")}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.panel, delay: 0.35 }}
            whileTap={{ scale: 0.985, y: 3 }}
          >
            <GameGlyph game="rush" size="md" />
            <span className="rush-band-name display">Wildcat Rush</span>
            <span className="rush-band-blurb">{GAME_META.rush.blurb}</span>
            <Zap className="rush-band-zap" aria-hidden="true" />
          </motion.button>
        ) : null}
        <aside className="home-side">
          {challenge ? (
            <div className="home-challenge">
              <span className="label">{challenge.title}</span>
              <div className="progress-track">
                <motion.div className="progress-fill" initial={{ scaleX: 0 }} animate={{ scaleX: pct }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.4 }} />
              </div>
              <span className="home-challenge-num tabular">
                <strong className="display">{challenge.progress.toLocaleString("en-US")}</strong> / {challenge.target.toLocaleString("en-US")} solved
              </span>
            </div>
          ) : null}
          <div className="home-leaders">
            <span className="label">Top scorer this week</span>
            {stats?.weekLeader ? (
              <>
                <strong className="home-week-name display">{stats.weekLeader.nickname}</strong>
                <span className="home-week-score tabular">
                  {stats.weekLeader.score.toLocaleString("en-US")} pts across {stats.weekLeader.games} {stats.weekLeader.games === 1 ? "game" : "games"}
                </span>
              </>
            ) : (
              <span className="home-leader-empty">No scores yet this week. Yours could be first.</span>
            )}
          </div>
        </aside>
      </div>

    </div>
  );
}
