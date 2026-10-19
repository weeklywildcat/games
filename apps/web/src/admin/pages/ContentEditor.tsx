import { Archive, ArrowLeft, CheckCircle2, ExternalLink, Eye, Plus, Save, Send, Trash2, Upload, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  MATCH_ICON_KEYS,
  TRIVIA_CATEGORIES,
  TRIVIA_CATEGORY_LABELS,
  SOURCE_REQUIRED_CATEGORIES,
  VERIFICATION_STATUSES,
  type ConnectionsData,
  type ContentItem,
  type ContentType,
  type MatchData,
  type TriviaData,
  type ValidationResult,
  type Verification,
  type WordData,
} from "@wildcat/shared";
import { MATCH_ICONS } from "@play/matchIcons.ts";
import { Confirm, ErrorNote, Issues, Loading, PageHeader, StatusBadge } from "../components/common.tsx";
import { AdminApiError, del, get, post, postForm, put } from "../lib/api.ts";
import { Link, useRouter } from "../lib/router.tsx";
import { formatTime } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx";
import { Field, Input, Select, Textarea } from "../ui/input.tsx";
import { Switch } from "../ui/switch.tsx";
import { useToast } from "../ui/toast.tsx";
import { TYPE_LABEL } from "./ContentList.tsx";

const LEVEL_COLORS = ["", "#f7c948", "#6cc48c", "#6fa8f0", "#c58be8"];
const PALETTE = ["#E4572E", "#F0A202", "#2BA84A", "#2D7DD2", "#7B4FD6", "#E83F8C", "#119DA4", "#8C5E3C"];

function blank(type: ContentType): unknown {
  switch (type) {
    case "word":
      return { answer: "" } satisfies WordData;
    case "connections":
      return { groups: [1, 2, 3, 4].map((level) => ({ category: "", level, members: ["", "", "", ""], explanation: "" })) } satisfies ConnectionsData;
    case "trivia":
      return { category: "general", prompt: "", choices: ["", "", "", ""], answerIndex: 0, explanation: "" } satisfies TriviaData;
    case "match":
      return { name: "", description: "", back: "dots", items: [] } satisfies MatchData;
  }
}

interface Loaded {
  item: ContentItem;
  validation: ValidationResult;
  usage: { byMode: { mode: string; plays: number; completed: number; last: string | null }[]; recent: { day: string; mode: string; status: string; score: number | null }[] };
}

export function ContentEditorPage({ id, type: newType }: { id?: string; type?: string }) {
  const toast = useToast();
  const { navigate } = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(newType ? blank(newType as ContentType) : null);
  const [verification, setVerification] = useState<Verification>({ status: "unverified", sources: [], notes: "" });
  const [ranked, setRanked] = useState(false);
  const [difficulty, setDifficulty] = useState(2);
  const [tags, setTags] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const type = (loaded?.item.type ?? newType) as ContentType;

  const load = async () => {
    if (!id) return;
    try {
      const r = await get<Loaded>(`/item/${encodeURIComponent(id)}`);
      setLoaded(r);
      setData(structuredClone(r.item.data));
      setVerification(structuredClone(r.item.verification));
      setRanked(r.item.ranked);
      setDifficulty(r.item.difficulty);
      setTags(r.item.tags.join(", "));
      setValidation(r.validation);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live validation as the editor types.
  useEffect(() => {
    if (!data || !type) return;
    const t = window.setTimeout(async () => {
      try {
        setValidation(await post<ValidationResult>(`/content/${type}/validate`, { data, verification }));
      } catch {
        // Validation is advisory while editing.
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [data, verification, type]);

  const payload = () => ({ data, verification, ranked, difficulty, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });

  const save = async (): Promise<string | null> => {
    setBusy(true);
    try {
      if (id) {
        await put(`/item/${encodeURIComponent(id)}`, payload());
        toast({ tone: "success", title: "Saved" });
        await load();
        return id;
      }
      const r = await post<{ item: ContentItem }>(`/content/${type}`, payload());
      toast({ tone: "success", title: "Draft created" });
      navigate(`/admin/content/item/${encodeURIComponent(r.item.id)}`);
      return r.item.id;
    } catch (err) {
      const e = err as AdminApiError;
      if (e.body?.validation) setValidation(e.body.validation as ValidationResult);
      toast({ tone: "error", title: "Couldn't save", description: e.message });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const transition = async (status: string) => {
    if (!id) return;
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setBusy(true);
    try {
      await post(`/item/${encodeURIComponent(id)}/status`, { status });
      toast({ tone: "success", title: `Moved to ${status}` });
      await load();
    } catch (err) {
      const e = err as AdminApiError;
      if (e.body?.validation) setValidation(e.body.validation as ValidationResult);
      toast({ tone: "error", title: "Couldn't change status", description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    if (!id) return;
    try {
      const r = await post<{ token: string }>(`/item/${encodeURIComponent(id)}/preview`);
      window.open(`/preview?game=${type}&token=${encodeURIComponent(r.token)}`, "_blank", "noopener");
    } catch (err) {
      toast({ tone: "error", title: "Preview failed", description: (err as Error).message });
    }
  };

  const dirty = useMemo(() => {
    if (!loaded) return true;
    const it = loaded.item;
    return (
      JSON.stringify(it.data) !== JSON.stringify(data) ||
      JSON.stringify(it.verification) !== JSON.stringify(verification) ||
      it.ranked !== ranked ||
      it.difficulty !== difficulty ||
      it.tags.join(", ") !== tags
    );
  }, [loaded, data, verification, ranked, difficulty, tags]);

  if (loadError) return <ErrorNote error={loadError} />;
  if (!data || !type) return <Loading />;
  const status = loaded?.item.status;
  const ok = validation?.ok ?? false;

  return (
    <>
      <Link to={`/admin/content/${type}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {TYPE_LABEL[type].title}
      </Link>
      <PageHeader
        title={id ? `Edit ${TYPE_LABEL[type].noun}` : `New ${TYPE_LABEL[type].noun}`}
        description={
          id ? (
            <span className="flex flex-wrap items-center gap-2">
              <code className="text-xs">{id}</code> {status ? <StatusBadge status={status} /> : null}
              {loaded?.item.approvedBy ? (
                <span className="text-xs">
                  approved by {loaded.item.approvedBy} {formatTime(loaded.item.approvedAt)}
                </span>
              ) : null}
            </span>
          ) : (
            "Saved as a draft. Approve, then publish, to put it in play."
          )
        }
        actions={
          <>
            {id && dirty ? (
              <Button variant="outline" onClick={load} disabled={busy}>
                <Undo2 /> Discard changes
              </Button>
            ) : null}
            {id && type !== "word" ? (
              <Button variant="outline" onClick={preview}>
                <Eye /> Preview on board
              </Button>
            ) : null}
            <Button onClick={save} disabled={busy || (!dirty && Boolean(id))}>
              <Save /> {id ? "Save" : "Create draft"}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-4">
          {type === "word" ? <WordEditor data={data as WordData} onChange={setData} /> : null}
          {type === "connections" ? <ConnectionsEditor data={data as ConnectionsData} onChange={setData} /> : null}
          {type === "trivia" ? <TriviaEditor data={data as TriviaData} onChange={setData} verification={verification} onVerification={setVerification} /> : null}
          {type === "match" ? <MatchEditor data={data as MatchData} onChange={setData} /> : null}
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Workflow</CardTitle>
              <CardDescription>Draft → Review → Approved → Published. Only published items are played.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {id ? (
                <>
                  {status === "draft" ? (
                    <Button variant="outline" onClick={() => transition("review")} disabled={busy}>
                      <Send /> Send to review
                    </Button>
                  ) : null}
                  {status === "draft" || status === "review" ? (
                    <Button variant="outline" onClick={() => transition("approved")} disabled={busy || !ok}>
                      <CheckCircle2 /> Approve
                    </Button>
                  ) : null}
                  {status === "approved" ? (
                    <Button onClick={() => transition("published")} disabled={busy || !ok}>
                      <Upload /> Publish
                    </Button>
                  ) : null}
                  {status === "published" || status === "approved" ? (
                    <Button variant="outline" onClick={() => transition("draft")} disabled={busy}>
                      <Undo2 /> Unpublish to draft
                    </Button>
                  ) : null}
                  {status !== "archived" ? (
                    <Button variant="outline" onClick={() => transition("archived")} disabled={busy}>
                      <Archive /> Archive
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => transition("draft")} disabled={busy}>
                      Restore to draft
                    </Button>
                  )}
                  {loaded && loaded.item.timesServed === 0 && status !== "published" ? (
                    <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                      <Trash2 /> Delete permanently
                    </Button>
                  ) : null}
                  {!ok ? <p className="text-xs text-muted-foreground">Fix validation errors to approve or publish.</p> : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Create the draft first.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Play settings</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">In rotation on the board</p>
                  <p className="text-xs text-muted-foreground">The board only serves published items with this on. Turn it off to keep an item published but out of play.</p>
                </div>
                <Switch label="In rotation" checked={ranked} onCheckedChange={setRanked} />
              </div>
              <Field label="Difficulty" hint="1 easiest – 5 hardest. Trivia rounds mix 4 easy, 4 medium, 2 hard.">
                <Select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tags" hint="Comma separated, for your own organizing.">
                <Input value={tags} onChange={(e) => setTags(e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Validation</CardTitle>
              <CardDescription>Checked live, including publishing rules.</CardDescription>
            </CardHeader>
            <CardContent>{validation ? <Issues errors={validation.errors} warnings={validation.warnings} /> : <Loading label="Checking" />}</CardContent>
          </Card>

          {loaded ? (
            <Card>
              <CardHeader>
                <CardTitle>Where it's been used</CardTitle>
                <CardDescription>
                  Served {loaded.item.timesServed} times{loaded.item.lastServedAt ? `, last ${formatTime(loaded.item.lastServedAt)}` : ""}.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-1.5 text-sm">
                {loaded.usage.byMode.length ? (
                  loaded.usage.byMode.map((u) => (
                    <div key={u.mode} className="flex justify-between">
                      <span className="capitalize">{u.mode}</span>
                      <span className="text-muted-foreground">
                        {u.plays} plays · {u.completed} completed
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">Not played yet.</p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete permanently?"
        description="This item has never been played, so it can be removed completely. This can't be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          await del(`/item/${encodeURIComponent(id!)}`);
          toast({ tone: "success", title: "Deleted" });
          navigate(`/admin/content/${type}`);
        }}
      />
    </>
  );
}

// --- Word -----------------------------------------------------------------------------

function WordEditor({ data, onChange }: { data: WordData; onChange: (d: WordData) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Answer</CardTitle>
        <CardDescription>Common, family-friendly five-letter words. Avoid plurals and obscure words; the validator warns about words outside the dictionary.</CardDescription>
      </CardHeader>
      <CardContent>
        <Input
          value={data.answer.toUpperCase()}
          maxLength={5}
          onChange={(e) => onChange({ answer: e.target.value.toLowerCase().replace(/[^a-z]/g, "") })}
          className="h-14 max-w-64 font-mono text-3xl font-bold uppercase tracking-[0.4em]"
          aria-label="Answer"
        />
      </CardContent>
    </Card>
  );
}

// --- Connections ---------------------------------------------------------------------------

function ConnectionsEditor({ data, onChange }: { data: ConnectionsData; onChange: (d: ConnectionsData) => void }) {
  const set = (fn: (d: ConnectionsData) => void) => {
    const next = structuredClone(data);
    fn(next);
    onChange(next);
  };
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Puzzle</CardTitle>
          <CardDescription>Use each level once: 1 is the most straightforward, 4 the sneakiest. Words appear in capitals on the board, up to about 12 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field label="Internal title (optional)">
            <Input value={data.title ?? ""} onChange={(e) => set((d) => void (d.title = e.target.value || undefined))} />
          </Field>
        </CardContent>
      </Card>
      {data.groups.map((g, gi) => (
        <Card key={gi} className="overflow-hidden">
          <div className="h-1.5" style={{ background: LEVEL_COLORS[g.level] }} />
          <CardContent className="grid gap-3 pt-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <Field label={`Group ${gi + 1} category`}>
                <Input value={g.category} maxLength={60} onChange={(e) => set((d) => void (d.groups[gi].category = e.target.value))} />
              </Field>
              <Field label="Level">
                <Select value={g.level} onChange={(e) => set((d) => void (d.groups[gi].level = Number(e.target.value)))}>
                  <option value={1}>1 · Yellow</option>
                  <option value={2}>2 · Green</option>
                  <option value={3}>3 · Blue</option>
                  <option value={4}>4 · Purple</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {g.members.map((m, mi) => (
                <Input
                  key={mi}
                  value={m}
                  maxLength={16}
                  className="font-semibold uppercase"
                  aria-label={`Group ${gi + 1} word ${mi + 1}`}
                  onChange={(e) => set((d) => void (d.groups[gi].members[mi] = e.target.value.toUpperCase()))}
                />
              ))}
            </div>
            <Field label="Explanation shown after the reveal">
              <Input value={g.explanation ?? ""} maxLength={200} onChange={(e) => set((d) => void (d.groups[gi].explanation = e.target.value))} />
            </Field>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

// --- Trivia --------------------------------------------------------------------------------

function TriviaEditor({ data, onChange, verification, onVerification }: { data: TriviaData; onChange: (d: TriviaData) => void; verification: Verification; onVerification: (v: Verification) => void }) {
  const set = (fn: (d: TriviaData) => void) => {
    const next = structuredClone(data);
    fn(next);
    onChange(next);
  };
  const needsSource = SOURCE_REQUIRED_CATEGORIES.includes(data.category);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Question</CardTitle>
          <CardDescription>Four unambiguous choices with exactly one right answer. Choices are shuffled every round, so avoid “all of the above.”</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Category">
            <Select value={data.category} onChange={(e) => set((d) => void (d.category = e.target.value as TriviaData["category"]))}>
              {TRIVIA_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TRIVIA_CATEGORY_LABELS[c]}
                  {SOURCE_REQUIRED_CATEGORIES.includes(c) ? " (needs a verified source)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prompt">
            <Textarea value={data.prompt} maxLength={180} rows={3} onChange={(e) => set((d) => void (d.prompt = e.target.value))} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Choices (select the correct one)</legend>
            {data.choices.map((c, i) => (
              <label key={i} className={`flex items-center gap-3 rounded-md border p-2 ${data.answerIndex === i ? "border-success bg-green-50" : ""}`}>
                <input type="radio" name="answer" checked={data.answerIndex === i} onChange={() => set((d) => void (d.answerIndex = i))} aria-label={`Choice ${i + 1} is correct`} />
                <span className="w-5 text-sm font-semibold text-muted-foreground">{"ABCD"[i]}</span>
                <Input value={c} maxLength={64} onChange={(e) => set((d) => void (d.choices[i] = e.target.value))} aria-label={`Choice ${"ABCD"[i]}`} />
              </label>
            ))}
          </fieldset>
          <Field label="Explanation or fun fact (shown after answering)">
            <Textarea value={data.explanation ?? ""} maxLength={240} rows={2} onChange={(e) => set((d) => void (d.explanation = e.target.value))} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Verification {needsSource ? <Badge variant="warning">required for this category</Badge> : null}
          </CardTitle>
          <CardDescription>Never publish school facts you haven't checked. Record where the answer comes from and who verified it.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Status">
            <Select value={verification.status} onChange={(e) => onVerification({ ...verification, status: e.target.value as Verification["status"], verifiedAt: e.target.value === "verified" ? new Date().toISOString() : verification.verifiedAt })}>
              {VERIFICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === "needs_source" ? "Needs a source" : s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sources (one per line)" hint="URLs, documents, yearbooks, or interviews with dates.">
            <Textarea
              rows={3}
              value={verification.sources.join("\n")}
              onChange={(e) => onVerification({ ...verification, sources: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
          <Field label="Verified by">
            <Input value={verification.verifiedBy ?? ""} maxLength={80} onChange={(e) => onVerification({ ...verification, verifiedBy: e.target.value || undefined })} />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} value={verification.notes} onChange={(e) => onVerification({ ...verification, notes: e.target.value })} />
          </Field>
          {verification.sources.filter((s) => /^https?:\/\//.test(s)).map((s) => (
            <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline">
              <ExternalLink className="size-3" /> {s}
            </a>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

// --- Mini Match ---------------------------------------------------------------------------------

function MatchEditor({ data, onChange }: { data: MatchData; onChange: (d: MatchData) => void }) {
  const toast = useToast();
  const set = (fn: (d: MatchData) => void) => {
    const next = structuredClone(data);
    fn(next);
    onChange(next);
  };
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `card-${Date.now() % 10000}`;
  const upload = async (i: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await postForm<{ id: string }>("/uploads", form);
      set((d) => {
        d.items[i].imageId = r.id;
        delete d.items[i].icon;
      });
    } catch (err) {
      toast({ tone: "error", title: "Upload failed", description: (err as Error).message });
    }
  };
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>Six pairs are drawn from these cards each game. Every card needs a different picture; vary colors too so pairs read quickly.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={data.name} maxLength={40} onChange={(e) => set((d) => void (d.name = e.target.value))} />
          </Field>
          <Field label="Card back pattern">
            <Select value={data.back} onChange={(e) => set((d) => void (d.back = e.target.value as MatchData["back"]))}>
              {["dots", "stripes", "grid", "waves", "checks"].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Input value={data.description ?? ""} maxLength={120} onChange={(e) => set((d) => void (d.description = e.target.value))} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cards ({data.items.length})</CardTitle>
          <CardDescription>6–12 cards. Pick a bundled icon or upload a PNG, JPEG, or WebP (2 MB max).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.items.map((item, i) => {
            const Icon = item.icon ? MATCH_ICONS[item.icon as keyof typeof MATCH_ICONS] : null;
            return (
              <div key={i} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[4rem_1fr_1fr_6rem_auto]">
                <div className="grid size-16 place-items-center rounded-md border-2 border-foreground text-white" style={{ background: item.color } as CSSProperties}>
                  {item.imageId ? <img src={`/uploads/${item.imageId}`} alt="" className="size-12 object-contain" /> : Icon ? <Icon className="size-8" /> : null}
                </div>
                <Field label="Label">
                  <Input
                    value={item.label}
                    maxLength={32}
                    onChange={(e) =>
                      set((d) => {
                        d.items[i].label = e.target.value;
                        d.items[i].id = slug(e.target.value);
                      })
                    }
                  />
                </Field>
                <Field label="Picture">
                  <div className="flex gap-2">
                    <Select
                      value={item.icon ?? ""}
                      onChange={(e) =>
                        set((d) => {
                          d.items[i].icon = e.target.value || undefined;
                          if (e.target.value) delete d.items[i].imageId;
                        })
                      }
                    >
                      <option value="">{item.imageId ? "Uploaded image" : "Choose an icon"}</option>
                      {MATCH_ICON_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </Select>
                    <label className="inline-flex h-9 cursor-pointer items-center rounded-md border px-2 text-xs hover:bg-muted" title="Upload image">
                      <Upload className="size-4" />
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(i, e.target.files[0])} />
                    </label>
                  </div>
                </Field>
                <Field label="Color">
                  <Input type="color" value={item.color} onChange={(e) => set((d) => void (d.items[i].color = e.target.value))} className="h-9 p-1" />
                </Field>
                <Button variant="outline" size="icon" aria-label="Remove card" onClick={() => set((d) => void d.items.splice(i, 1))}>
                  <Trash2 />
                </Button>
              </div>
            );
          })}
          <div>
            <Button
              variant="outline"
              disabled={data.items.length >= 12}
              onClick={() =>
                set((d) =>
                  void d.items.push({
                    id: `card-${d.items.length + 1}`,
                    label: `Card ${d.items.length + 1}`,
                    icon: MATCH_ICON_KEYS.find((k) => !d.items.some((it) => it.icon === k)),
                    color: PALETTE[d.items.length % PALETTE.length],
                  }),
                )
              }
            >
              <Plus /> Add card
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
