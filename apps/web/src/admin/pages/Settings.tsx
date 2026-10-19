import { Save, Undo2, Upload } from "lucide-react";
import { ErrorNote, Loading, PageHeader } from "../components/common.tsx";
import { useSettings } from "../components/useSettings.ts";
import { postForm } from "../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx";
import { Field, Input } from "../ui/input.tsx";
import { Switch } from "../ui/switch.tsx";
import { useToast } from "../ui/toast.tsx";

export function SettingsPage() {
  const toast = useToast();
  const { draft, update, save, saving, dirty, reset, error } = useSettings();
  if (!draft) return error ? <ErrorNote error={error} /> : <Loading />;

  const uploadLogo = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await postForm<{ url: string }>("/uploads", form);
      update((d) => void (d.branding.logoUrl = r.url));
      toast({ tone: "success", title: "Logo uploaded", description: "Save settings to use it on the board." });
    } catch (err) {
      toast({ tone: "error", title: "Upload failed", description: (err as Error).message });
    }
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Competition dates, timing, branding, and privacy. Display controls live on the Kiosk page."
        actions={
          <>
            <Button variant="outline" onClick={reset} disabled={!dirty || saving}>
              <Undo2 /> Discard
            </Button>
            <Button onClick={() => save()} disabled={!dirty || saving}>
              <Save /> Save settings
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Community challenge
              <Switch label="Challenge enabled" checked={draft.challenge.enabled} onCheckedChange={(v) => update((d) => void (d.challenge.enabled = v))} />
            </CardTitle>
            <CardDescription>A school-wide goal shown in attract mode and on the home screen. Progress counts solved puzzles (any game) between the dates.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Title">
              <Input value={draft.challenge.title} maxLength={80} onChange={(e) => update((d) => void (d.challenge.title = e.target.value))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Target">
                <Input type="number" min={1} value={draft.challenge.target} onChange={(e) => update((d) => void (d.challenge.target = Number(e.target.value)))} />
              </Field>
              <Field label="Starts">
                <Input type="date" value={draft.challenge.start} onChange={(e) => update((d) => void (d.challenge.start = e.target.value))} />
              </Field>
              <Field label="Ends">
                <Input type="date" value={draft.challenge.end} onChange={(e) => update((d) => void (d.challenge.end = e.target.value))} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Event leaderboard</CardTitle>
            <CardDescription>The middle tab on the board's leaderboards. Launch week is October 26–30, 2026.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Name">
              <Input value={draft.event.name} maxLength={40} onChange={(e) => update((d) => void (d.event.name = e.target.value))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts">
                <Input type="date" value={draft.event.start} onChange={(e) => update((d) => void (d.event.start = e.target.value))} />
              </Field>
              <Field label="Ends">
                <Input type="date" value={draft.event.end} onChange={(e) => update((d) => void (d.event.end = e.target.value))} />
              </Field>
            </div>
            <Field label="Timezone" hint="Days, resets, and quiet hours use this timezone.">
              <Input value={draft.timezone} onChange={(e) => update((d) => void (d.timezone = e.target.value))} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Game timing</CardTitle>
            <CardDescription>Tune these after watching students play.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Trivia round clock (seconds)">
              <Input type="number" min={30} max={300} value={draft.trivia.roundSeconds} onChange={(e) => update((d) => void (d.trivia.roundSeconds = Number(e.target.value)))} />
            </Field>
            <Field label="Wildcat Rush length (seconds)">
              <Input type="number" min={30} max={300} value={draft.rush.seconds} onChange={(e) => update((d) => void (d.rush.seconds = Number(e.target.value)))} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
            <CardDescription>Swap in official artwork without touching the layout.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Publication name">
              <Input value={draft.branding.publicationName} maxLength={60} onChange={(e) => update((d) => void (d.branding.publicationName = e.target.value))} />
            </Field>
            <Field label="School name">
              <Input value={draft.branding.schoolName} maxLength={80} onChange={(e) => update((d) => void (d.branding.schoolName = e.target.value))} />
            </Field>
            <Field label="Logo" hint="PNG, JPEG, or WebP. Shown beside the Wildcat Games wordmark.">
              <div className="flex items-center gap-3">
                {draft.branding.logoUrl ? <img src={draft.branding.logoUrl} alt="" className="h-10 w-auto rounded border bg-white p-1" /> : null}
                <Input value={draft.branding.logoUrl} onChange={(e) => update((d) => void (d.branding.logoUrl = e.target.value))} />
                <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-3 text-sm hover:bg-muted">
                  <Upload className="size-4" /> Upload
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                </label>
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Privacy and retention</CardTitle>
            <CardDescription>
              Wildcat Games stores no names, accounts, or IP addresses. Game sessions and anonymous events older than this are deleted nightly; claimed leaderboard entries (a generated nickname and a score) are kept.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Keep gameplay records for (days)">
              <Input type="number" min={7} max={3650} value={draft.privacy.retentionDays} onChange={(e) => update((d) => void (d.privacy.retentionDays = Number(e.target.value)))} />
            </Field>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
