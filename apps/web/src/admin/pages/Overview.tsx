import { Activity, RefreshCw } from "lucide-react";
import { GAME_META, type GameId, type LeaderboardRow } from "@wildcat/shared";
import { ErrorNote, Loading, PageHeader, Stat, useLoad } from "../components/common.tsx";
import { get } from "../lib/api.ts";
import { formatDuration, formatTime } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";

export const GAME_ACCENT: Record<string, string> = {
  word: "var(--color-word)",
  connections: "var(--color-connections)",
  trivia: "var(--color-trivia)",
  match: "var(--color-match)",
  rush: "var(--color-rush)",
};

interface Overview {
  day: string;
  version: string;
  serverUptimeSec: number;
  kiosk: { online: boolean; screen: string | null; game: string | null; lastHeartbeat: string | null; streams: number; viewport: { width: number; height: number } | null };
  settings: { paused: boolean; attractMode: string; featuredGame: string | null };
  totals: { started: number; completed: number; solved: number; visits: number; idleResets: number; invalid: number };
  byGame: { game: GameId; started: number; completed: number; won: number; avgSeconds: number | null; ranked: number }[];
  lastSeven: { day: string; started: number; completed: number }[];
  challenge: { title: string; target: number; progress: number } | null;
  records: Partial<Record<GameId, LeaderboardRow | null>>;
  content: Record<string, Record<string, number>>;
}

export function OverviewPage() {
  const { data, error, loading, reload } = useLoad(() => get<Overview>("/overview"), [], 15_000);
  if (!data && loading) return <Loading />;
  if (!data) return <ErrorNote error={error ?? "Couldn't load"} onRetry={reload} />;
  const k = data.kiosk;
  const maxDay = Math.max(1, ...data.lastSeven.map((d) => d.started));
  return (
    <>
      <PageHeader
        title="Overview"
        description={`Today is ${data.day} (school timezone). Numbers refresh every 15 seconds and come straight from the database.`}
        actions={
          <Button variant="outline" onClick={reload}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      {error ? <ErrorNote error={error} /> : null}

      <div className="grid gap-4 md:grid-cols-[1.2fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${k.online ? "bg-success" : "bg-destructive"}`} aria-hidden="true" />
              Kiosk {k.online ? "online" : "offline"}
            </CardTitle>
            <CardDescription>{k.lastHeartbeat ? `Last heartbeat ${formatTime(k.lastHeartbeat)}` : "No heartbeat received since the server started."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Showing</span>
              <span className="font-medium capitalize">{k.screen ? (k.game ? `${GAME_META[k.game as GameId]?.name ?? k.game}` : k.screen) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Live connection</span>
              <span>{k.streams ? `${k.streams} open` : "none"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Display size</span>
              <span>{k.viewport ? `${k.viewport.width}×${k.viewport.height}` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Server uptime</span>
              <span>{formatDuration(data.serverUptimeSec)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version</span>
              <span>v{data.version}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {data.settings.paused ? <Badge variant="warning">Paused</Badge> : <Badge variant="success">Running</Badge>}
              <Badge variant="outline">Attract: {data.settings.attractMode}</Badge>
              {data.settings.featuredGame ? <Badge variant="outline">Featured: {GAME_META[data.settings.featuredGame as GameId]?.short}</Badge> : null}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Stat label="Games started today" value={data.totals.started} />
          <Stat label="Games completed" value={data.totals.completed} hint={data.totals.started ? `${Math.round((data.totals.completed / data.totals.started) * 100)}% finish rate` : undefined} />
          <Stat label="Puzzles solved" value={data.totals.solved} />
          <Stat label="Visits (first touches)" value={data.totals.visits} />
          <Stat label="Idle resets" value={data.totals.idleResets} hint="Walk-aways the board cleaned up" />
          <Stat label="Rejected results" value={data.totals.invalid} hint="See Leaderboards → audit" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today by game</CardTitle>
            <CardDescription>Starts, completions, and average completion time.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.byGame.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Game</TableHead>
                    <TableHead className="text-right">Started</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Ranked</TableHead>
                    <TableHead className="text-right">Avg time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byGame.map((g) => (
                    <TableRow key={g.game}>
                      <TableCell>
                        <span className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: GAME_ACCENT[g.game] }} />
                        {GAME_META[g.game]?.name ?? g.game}
                      </TableCell>
                      <TableCell className="text-right tabular">{g.started}</TableCell>
                      <TableCell className="text-right tabular">{g.completed}</TableCell>
                      <TableCell className="text-right tabular">{g.ranked}</TableCell>
                      <TableCell className="text-right tabular">{g.avgSeconds !== null ? `${g.avgSeconds}s` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-6 text-sm text-muted-foreground">No games played yet today.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" /> Recent days
            </CardTitle>
            <CardDescription>Games started (bar) and completed (dark) per day.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.lastSeven.length ? (
              <div className="flex h-40 gap-3">
                {data.lastSeven.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="relative w-full flex-1">
                      <div className="absolute inset-x-0 bottom-0 rounded-t bg-muted" style={{ height: `${(d.started / maxDay) * 100}%` }} title={`${d.started} started`} />
                      <div className="absolute inset-x-0 bottom-0 rounded-t bg-primary" style={{ height: `${(d.completed / maxDay) * 100}%` }} title={`${d.completed} completed`} />
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular">{d.day.slice(5)}</span>
                    <span className="text-xs font-medium tabular">{d.started}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-sm text-muted-foreground">No history yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Community challenge</CardTitle>
            <CardDescription>{data.challenge ? data.challenge.title : "The challenge is turned off in Settings."}</CardDescription>
          </CardHeader>
          {data.challenge ? (
            <CardContent>
              <p className="text-3xl font-semibold tabular">
                {data.challenge.progress.toLocaleString()} <span className="text-base font-normal text-muted-foreground">/ {data.challenge.target.toLocaleString()}</span>
              </p>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-word" style={{ width: `${Math.min(100, (data.challenge.progress / data.challenge.target) * 100)}%` }} />
              </div>
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Record holders</CardTitle>
            <CardDescription>All-time best visible scores.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {(Object.keys(GAME_META) as GameId[]).map((g) => {
              const r = data.records[g];
              return (
                <div key={g} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="inline-block size-2.5 rounded-sm" style={{ background: GAME_ACCENT[g] }} />
                    {GAME_META[g].name}
                  </span>
                  <span className="text-muted-foreground">{r ? `${r.nickname} · ${r.score.toLocaleString()} · ${r.day}` : "No record yet"}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
