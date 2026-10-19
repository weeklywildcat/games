import { AnimatePresence, motion } from "motion/react";
import { Moon, Pause } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { GameId, KioskHeartbeat } from "@wildcat/shared";
import { ConnectionOverlay, IdleWarning } from "./components/Overlays.tsx";
import { MotionLevelProvider } from "./components/MotionLevel.tsx";
import { TileTitle } from "./components/TileTitle.tsx";
import { BrandLogo } from "./components/BrandLogo.tsx";
import { ConnectionsGame } from "./games/ConnectionsGame.tsx";
import { MatchGame } from "./games/MatchGame.tsx";
import { RushGame } from "./games/RushGame.tsx";
import { TriviaGame } from "./games/TriviaGame.tsx";
import type { GameProps } from "./games/types.ts";
import type { GameLaunch } from "./games/useGameSession.ts";
import { WordGame } from "./games/WordGame.tsx";
import { sendEvent, type GameSession } from "./lib/api.ts";
import { useKiosk } from "./lib/config.tsx";
import { useIdle } from "./lib/idle.ts";
import { screenVariants } from "./lib/motion.ts";
import { useVisit } from "./lib/visit.tsx";
import { Attract } from "./screens/Attract.tsx";
import { Home } from "./screens/Home.tsx";
import { Leaderboards } from "./screens/Leaderboards.tsx";

export const GAMES: Record<GameId, ComponentType<GameProps>> = {
  word: WordGame,
  connections: ConnectionsGame,
  trivia: TriviaGame,
  match: MatchGame,
  rush: RushGame,
};

type Screen = { name: "attract" } | { name: "home" } | { name: "play"; game: GameId; launch: GameLaunch; key: number } | { name: "leaderboard" };

const CLIENT_ID = (() => {
  try {
    const existing = sessionStorage.getItem("wg:client");
    if (existing) return existing;
    const id = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem("wg:client", id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
})();

function StatusScreen({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="status-screen">
      <BrandLogo size="lg" />
      <TileTitle size="lg" />
      <div className="status-screen-card">
        <span className="status-screen-icon" aria-hidden="true">
          {icon}
        </span>
        <h1 className="display">{title}</h1>
        <p>{message}</p>
      </div>
    </div>
  );
}

export function KioskApp() {
  const { config, onCommand, refreshStats } = useKiosk();
  const { visit, newVisit } = useVisit();
  const [screen, setScreen] = useState<Screen>({ name: "attract" });
  const session = useRef<GameSession | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const toAttract = useCallback(() => {
    session.current?.abandon();
    session.current = null;
    setScreen({ name: "attract" });
    newVisit();
    refreshStats();
  }, [newVisit, refreshStats]);

  const goHome = useCallback(() => {
    setScreen({ name: "home" });
    refreshStats();
  }, [refreshStats]);

  // Remote commands from the dashboard.
  useEffect(
    () =>
      onCommand((cmd) => {
        if (cmd.type === "attract") toAttract();
        if (cmd.type === "reload") window.location.reload();
      }),
    [onCommand, toAttract],
  );

  // Inactivity: warn, then reset for the next visitor.
  const timeoutMs = (config?.idle.timeoutSeconds ?? 120) * 1000;
  const warningMs = (config?.idle.warningSeconds ?? 20) * 1000;
  const idle = useIdle({
    enabled: screen.name !== "attract",
    timeoutMs,
    warningMs,
    onExpire: () => {
      sendEvent("idle_reset", screenRef.current.name === "play" ? screenRef.current.game : null);
      toAttract();
    },
  });

  // Heartbeat so staff can see what the board is doing.
  useEffect(() => {
    const beat = () => {
      const s = screenRef.current;
      const paused = config?.kiosk.paused;
      const hb: KioskHeartbeat = {
        clientId: CLIENT_ID,
        screen: paused ? "paused" : config?.quiet.active ? "quiet" : s.name === "play" ? "game" : s.name,
        game: s.name === "play" ? s.game : null,
        version: config?.version ?? "",
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
      fetch("/api/kiosk/heartbeat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(hb) }).catch(() => undefined);
    };
    beat();
    const t = window.setInterval(beat, 15_000);
    return () => window.clearInterval(t);
  }, [config?.kiosk.paused, config?.quiet.active, config?.version, screen.name]);

  // A game turned off by staff mid-play returns the board home.
  useEffect(() => {
    if (screen.name === "play" && config && !config.games[screen.game].enabled) goHome();
  }, [config, screen, goHome]);

  const start = () => {
    newVisit();
    sendEvent("visit_start");
    sendEvent("attract_touch");
    setScreen({ name: "home" });
    refreshStats();
  };

  const play = (game: GameId, launch: GameLaunch) => setScreen({ name: "play", game, launch, key: Date.now() });

  const closed = config?.quiet.active && config.quiet.mode === "closed";
  const quietStatic = config?.quiet.active && config.quiet.mode === "static";
  const paused = config?.kiosk.paused;

  // Closing hours or a pause end any game in progress.
  useEffect(() => {
    if ((closed || paused) && screenRef.current.name === "play") {
      session.current?.abandon();
      session.current = null;
    }
    if (closed && screenRef.current.name !== "attract") setScreen({ name: "attract" });
  }, [closed, paused]);

  let body: React.ReactNode;
  if (closed) {
    body = <StatusScreen icon={<Moon />} title="Resting" message={config?.quiet.message ?? "Wildcat Games is closed right now."} />;
  } else if (screen.name === "attract") {
    body = <Attract key={quietStatic ? "static" : "live"} onStart={start} />;
  } else if (screen.name === "home") {
    body = <Home onPick={(g) => play(g, { mode: "ranked" })} onLeaderboards={() => setScreen({ name: "leaderboard" })} onAttract={toAttract} />;
  } else if (screen.name === "leaderboard") {
    body = <Leaderboards onHome={goHome} />;
  } else {
    const Game = GAMES[screen.game];
    body = (
      <Game
        key={screen.key}
        launch={screen.launch}
        onHome={goHome}
        onLeaderboard={() => setScreen({ name: "leaderboard" })}
        onSession={(s) => {
          session.current = s;
        }}
      />
    );
  }

  const screenKey = closed ? "closed" : screen.name === "play" ? `play-${screen.key}` : screen.name;

  return (
    <MotionLevelProvider level={quietStatic && screen.name === "attract" ? "minimal" : (config?.animation.level ?? "full")}>
      <div className={`app-frame ${quietStatic ? "is-quiet" : ""}`}>
        <AnimatePresence mode="wait">
          <motion.div key={screenKey} className="screen" variants={screenVariants} initial="initial" animate="animate" exit="exit">
            {body}
          </motion.div>
        </AnimatePresence>

        <IdleWarning open={idle.phase === "warning" && !paused && !closed} seconds={idle.remaining} onContinue={() => {
          idle.poke();
          sendEvent("idle_continue");
        }} />

        <AnimatePresence>
          {paused && !closed ? (
            <motion.div className="paused-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="alert">
              <div className="paused-card">
                <Pause aria-hidden="true" />
                <h1 className="display">Paused</h1>
                <p>{config?.kiosk.pauseMessage || "Back in a moment."}</p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <ConnectionOverlay blocking={screen.name === "play"} />
      </div>
    </MotionLevelProvider>
  );
}
