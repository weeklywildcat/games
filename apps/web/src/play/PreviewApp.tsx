import { useMemo, useState } from "react";
import type { GameId } from "@wildcat/shared";
import { GAMES } from "./App.tsx";
import { MotionLevelProvider } from "./components/MotionLevel.tsx";
import { useKiosk } from "./lib/config.tsx";

/**
 * Admin preview: plays one content item (even an unpublished draft) on the
 * real touchscreen layout. Nothing is recorded on leaderboards.
 */
export function PreviewApp() {
  const { config } = useKiosk();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = params.get("token") ?? "";
  const game = (params.get("game") ?? "") as GameId;
  const [key, setKey] = useState(0);

  if (!token || !(game in GAMES) || game === "rush") {
    return (
      <div className="status-screen">
        <div className="status-screen-card">
          <h1 className="display">Preview link needed</h1>
          <p>Open a preview from the admin dashboard's content editor.</p>
        </div>
      </div>
    );
  }
  const Game = GAMES[game];
  return (
    <MotionLevelProvider level={config?.animation.level ?? "full"}>
      <div className="app-frame is-preview">
        <div className="preview-ribbon label">Preview · not saved to leaderboards</div>
        <div className="screen">
          <Game
            key={key}
            launch={{ mode: "preview", previewToken: token }}
            onHome={() => setKey((k) => k + 1)}
            onLeaderboard={() => setKey((k) => k + 1)}
            onSession={() => undefined}
          />
        </div>
      </div>
    </MotionLevelProvider>
  );
}
