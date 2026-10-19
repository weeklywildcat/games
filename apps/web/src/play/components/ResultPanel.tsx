import { motion } from "motion/react";
import { Award, House, ListOrdered, RotateCcw, Trophy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameId, SessionResult } from "@wildcat/shared";
import type { GameSession } from "../lib/api.ts";
import { spring } from "../lib/motion.ts";
import { sfx } from "../lib/sound.ts";
import { useVisit } from "../lib/visit.tsx";
import { Btn } from "./Button.tsx";
import { Celebration, type CelebrationLevel } from "./Celebration.tsx";
import { CountUp } from "./Counter.tsx";
import { NicknamePicker } from "./Nickname.tsx";

export interface StatItem {
  label: string;
  value: ReactNode;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Shared results screen: score roll-up, stats, records, and the claim flow. */
export function ResultPanel({
  game,
  result,
  session,
  headline,
  subline,
  stats,
  perfect = false,
  againLabel,
  onAgain,
  onHome,
  onLeaderboard,
  extra,
}: {
  game: GameId;
  result: SessionResult;
  session: GameSession | null;
  headline: string;
  subline?: ReactNode;
  stats: StatItem[];
  perfect?: boolean;
  againLabel: string;
  onAgain: () => void;
  onHome: () => void;
  onLeaderboard: () => void;
  extra?: ReactNode;
}) {
  const { visit, setNickname, recordScore } = useVisit();
  const [claim, setClaim] = useState<"offer" | "picking" | "saving" | "done" | "skipped" | "error">(result.claimed ? "done" : result.eligible ? "offer" : "skipped");
  const [claimedAs, setClaimedAs] = useState<{ name: string; rank: number } | null>(result.claimed && result.nickname ? { name: result.nickname, rank: result.wouldRankToday ?? 0 } : null);
  const [personalBest, setPersonalBest] = useState(false);
  const recorded = useRef(false);

  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    if (result.score > 0) setPersonalBest(recordScore(game, result.score).personalBest);
    if (result.won) sfx.win();
  }, [game, result, recordScore]);

  const level: CelebrationLevel | null = result.isGameRecord ? "record" : perfect ? "perfect" : result.won ? "round" : null;
  const stamp = result.isGameRecord ? "New record" : perfect ? "Perfect" : result.isDailyBest ? "Today's best" : null;
  const [celebrate, setCelebrate] = useState<CelebrationLevel | null>(level);
  useEffect(() => {
    if (!level) return;
    const t = window.setTimeout(() => setCelebrate(null), level === "record" ? 3200 : 2400);
    return () => window.clearTimeout(t);
  }, [level]);

  const pick = async (name: string) => {
    if (!session) return;
    setClaim("saving");
    try {
      const r = await session.claim(name);
      setNickname(name);
      setClaimedAs({ name, rank: r.rank });
      setClaim("done");
    } catch {
      setClaim("error");
    }
  };

  return (
    <motion.div className="results-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <Celebration level={celebrate} label={stamp ?? undefined} />
      <motion.section
        className={`results ${result.won ? "is-won" : "is-lost"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="results-title"
        initial={{ y: 80, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ ...spring.panel, delay: 0.1 }}
      >
        <div className="results-score">
          {result.mode === "preview" ? <span className="label">Preview · not saved</span> : null}
          <h2 id="results-title" className="display results-headline">
            {headline}
          </h2>
          {subline ? <div className="results-subline">{subline}</div> : null}
          <div className="results-points">
            <CountUp to={result.score} className="display results-number" />
            <span className="label">points</span>
          </div>
          <div className="results-badges">
            {result.isGameRecord ? (
              <span className="badge badge-record">
                <Trophy /> All-time record
              </span>
            ) : null}
            {!result.isGameRecord && result.isDailyBest ? (
              <span className="badge badge-daily">
                <Award /> Best today
              </span>
            ) : null}
            {personalBest ? <span className="badge badge-pb">Personal best this visit</span> : null}
          </div>
        </div>

        <div className="results-side">
          <dl className="results-stats">
            {stats.map((s) => (
              <div key={s.label} className="results-stat">
                <dt className="label">{s.label}</dt>
                <dd className="display tabular">{s.value}</dd>
              </div>
            ))}
          </dl>

          {extra}

          <div className="results-claim">
            {claim === "offer" ? (
              <div className="claim-offer">
                <p>
                  <strong className="display">{result.wouldRankToday ? `${ordinal(result.wouldRankToday)} place today` : "Put it on the board"}</strong>
                  <span>Add your score to today's leaderboard?</span>
                </p>
                <Btn variant="color" size="lg" color="var(--c)" icon={<Trophy />} onClick={() => setClaim("picking")} data-autofocus>
                  Claim score
                </Btn>
              </div>
            ) : null}
            {claim === "picking" || claim === "saving" ? (
              <NicknamePicker current={visit.nickname} busy={claim === "saving"} onPick={pick} onSkip={() => setClaim("skipped")} />
            ) : null}
            {claim === "done" && claimedAs ? (
              <motion.p className="claim-done" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.bouncy}>
                <span className="label">On the board</span>
                <strong className="display">{claimedAs.name}</strong>
                {claimedAs.rank ? <span>#{claimedAs.rank} today</span> : null}
              </motion.p>
            ) : null}
            {claim === "error" ? (
              <p className="claim-note">
                That didn't save. <button onClick={() => setClaim("picking")}>Try again</button>
              </p>
            ) : null}
          </div>

          <div className="results-actions">
            <Btn variant="ink" size="lg" icon={<RotateCcw />} onClick={onAgain} data-autofocus={claim !== "offer" ? true : undefined}>
              {againLabel}
            </Btn>
            <Btn variant="paper" size="lg" icon={<ListOrdered />} onClick={onLeaderboard}>
              Leaderboard
            </Btn>
            <Btn variant="paper" size="lg" icon={<House />} onClick={onHome}>
              Home
            </Btn>
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}
