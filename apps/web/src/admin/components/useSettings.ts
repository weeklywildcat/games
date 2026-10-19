import { useCallback, useEffect, useState } from "react";
import type { Settings } from "@wildcat/shared";
import { AdminApiError, get, put } from "../lib/api.ts";
import { useToast } from "../ui/toast.tsx";

/** Loads settings, tracks a local draft, and saves (the board updates live). */
export function useSettings() {
  const toast = useToast();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await get<Settings>("/settings");
      setSaved(s);
      setDraft(structuredClone(s));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback((fn: (d: Settings) => void) => {
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  }, []);

  const save = useCallback(
    async (next?: Settings) => {
      const body = next ?? draft;
      if (!body) return;
      setSaving(true);
      try {
        const s = await put<Settings>("/settings", body);
        setSaved(s);
        setDraft(structuredClone(s));
        toast({ tone: "success", title: "Saved", description: "The board picks up changes within a few seconds." });
      } catch (err) {
        const e = err as AdminApiError;
        const issues = (e.body?.issues as { path: string; message: string }[] | undefined)?.map((i) => `${i.path}: ${i.message}`).join("; ");
        toast({ tone: "error", title: "Couldn't save settings", description: issues || e.message });
      } finally {
        setSaving(false);
      }
    },
    [draft, toast],
  );

  const dirty = Boolean(saved && draft && JSON.stringify(saved) !== JSON.stringify(draft));
  const reset = () => saved && setDraft(structuredClone(saved));
  return { saved, draft, update, save, saving, dirty, reset, error, reload: load };
}
