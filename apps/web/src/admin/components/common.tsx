import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ContentStatus, ValidationIssue } from "@wildcat/shared";
import { AdminApiError } from "../lib/api.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { Field, Input } from "../ui/input.tsx";

/** Loads data and exposes reload; keeps the last good value while refreshing. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = [], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    if (!pollMs) return;
    const t = window.setInterval(reload, pollMs);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" /> {label}…
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      <AlertTriangle className="size-4" />
      <span className="flex-1">{error}</span>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

const STATUS_VARIANT: Record<ContentStatus, "secondary" | "warning" | "info" | "success" | "outline"> = {
  draft: "secondary",
  review: "warning",
  approved: "info",
  published: "success",
  archived: "outline",
};

export function StatusBadge({ status }: { status: ContentStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}

export function Issues({ errors, warnings }: { errors: ValidationIssue[]; warnings: ValidationIssue[] }) {
  if (!errors.length && !warnings.length) return <p className="text-sm text-success">No validation issues.</p>;
  return (
    <ul className="grid gap-1.5 text-sm">
      {errors.map((e, i) => (
        <li key={`e${i}`} className="flex gap-2 text-red-700">
          <Badge variant="destructive">error</Badge>
          <span>
            {e.message} <span className="text-xs text-muted-foreground">({e.path})</span>
          </span>
        </li>
      ))}
      {warnings.map((w, i) => (
        <li key={`w${i}`} className="flex gap-2 text-amber-900">
          <Badge variant="warning">check</Badge>
          <span>
            {w.message} <span className="text-xs text-muted-foreground">({w.path})</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Confirmation for dangerous actions. Optionally requires the admin's password
 * (re-authentication) and/or typing a phrase.
 */
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = true,
  requirePassword = false,
  phrase,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  requirePassword?: boolean;
  phrase?: string;
  onConfirm: (password: string) => Promise<void> | void;
  children?: ReactNode;
}) {
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPassword("");
      setTyped("");
      setError(null);
    }
  }, [open]);
  const ready = (!requirePassword || password.length > 0) && (!phrase || typed === phrase);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(password);
                onOpenChange(false);
              } catch (err) {
                setError(err instanceof AdminApiError ? err.message : (err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {requirePassword ? (
        <Field label="Your password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      ) : null}
      {phrase ? (
        <Field label={`Type ${phrase} to confirm`}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </Dialog>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border bg-card p-4">
      {accent ? <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} /> : null}
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
