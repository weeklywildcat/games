import { Home, Pause, Play, Plus, RefreshCw, RotateCw, Save, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { GAME_IDS, GAME_META, type GameId } from "@wildcat/shared";
import { ErrorNote, Loading, PageHeader, useLoad } from "../components/common.tsx";
import { useSettings } from "../components/useSettings.ts";
import { get, post } from "../lib/api.ts";
import { formatTime } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card.tsx";
import { Field, Input, Select } from "../ui/input.tsx";
import { Switch } from "../ui/switch.tsx";
import { useToast } from "../ui/toast.tsx";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface KioskInfo {
  status: { online: boolean; screen: string | null; game: string | null; lastHeartbeat: string | null; streams: number };
  paused: boolean;
  capabilities: { kioskBrowserRestart: boolean; kioskReload: boolean };
}

export function KioskPage() {
  const toast = useToast();
  const info = useLoad(() => get<KioskInfo>("/kiosk"), [], 5000);
  const { draft, update, save, saving, dirty, reset, error } = useSettings();
  const [newHeadline, setNewHeadline] = useState("");

  const command = async (type: "attract" | "reload") => {
    try {
      const r = await post<{ delivered: number }>("/kiosk/command", { type });
      toast({ tone: r.delivered ? "success" : "info", title: type === "attract" ? "Sent: return to attract" : "Sent: reload", description: r.delivered ? undefined : "No board is connected right now; it'll catch up on reconnect." });
    } catch (err) {
      toast({ tone: "error", title: "Command failed", description: (err as Error).message });
    }
  };

  const restartBrowser = async () => {
    try {
      await post("/kiosk/restart-browser");
      toast({ tone: "success", title: "Restarting the kiosk browser" });
    } catch (err) {
      toast({ tone: "error", title: "Can't restart the browser", description: (err as Error).message });
    }
  };

  const togglePause = async (paused: boolean) => {
    try {
      await post("/kiosk/pause", { paused, message: draft?.kiosk.pauseMessage });
      toast({ tone: "success", title: paused ? "Board paused" : "Board resumed" });
      info.reload();
    } catch (err) {
      toast({ tone: "error", title: "Couldn't change pause", description: (err as Error).message });
    }
  };

  if (!draft) return error ? <ErrorNote error={error} /> : <Loading />;
  const st = info.data?.status;

  return (
    <>
      <PageHeader
        title="Kiosk control"
        description="Live controls for the library board. Changes reach the screen within a few seconds over the local network."
        actions={
          <>
            <Button variant="outline" onClick={reset} disabled={!dirty || saving}>
              <Undo2 /> Discard
            </Button>
            <Button onClick={() => save()} disabled={!dirty || saving}>
              <Save /> Save display settings
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${st?.online ? "bg-success" : "bg-destructive"}`} />
              {st?.online ? "Board connected" : "Board not connected"}
            </CardTitle>
            <CardDescription>
              {st?.lastHeartbeat ? `Last heartbeat ${formatTime(st.lastHeartbeat)}` : "Waiting for a heartbeat."} {st?.screen ? `Currently showing: ${st.game ? GAME_META[st.game as GameId]?.name : st.screen}.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => command("attract")}>
              <Home /> Return to attract
            </Button>
            <Button variant="outline" onClick={() => command("reload")}>
              <RefreshCw /> Reload board
            </Button>
            <Button variant="outline" onClick={restartBrowser} disabled={!info.data?.capabilities.kioskBrowserRestart} title={info.data?.capabilities.kioskBrowserRestart ? undefined : "Available once the Raspberry Pi kiosk service is installed"}>
              <RotateCw /> Restart kiosk browser
            </Button>
            {!info.data?.capabilities.kioskBrowserRestart ? <p className="w-full text-xs text-muted-foreground">Browser restart becomes available when the Pi kiosk service sets WG_KIOSK_RESTART_COMMAND. Reload works everywhere.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pause games</CardTitle>
            <CardDescription>Covers the board with a message and ends any game in progress.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Message on screen">
              <Input value={draft.kiosk.pauseMessage} maxLength={120} onChange={(e) => update((d) => void (d.kiosk.pauseMessage = e.target.value))} />
            </Field>
          </CardContent>
          <CardFooter>
            {info.data?.paused ? (
              <Button onClick={() => togglePause(false)}>
                <Play /> Resume games
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => togglePause(true)}>
                <Pause /> Pause now
              </Button>
            )}
          </CardFooter>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Games</CardTitle>
            <CardDescription>Turn games on or off and choose one to feature on the home screen.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {GAME_IDS.map((g) => (
              <div key={g} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">{GAME_META[g].name}</p>
                  <p className="text-xs text-muted-foreground">{GAME_META[g].blurb}</p>
                </div>
                <div className="flex items-center gap-3">
                  {draft.attract.featuredGame === g ? <Badge>Featured</Badge> : null}
                  <Switch label={`${GAME_META[g].name} enabled`} checked={draft.games[g].enabled} onCheckedChange={(v) => update((d) => void (d.games[g].enabled = v))} />
                </div>
              </div>
            ))}
            <Field label="Featured game">
              <Select value={draft.attract.featuredGame ?? ""} onChange={(e) => update((d) => void (d.attract.featuredGame = (e.target.value || null) as GameId | null))}>
                <option value="">None</option>
                {GAME_IDS.map((g) => (
                  <option key={g} value={g}>
                    {GAME_META[g].name}
                  </option>
                ))}
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Motion and sound</CardTitle>
            <CardDescription>Players' reduce-motion settings are always respected.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Animation intensity" hint="Minimal turns off flips, confetti, and floating elements.">
              <Select value={draft.animation.level} onChange={(e) => update((d) => void (d.animation.level = e.target.value as typeof d.animation.level))}>
                <option value="full">Full</option>
                <option value="reduced">Reduced (no confetti)</option>
                <option value="minimal">Minimal</option>
              </Select>
            </Field>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Sound effects</p>
                <p className="text-xs text-muted-foreground">Off by default. Short tones only; nothing autoplays.</p>
              </div>
              <Switch label="Sound effects" checked={draft.sound.enabled} onCheckedChange={(v) => update((d) => void (d.sound.enabled = v))} />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Attract mode</CardTitle>
            <CardDescription>The idle screen: the logo, the flipping WILDCAT GAMES title, and the list of games.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Style">
                <Select value={draft.attract.mode} onChange={(e) => update((d) => void (d.attract.mode = e.target.value as "animated" | "static"))}>
                  <option value="animated">Animated (flipping title)</option>
                  <option value="static">Quiet (slow flip, no entrance animation)</option>
                </Select>
              </Field>
              <Field label="Seconds per headline" hint="How long each optional headline stays up (8–60).">
                <Input type="number" min={8} max={60} value={draft.attract.sceneSeconds} onChange={(e) => update((d) => void (d.attract.sceneSeconds = Number(e.target.value)))} />
              </Field>
            </div>
            <div className="grid gap-2">
              <p className="text-sm font-medium">Optional headlines</p>
              <p className="text-xs text-muted-foreground">Shown under the WILDCAT GAMES tiles on the welcome scene, rotating each time it appears. Leave empty for a clean title.</p>
              {draft.attract.headlines.map((h, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={h} maxLength={48} onChange={(e) => update((d) => void (d.attract.headlines[i] = e.target.value))} aria-label={`Headline ${i + 1}`} />
                  <Button variant="outline" size="icon" aria-label="Remove headline" onClick={() => update((d) => void d.attract.headlines.splice(i, 1))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input value={newHeadline} maxLength={48} placeholder="Add a headline (end sentences with a period to stack lines)" onChange={(e) => setNewHeadline(e.target.value)} />
                <Button
                  variant="outline"
                  disabled={newHeadline.trim().length < 2 || draft.attract.headlines.length >= 12}
                  onClick={() => {
                    update((d) => void d.attract.headlines.push(newHeadline.trim()));
                    setNewHeadline("");
                  }}
                >
                  <Plus /> Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inactivity reset</CardTitle>
            <CardDescription>Returns to attract mode when someone walks away.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Reset after (seconds)">
              <Input type="number" min={30} max={1800} value={draft.idle.timeoutSeconds} onChange={(e) => update((d) => void (d.idle.timeoutSeconds = Number(e.target.value)))} />
            </Field>
            <Field label="Warning before reset (seconds)">
              <Input type="number" min={5} max={120} value={draft.idle.warningSeconds} onChange={(e) => update((d) => void (d.idle.warningSeconds = Number(e.target.value)))} />
            </Field>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Quiet hours
              <Switch label="Quiet hours" checked={draft.quietHours.enabled} onCheckedChange={(v) => update((d) => void (d.quietHours.enabled = v))} />
            </CardTitle>
            <CardDescription>Show a calm display on a schedule (America/New_York). Overnight windows can end the next morning.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="During quiet hours">
                <Select value={draft.quietHours.mode} onChange={(e) => update((d) => void (d.quietHours.mode = e.target.value as "static" | "closed"))}>
                  <option value="static">Static poster (touch still plays)</option>
                  <option value="closed">Closed (message only, no games)</option>
                </Select>
              </Field>
              <Field label="Closed message">
                <Input value={draft.quietHours.message} maxLength={120} onChange={(e) => update((d) => void (d.quietHours.message = e.target.value))} />
              </Field>
            </div>
            {draft.quietHours.windows.map((w, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3 rounded-md border p-3">
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Starts on</span>
                  <div className="flex gap-1">
                    {DAYS.map((d, di) => (
                      <button
                        key={d}
                        type="button"
                        className={`h-8 w-10 rounded-md border text-xs font-medium ${w.days.includes(di) ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}
                        aria-pressed={w.days.includes(di)}
                        onClick={() =>
                          update((s) => {
                            const days = s.quietHours.windows[i].days;
                            s.quietHours.windows[i].days = days.includes(di) ? days.filter((x) => x !== di) : [...days, di].sort();
                          })
                        }
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="From">
                  <Input type="time" value={w.start} onChange={(e) => update((s) => void (s.quietHours.windows[i].start = e.target.value))} />
                </Field>
                <Field label="Until">
                  <Input type="time" value={w.end} onChange={(e) => update((s) => void (s.quietHours.windows[i].end = e.target.value))} />
                </Field>
                <Button variant="outline" size="icon" aria-label="Remove window" onClick={() => update((s) => void s.quietHours.windows.splice(i, 1))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div>
              <Button variant="outline" onClick={() => update((s) => void s.quietHours.windows.push({ days: [1, 2, 3, 4, 5], start: "16:30", end: "07:00" }))}>
                <Plus /> Add window
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
