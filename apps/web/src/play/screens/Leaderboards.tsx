import { AnimatePresence, motion } from "motion/react";
import { House } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { GAME_META, type GameId, type LeaderboardRow } from "@wildcat/shared";
import { Btn } from "../components/Button.tsx";
import { GameGlyph } from "../components/GameGlyph.tsx";
import { GAME_COLOR } from "../components/GameShell.tsx";
import { api } from "../lib/api.ts";
import { useKiosk } from "../lib/config.tsx";
import { spring } from "../lib/motion.ts";
import { useVisit } from "../lib/visit.tsx";

type Period = "today" | "week" | "all";
interface Boards {
  period: Period;
  range: { start: string; end: string } | null;
  games: Partial<Record<GameId, LeaderboardRow[]>>;
  overall: { rank: number; nickname: string; score: number; games: number }[];
}

function Column({ title, color, glyph, rows, me }: { title: string; color: string; glyph?: GameId; rows: { rank: number; nickname: string; score: number }[]; me: string | null }) {
  return (
    <section className="lb-col" style={{ "--c": color } as CSSProperties}>
      <header className="lb-col-head">
        {glyph ? <GameGlyph game={glyph} size="sm" /> : <span className="lb-cup display">∑</span>}
        <h2 className="display">{title}</h2>
      </header>
      {rows.length ? (
        <ol className="lb-rows">
          {rows.map((r, i) => (
            <motion.li
              key={`${r.nickname}-${r.rank}`}
              className={`lb-row ${r.rank <= 3 ? `is-top is-${r.rank}` : ""} ${me && r.nickname === me ? "is-me" : ""}`}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring.tile, delay: i * 0.035 }}
            >
              <span className="lb-rank display tabular">{r.rank}</span>
              <span className="lb-name">{r.nickname}</span>
              <span className="lb-score display tabular">{r.score.toLocaleString("en-US")}</span>
            </motion.li>
          ))}
        </ol>
      ) : (
        <p className="lb-empty">No scores yet.</p>
      )}
    </section>
  );
}

export function Leaderboards({ onHome }: { onHome: () => void }) {
  const { config } = useKiosk();
  const { visit } = useVisit();
  const [period, setPeriod] = useState<Period>("today");
  const [boards, setBoards] = useState<Boards | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    api<Boards>(`/api/leaderboards?period=${period}&limit=8`)
      .then((b) => live && setBoards(b))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [period]);

  const games = (Object.keys(GAME_META) as GameId[]).filter((g) => config?.games[g].enabled ?? true);
  const eventName = config?.event.name ?? "Launch Week";
  const tabs: { id: Period; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week", label: eventName },
    { id: "all", label: "All-time" },
  ];

  return (
    <div className="leaderboards">
      <header className="lb-top">
        <Btn variant="paper" icon={<House />} onClick={onHome}>
          Home
        </Btn>
        <h1 className="display">Leaderboards</h1>
        <div className="lb-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={period === t.id} className={`lb-tab ${period === t.id ? "is-on" : ""}`} onClick={() => setPeriod(t.id)}>
              {period === t.id ? <motion.span layoutId="lb-tab-bg" className="lb-tab-bg" transition={spring.tile} /> : null}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </header>
      <p className="lb-note">
        {period === "week" && boards?.range ? `${boards.range.start} to ${boards.range.end}. ` : ""}
        Claimed scores only. Each name shows its best score. The Wildcat Cup adds your best in each of the four core games.
      </p>
      <AnimatePresence mode="wait">
        <motion.div key={period} className="lb-grid" style={{ "--n": games.length + 1 } as CSSProperties} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.panel}>
          {failed ? <p className="lb-empty">Leaderboards didn't load. They'll be back in a moment.</p> : null}
          {boards ? (
            <>
              <Column title="Wildcat Cup" color="var(--ink)" rows={boards.overall} me={visit.nickname} />
              {games.map((g) => (
                <Column key={g} title={GAME_META[g].short} color={GAME_COLOR[g]} glyph={g} rows={boards.games[g] ?? []} me={visit.nickname} />
              ))}
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
