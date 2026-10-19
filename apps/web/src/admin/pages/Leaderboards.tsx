import { Download, EyeOff, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { GAME_IDS, GAME_META, type GameId } from "@wildcat/shared";
import { Confirm, ErrorNote, Loading, PageHeader, useLoad } from "../components/common.tsx";
import { get, post } from "../lib/api.ts";
import { download, formatTime } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx";
import { Field, Input, Select } from "../ui/input.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";
import { Tabs } from "../ui/tabs.tsx";
import { useToast } from "../ui/toast.tsx";
import { GAME_ACCENT } from "./Overview.tsx";

interface Entry {
  id: number;
  game: GameId;
  nickname: string;
  score: number;
  durationMs: number;
  day: string;
  createdAt: string;
  hidden: number;
  hiddenReason: string | null;
  hiddenBy: string | null;
}

interface Attempt {
  id: string;
  game: string;
  mode: string;
  day: string;
  reason: string;
  score: number | null;
  startedAt: string;
}

export function LeaderboardsPage() {
  const toast = useToast();
  const [tab, setTab] = useState("entries");
  const [game, setGame] = useState("");
  const [day, setDay] = useState("");
  const [hidden, setHidden] = useState("");
  const [hideTarget, setHideTarget] = useState<Entry | null>(null);
  const [reason, setReason] = useState("Inappropriate or invalid");
  const [resetOpen, setResetOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [resetDay, setResetDay] = useState(new Date().toISOString().slice(0, 10));
  const [resetGame, setResetGame] = useState("");
  const [clearGame, setClearGame] = useState<GameId>("word");

  const qs = new URLSearchParams({ limit: "300" });
  if (game) qs.set("game", game);
  if (day) qs.set("day", day);
  if (hidden) qs.set("hidden", hidden);
  const entries = useLoad(() => get<{ entries: Entry[] }>(`/leaderboard?${qs}`), [game, day, hidden]);
  const attempts = useLoad(() => get<{ attempts: Attempt[] }>("/invalid-attempts"), []);

  const unhide = async (e: Entry) => {
    try {
      await post(`/leaderboard/${e.id}/unhide`);
      toast({ tone: "success", title: "Restored to the board" });
      entries.reload();
    } catch (err) {
      toast({ tone: "error", title: "Couldn't restore", description: (err as Error).message });
    }
  };

  return (
    <>
      <PageHeader
        title="Leaderboards"
        description="Every claimed score. Hiding an entry removes it from the board immediately; nothing is edited, and every action is logged."
        actions={
          <>
            <Button variant="outline" onClick={() => download("/api/admin/leaderboard/export.csv")}>
              <Download /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => setResetOpen(true)}>
              <RotateCcw /> Reset a day
            </Button>
            <Button variant="destructive" onClick={() => setClearOpen(true)}>
              <Trash2 /> Clear game records
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "entries", label: "Entries" },
          { value: "audit", label: <>Rejected results {attempts.data?.attempts.length ? <Badge variant="warning">{attempts.data.attempts.length}</Badge> : null}</> },
        ]}
      />
      <div className="mt-4">
        {tab === "entries" ? (
          <>
            <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
              <Field label="Game">
                <Select value={game} onChange={(e) => setGame(e.target.value)}>
                  <option value="">All games</option>
                  {GAME_IDS.map((g) => (
                    <option key={g} value={g}>
                      {GAME_META[g].name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Day">
                <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </Field>
              <Field label="Visibility">
                <Select value={hidden} onChange={(e) => setHidden(e.target.value)}>
                  <option value="">All</option>
                  <option value="0">Visible</option>
                  <option value="1">Hidden</option>
                </Select>
              </Field>
            </Card>
            {entries.error ? <ErrorNote error={entries.error} onRetry={entries.reload} /> : null}
            <Card>
              {entries.loading && !entries.data ? (
                <Loading />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Game</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Time</TableHead>
                      <TableHead>Claimed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(entries.data?.entries ?? []).map((e) => (
                      <TableRow key={e.id} className={e.hidden ? "opacity-60" : undefined}>
                        <TableCell className="tabular">{e.day}</TableCell>
                        <TableCell>
                          <span className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: GAME_ACCENT[e.game] }} />
                          {GAME_META[e.game]?.short}
                        </TableCell>
                        <TableCell className="font-medium">{e.nickname}</TableCell>
                        <TableCell className="text-right tabular">{e.score.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular">{Math.round(e.durationMs / 1000)}s</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatTime(e.createdAt)}</TableCell>
                        <TableCell>{e.hidden ? <Badge variant="destructive" title={`${e.hiddenReason ?? ""} (${e.hiddenBy ?? ""})`}>hidden</Badge> : <Badge variant="success">visible</Badge>}</TableCell>
                        <TableCell className="text-right">
                          {e.hidden ? (
                            <Button size="sm" variant="outline" onClick={() => unhide(e)}>
                              Restore
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setHideTarget(e)}>
                              <EyeOff /> Hide
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {entries.data && entries.data.entries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                          No claimed scores yet.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              )}
            </Card>
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="size-4" /> Rejected results
              </CardTitle>
              <CardDescription>Results the server refused to rank (impossible flip logs, implausibly fast solves, clock mismatches). No personal information is recorded.</CardDescription>
            </CardHeader>
            <CardContent>
              {attempts.loading && !attempts.data ? (
                <Loading />
              ) : attempts.data?.attempts.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Game</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Session</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attempts.data.attempts.map((a) => (
                      <TableRow key={a.id + a.startedAt}>
                        <TableCell className="text-xs">{formatTime(a.startedAt)}</TableCell>
                        <TableCell>{GAME_META[a.game as GameId]?.short ?? a.game}</TableCell>
                        <TableCell>{a.mode}</TableCell>
                        <TableCell>
                          <code className="text-xs">{a.reason}</code>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{a.id}…</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-6 text-sm text-muted-foreground">Nothing rejected. Good.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Confirm
        open={Boolean(hideTarget)}
        onOpenChange={(o) => !o && setHideTarget(null)}
        title={`Hide “${hideTarget?.nickname}”?`}
        description="The entry disappears from every board right away. You can restore it later."
        confirmLabel="Hide entry"
        onConfirm={async () => {
          await post(`/leaderboard/${hideTarget!.id}/hide`, { reason });
          toast({ tone: "success", title: "Entry hidden" });
          entries.reload();
        }}
      >
        <Field label="Reason (for the audit log)">
          <Input value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Confirm>

      <Confirm
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset a day's rankings"
        description="Hides every visible entry for that day. Entries are kept in the database and can be restored one at a time."
        confirmLabel="Reset day"
        requirePassword
        onConfirm={async (password) => {
          const r = await post<{ hidden: number }>("/leaderboard/reset-day", { day: resetDay, game: resetGame || undefined, currentPassword: password });
          toast({ tone: "success", title: `Hid ${r.hidden} entries` });
          entries.reload();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Day">
            <Input type="date" value={resetDay} onChange={(e) => setResetDay(e.target.value)} />
          </Field>
          <Field label="Game">
            <Select value={resetGame} onChange={(e) => setResetGame(e.target.value)}>
              <option value="">All games</option>
              {GAME_IDS.map((g) => (
                <option key={g} value={g}>
                  {GAME_META[g].name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Confirm>

      <Confirm
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear a game's records"
        description="Hides every entry for this game across all days, including the all-time record. This is meant for fresh starts; consider exporting first."
        confirmLabel="Clear records"
        requirePassword
        phrase="CLEAR"
        onConfirm={async (password) => {
          const r = await post<{ hidden: number }>("/leaderboard/clear-game", { game: clearGame, currentPassword: password });
          toast({ tone: "success", title: `Hid ${r.hidden} entries` });
          entries.reload();
        }}
      >
        <Field label="Game">
          <Select value={clearGame} onChange={(e) => setClearGame(e.target.value as GameId)}>
            {GAME_IDS.map((g) => (
              <option key={g} value={g}>
                {GAME_META[g].name}
              </option>
            ))}
          </Select>
        </Field>
      </Confirm>
    </>
  );
}
