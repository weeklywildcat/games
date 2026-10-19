import { Database, Download, FileJson, HardDriveDownload, Power, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Confirm, ErrorNote, Loading, PageHeader, useLoad } from "../components/common.tsx";
import { get, post, postForm } from "../lib/api.ts";
import { download, formatBytes, formatDuration, formatTime } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx";
import { Field, Input, Select } from "../ui/input.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";
import { Tabs } from "../ui/tabs.tsx";
import { useToast } from "../ui/toast.tsx";

interface Diagnostics {
  version: string;
  env: string;
  node: string;
  platform: string;
  deviceModel: string | null;
  cpuTempC: number | null;
  loadAverage: number[];
  memory: { rssBytes: number; freeBytes: number; totalBytes: number };
  serverUptimeSec: number;
  systemUptimeSec: number;
  disk: { freeBytes: number; totalBytes: number } | null;
  database: { path: string; sizeBytes: number; walBytes: number; schemaVersion: number };
  backups: { count: number; latest: { name: string; createdAt: string } | null };
  kiosk: { online: boolean; lastHeartbeat: string | null };
  capabilities: { serverRestart: boolean; kioskBrowserRestart: boolean };
}

interface Backup {
  name: string;
  size: number;
  createdAt: string;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export function SystemPage() {
  const toast = useToast();
  const [tab, setTab] = useState("health");
  const diag = useLoad(() => get<Diagnostics>("/system/diagnostics"), [], 15_000);
  const backups = useLoad(() => get<{ backups: Backup[] }>("/system/backups"), []);
  const [logLevel, setLogLevel] = useState("info");
  const logs = useLoad(() => get<{ entries: { t: string; level: string; msg: string; [k: string]: unknown }[] }>(`/system/logs?level=${logLevel}&limit=200`), [logLevel]);
  const audit = useLoad(() => get<{ entries: { id: number; actor: string; action: string; target: string | null; details: unknown; createdAt: string }[] }>("/system/audit?limit=200"), []);
  const [restoreTarget, setRestoreTarget] = useState<{ name?: string; file?: File } | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeDays, setPurgeDays] = useState(180);

  const createBackup = async () => {
    try {
      const b = await post<Backup>("/system/backups");
      toast({ tone: "success", title: "Backup created", description: b.name });
      backups.reload();
    } catch (err) {
      toast({ tone: "error", title: "Backup failed", description: (err as Error).message });
    }
  };

  const d = diag.data;
  return (
    <>
      <PageHeader
        title="System"
        description="Health, backups, logs, and maintenance for the Raspberry Pi running the arcade."
        actions={
          <>
            <Button variant="outline" onClick={() => download("/api/admin/system/config-export")}>
              <FileJson /> Export configuration
            </Button>
            <Button variant="outline" onClick={() => setRestartOpen(true)} disabled={!d?.capabilities.serverRestart} title={d?.capabilities.serverRestart ? undefined : "Available when running as a system service"}>
              <Power /> Restart server
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "health", label: "Health" },
          { value: "backups", label: "Backups" },
          { value: "logs", label: "Logs" },
          { value: "audit", label: "Audit log" },
        ]}
      />
      <div className="mt-4">
        {tab === "health" ? (
          !d ? (
            diag.error ? <ErrorNote error={diag.error} onRetry={diag.reload} /> : <Loading />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Device</CardTitle>
                </CardHeader>
                <CardContent>
                  <Row label="Model">{d.deviceModel ?? "Not a Raspberry Pi (development machine)"}</Row>
                  <Row label="Platform">{d.platform}</Row>
                  <Row label="CPU temperature">{d.cpuTempC !== null ? `${d.cpuTempC} °C` : "—"}</Row>
                  <Row label="Load average">{d.loadAverage.join(" · ")}</Row>
                  <Row label="Memory free">
                    {formatBytes(d.memory.freeBytes)} of {formatBytes(d.memory.totalBytes)}
                  </Row>
                  <Row label="Disk free">{d.disk ? `${formatBytes(d.disk.freeBytes)} of ${formatBytes(d.disk.totalBytes)}` : "—"}</Row>
                  <Row label="System uptime">{formatDuration(d.systemUptimeSec)}</Row>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Application</CardTitle>
                </CardHeader>
                <CardContent>
                  <Row label="Version">
                    v{d.version} <Badge variant="outline">{d.env}</Badge>
                  </Row>
                  <Row label="Node.js">{d.node}</Row>
                  <Row label="Server uptime">{formatDuration(d.serverUptimeSec)}</Row>
                  <Row label="Server memory">{formatBytes(d.memory.rssBytes)}</Row>
                  <Row label="Database">
                    {formatBytes(d.database.sizeBytes)} (+{formatBytes(d.database.walBytes)} WAL), schema v{d.database.schemaVersion}
                  </Row>
                  <Row label="Latest backup">{d.backups.latest ? formatTime(d.backups.latest.createdAt) : "None yet"}</Row>
                  <Row label="Kiosk">{d.kiosk.online ? <Badge variant="success">online</Badge> : <Badge variant="destructive">offline</Badge>}</Row>
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Data retention</CardTitle>
                  <CardDescription>Delete old game sessions and anonymous events now. Claimed leaderboard entries are kept.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                  <Field label="Older than (days)">
                    <Input type="number" min={1} value={purgeDays} onChange={(e) => setPurgeDays(Number(e.target.value))} className="w-32" />
                  </Field>
                  <Button variant="outline" onClick={() => setPurgeOpen(true)}>
                    <Trash2 /> Purge old records
                  </Button>
                </CardContent>
              </Card>
            </div>
          )
        ) : null}

        {tab === "backups" ? (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="grid gap-1">
                <CardTitle className="flex items-center gap-2">
                  <Database className="size-4" /> Backups
                </CardTitle>
                <CardDescription>A backup is taken nightly at about 2:30 a.m. and before every restore. Download copies to keep somewhere other than the Pi.</CardDescription>
              </div>
              <div className="flex gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">
                  <RotateCcw className="size-4" /> Restore from file
                  <input type="file" accept=".sqlite,.db,application/octet-stream" className="sr-only" onChange={(e) => e.target.files?.[0] && setRestoreTarget({ file: e.target.files[0] })} />
                </label>
                <Button onClick={createBackup}>
                  <HardDriveDownload /> Back up now
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {backups.loading && !backups.data ? (
                <Loading />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Backup</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(backups.data?.backups ?? []).map((b) => (
                      <TableRow key={b.name}>
                        <TableCell className="font-mono text-xs">{b.name}</TableCell>
                        <TableCell className="text-sm">{formatTime(b.createdAt)}</TableCell>
                        <TableCell className="text-right tabular">{formatBytes(b.size)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => download(`/api/admin/system/backups/${encodeURIComponent(b.name)}`)}>
                              <Download /> Download
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setRestoreTarget({ name: b.name })}>
                              <RotateCcw /> Restore
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : null}

        {tab === "logs" ? (
          <Card>
            <CardHeader className="flex-row items-end justify-between">
              <div className="grid gap-1">
                <CardTitle>Recent server log</CardTitle>
                <CardDescription>The latest entries since the server started. Full logs are in journalctl and data/logs on the device.</CardDescription>
              </div>
              <div className="flex items-end gap-2">
                <Field label="Level">
                  <Select value={logLevel} onChange={(e) => setLogLevel(e.target.value)}>
                    <option value="debug">Everything</option>
                    <option value="info">Info and up</option>
                    <option value="warn">Warnings and errors</option>
                    <option value="error">Errors only</option>
                  </Select>
                </Field>
                <Button variant="outline" size="icon" onClick={logs.reload} aria-label="Refresh logs">
                  <RefreshCw />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-[32rem] overflow-auto rounded-md border bg-zinc-950 p-3 font-mono text-xs text-zinc-100">
                {(logs.data?.entries ?? []).map((e, i) => {
                  const { t, level, msg, ...rest } = e;
                  return (
                    <div key={i} className="whitespace-pre-wrap py-0.5">
                      <span className="text-zinc-500">{new Date(t).toLocaleTimeString()}</span>{" "}
                      <span className={level === "error" ? "text-red-400" : level === "warn" ? "text-amber-300" : "text-emerald-300"}>{level.padEnd(5)}</span> {msg}
                      {Object.keys(rest).length ? <span className="text-zinc-400"> {JSON.stringify(rest)}</span> : null}
                    </div>
                  );
                })}
                {logs.data && logs.data.entries.length === 0 ? <p className="text-zinc-400">No entries at this level.</p> : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {tab === "audit" ? (
          <Card>
            <CardHeader>
              <CardTitle>Audit log</CardTitle>
              <CardDescription>Every administrative change: who, what, and when.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(audit.data?.entries ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatTime(a.createdAt)}</TableCell>
                      <TableCell className="text-sm">{a.actor}</TableCell>
                      <TableCell>
                        <code className="text-xs">{a.action}</code>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{a.target ?? "—"}</TableCell>
                      <TableCell className="max-w-sm truncate font-mono text-xs text-muted-foreground">{a.details ? JSON.stringify(a.details) : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Confirm
        open={Boolean(restoreTarget)}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title="Restore this backup?"
        description={
          <>
            Replaces all content, scores, settings, and admin accounts with <strong>{restoreTarget?.name ?? restoreTarget?.file?.name}</strong>. A safety backup of the current data is taken first. The board reloads afterward.
          </>
        }
        confirmLabel="Restore"
        requirePassword
        phrase="RESTORE"
        onConfirm={async (password) => {
          const form = new FormData();
          form.append("currentPassword", password);
          form.append("confirm", "RESTORE");
          if (restoreTarget?.file) form.append("file", restoreTarget.file);
          if (restoreTarget?.name) form.append("name", restoreTarget.name);
          const r = await postForm<{ safetyBackup: string }>("/system/restore", form);
          toast({ tone: "success", title: "Restore complete", description: `Previous data saved as ${r.safetyBackup}` });
          backups.reload();
          diag.reload();
        }}
      />
      <Confirm
        open={restartOpen}
        onOpenChange={setRestartOpen}
        title="Restart the server?"
        description="The board shows a brief reconnecting screen and resumes on its own. Games in progress continue after reconnecting."
        confirmLabel="Restart"
        requirePassword
        onConfirm={async (password) => {
          await post("/system/restart", { currentPassword: password });
          toast({ tone: "success", title: "Restarting", description: "Give it about ten seconds." });
        }}
      />
      <Confirm
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title={`Delete gameplay records older than ${purgeDays} days?`}
        description="Removes old game sessions and anonymous events. Leaderboard entries stay. This can't be undone (except by restoring a backup)."
        confirmLabel="Purge"
        requirePassword
        onConfirm={async (password) => {
          const r = await post<{ sessions: number; events: number }>("/system/purge", { olderThanDays: purgeDays, currentPassword: password });
          toast({ tone: "success", title: `Deleted ${r.sessions} sessions and ${r.events} events` });
        }}
      />
    </>
  );
}
