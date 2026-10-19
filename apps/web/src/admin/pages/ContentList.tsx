import { Download, FileUp, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CONTENT_STATUSES,
  TRIVIA_CATEGORY_LABELS,
  type ConnectionsData,
  type ContentItem,
  type ContentStatus,
  type ContentType,
  type MatchData,
  type TriviaData,
  type WordData,
} from "@wildcat/shared";
import { ErrorNote, Loading, PageHeader, StatusBadge, useLoad } from "../components/common.tsx";
import { get, post } from "../lib/api.ts";
import { Link, useRouter } from "../lib/router.tsx";
import { download, formatTime } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { Field, Input, Select, Textarea } from "../ui/input.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";
import { useToast } from "../ui/toast.tsx";

export const TYPE_LABEL: Record<ContentType, { title: string; noun: string; description: string }> = {
  word: { title: "Word answers", noun: "answer", description: "Five-letter answers for Wildcat Word. Every game picks a fresh published answer that is in rotation. Guesses are checked against the bundled dictionary." },
  connections: { title: "Connections puzzles", noun: "puzzle", description: "Four groups of four. Each puzzle must have exactly one intended solution; the validator flags duplicates and obvious overlaps." },
  trivia: { title: "Trivia questions", noun: "question", description: "School and local questions need a verified source before they can be approved. Unverified items stay out of play." },
  match: { title: "Mini Match themes", noun: "theme", description: "Each theme needs at least six distinct pictures. Each game uses six pairs at random." },
};

function summary(item: ContentItem) {
  switch (item.type) {
    case "word":
      return <span className="font-mono text-base font-semibold uppercase tracking-widest">{(item.data as WordData).answer}</span>;
    case "connections":
      return (
        <span className="grid gap-0.5">
          <span className="font-medium">{(item.data as ConnectionsData).groups.map((g) => g.category).join(" · ")}</span>
          <span className="text-xs text-muted-foreground">{(item.data as ConnectionsData).groups.flatMap((g) => g.members).slice(0, 8).join(", ")}…</span>
        </span>
      );
    case "trivia": {
      const d = item.data as TriviaData;
      return (
        <span className="grid gap-0.5">
          <span className="font-medium">{d.prompt}</span>
          <span className="text-xs text-muted-foreground">
            {TRIVIA_CATEGORY_LABELS[d.category]} · Answer: {d.choices[d.answerIndex]}
          </span>
        </span>
      );
    }
    case "match": {
      const d = item.data as MatchData;
      return (
        <span className="grid gap-0.5">
          <span className="font-medium">{d.name}</span>
          <span className="text-xs text-muted-foreground">{d.items.map((i) => i.label).join(", ")}</span>
        </span>
      );
    }
  }
}

const PAGE = 50;

export function ContentListPage({ type: rawType }: { type: string }) {
  const type = rawType as ContentType;
  const toast = useToast();
  const { navigate } = useRouter();
  const [status, setStatus] = useState<string>("active");
  const [ranked, setRanked] = useState<string>("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => setOffset(0), [status, ranked, query]);

  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (status) params.set("status", status);
  if (ranked) params.set("ranked", ranked);
  if (query) params.set("q", query);
  const list = useLoad(() => get<{ total: number; items: ContentItem[] }>(`/content/${type}?${params}`), [type, status, ranked, query, offset]);

  if (!TYPE_LABEL[type]) return <ErrorNote error="Unknown content type" />;

  const bulk = async (to: ContentStatus) => {
    const ids = [...selected];
    try {
      const r = await post<{ ok: number; failed: number; results: { id: string; ok: boolean; error?: string }[] }>("/content/bulk-status", { ids, status: to });
      const firstError = r.results.find((x) => !x.ok)?.error;
      toast({ tone: r.failed ? "error" : "success", title: `${r.ok} moved to ${to}${r.failed ? `, ${r.failed} skipped` : ""}`, description: firstError });
      setSelected(new Set());
      list.reload();
    } catch (err) {
      toast({ tone: "error", title: "Bulk update failed", description: (err as Error).message });
    }
  };

  const items = list.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));

  return (
    <>
      <PageHeader
        title={TYPE_LABEL[type].title}
        description={TYPE_LABEL[type].description}
        actions={
          <>
            <Button variant="outline" onClick={() => download(`/api/admin/content/${type}/export`)}>
              <Download /> Export JSON
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp /> Import
            </Button>
            <Button onClick={() => navigate(`/admin/content/${type}/new`)}>
              <Plus /> New {TYPE_LABEL[type].noun}
            </Button>
          </>
        }
      />

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="Search" className="min-w-56 flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Words, prompts, categories…" />
          </div>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">All except archived</option>
            <option value="">Everything</option>
            {CONTENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rotation">
          <Select value={ranked} onChange={(e) => setRanked(e.target.value)}>
            <option value="">Any</option>
            <option value="1">In rotation</option>
            <option value="0">Out of rotation</option>
          </Select>
        </Field>
      </Card>

      {selected.size ? (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2.5 shadow-sm">
          <span className="px-2 text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => bulk("review")}>
            Send to review
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulk("approved")}>
            Approve
          </Button>
          <Button size="sm" onClick={() => bulk("published")}>
            Publish
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulk("draft")}>
            Unpublish to draft
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulk("archived")}>
            Archive
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : null}
      <Card>
        {list.loading && !list.data ? (
          <Loading />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    onChange={() => setSelected((s) => (allOnPage ? new Set([...s].filter((id) => !items.some((i) => i.id === id))) : new Set([...s, ...items.map((i) => i.id)])))}
                  />
                </TableHead>
                <TableHead>{TYPE_LABEL[type].noun}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Rotation</TableHead>
                <TableHead className="text-right">Difficulty</TableHead>
                <TableHead className="text-right">Played</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} data-state={selected.has(item.id) ? "selected" : undefined}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.id}`}
                      checked={selected.has(item.id)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(item.id)) n.delete(item.id);
                          else n.add(item.id);
                          return n;
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="max-w-xl">
                    <Link to={`/admin/content/item/${encodeURIComponent(item.id)}`} className="hover:underline">
                      {summary(item)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={item.status} />
                      {item.type === "trivia" && item.verification.status === "verified" ? <Badge variant="info">verified</Badge> : null}
                      {item.type === "trivia" && item.verification.status === "needs_source" ? <Badge variant="warning">needs source</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>{item.ranked ? <Badge variant="outline">In rotation</Badge> : <span className="text-xs text-muted-foreground">Off</span>}</TableCell>
                  <TableCell className="text-right tabular">{item.difficulty}</TableCell>
                  <TableCell className="text-right tabular">{item.timesServed}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatTime(item.updatedAt)}</TableCell>
                </TableRow>
              ))}
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Nothing matches these filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
      </Card>
      {list.data && list.data.total > PAGE ? (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {offset + 1}–{Math.min(offset + PAGE, list.data.total)} of {list.data.total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={offset + PAGE >= list.data.total} onClick={() => setOffset(offset + PAGE)}>
              Next
            </Button>
          </div>
        </div>
      ) : list.data ? (
        <p className="mt-3 text-sm text-muted-foreground">{list.data.total} total</p>
      ) : null}

      <ImportDialog type={type} open={importOpen} onOpenChange={setImportOpen} onDone={() => list.reload()} />
    </>
  );
}

function ImportDialog({ type, open, onOpenChange, onDone }: { type: ContentType; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const toast = useToast();
  const csvAllowed = type === "word" || type === "trivia";
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [text, setText] = useState("");
  const [onExisting, setOnExisting] = useState<"skip" | "update">("skip");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ created: string[]; updated: string[]; skipped: unknown[]; errors: { index: number; id?: string; message: string; issues?: { message: string; path: string }[] }[] } | null>(null);

  useEffect(() => {
    if (open) {
      setReport(null);
      setText("");
    }
  }, [open]);

  const run = async () => {
    setBusy(true);
    try {
      let body: Record<string, unknown>;
      if (format === "csv") body = { format: "csv", text, onExisting };
      else {
        const parsed = JSON.parse(text);
        const records = Array.isArray(parsed) ? parsed : parsed.records;
        if (!Array.isArray(records)) throw new Error("Expected an array of records or an export file with a records list");
        body = { format: "json", records, onExisting };
      }
      const r = await post<NonNullable<typeof report>>(`/content/${type}/import`, body);
      setReport(r);
      toast({ tone: r.errors.length ? "error" : "success", title: `Imported ${r.created.length} new, ${r.updated.length} updated`, description: r.errors.length ? `${r.errors.length} records had problems` : "New items arrive as drafts for review." });
      onDone();
    } catch (err) {
      toast({ tone: "error", title: "Import failed", description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`Import ${TYPE_LABEL[type].title.toLowerCase()}`}
      description="New items always arrive as drafts so nothing reaches the board without review."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={run} disabled={busy || !text.trim()}>
            <FileUp /> Import
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Format">
          <Select value={format} onChange={(e) => setFormat(e.target.value as "json" | "csv")}>
            <option value="json">JSON</option>
            {csvAllowed ? <option value="csv">CSV</option> : null}
          </Select>
        </Field>
        <Field label="If an id already exists">
          <Select value={onExisting} onChange={(e) => setOnExisting(e.target.value as "skip" | "update")}>
            <option value="skip">Skip it</option>
            <option value="update">Update it</option>
          </Select>
        </Field>
        <Field label="Load a file">
          <Input
            type="file"
            accept={format === "csv" ? ".csv,text/csv" : ".json,application/json"}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
            }}
          />
        </Field>
      </div>
      <Field
        label="Paste content"
        hint={
          format === "csv"
            ? type === "word"
              ? 'Header row with an "answer" column.'
              : "Columns: category, difficulty, prompt, choice_a, choice_b, choice_c, choice_d, correct (A–D), explanation, source"
            : 'An exported file, or an array like [{"type":"…","data":{…}}].'
        }
      >
        <Textarea rows={10} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </Field>
      {report ? (
        <div className="grid gap-2 rounded-md border p-3 text-sm">
          <p>
            <strong>{report.created.length}</strong> created · <strong>{report.updated.length}</strong> updated · <strong>{report.skipped.length}</strong> skipped · <strong>{report.errors.length}</strong> errors
          </p>
          {report.errors.slice(0, 20).map((e, i) => (
            <p key={i} className="text-destructive">
              Record {e.index + 1}
              {e.id ? ` (${e.id})` : ""}: {e.message}
              {e.issues?.length ? ` — ${e.issues.map((x) => x.message).join("; ")}` : ""}
            </p>
          ))}
        </div>
      ) : null}
    </Dialog>
  );
}
