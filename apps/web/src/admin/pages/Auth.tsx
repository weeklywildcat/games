import { KeyRound, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { post } from "../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx";
import { Field, Input } from "../ui/input.tsx";

/** First-run setup (with the one-time setup code) or sign-in. */
export function AuthScreen({ needsSetup, onDone }: { needsSetup: boolean; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      if (needsSetup) await post("/auth/setup", { setupCode: code, username, password });
      else await post("/auth/login", { username, password });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid grid-cols-2 gap-0.5" aria-hidden="true">
              <i className="size-3 rounded-[2px] bg-word" />
              <i className="size-3 rounded-[2px] bg-amber-400" />
              <i className="size-3 rounded-[2px] bg-trivia" />
              <i className="size-3 rounded-[2px] bg-match" />
            </span>
            <span className="display text-sm uppercase">Wildcat Games</span>
          </div>
          <CardTitle className="text-xl">{needsSetup ? "Set up the first admin" : "Staff sign-in"}</CardTitle>
          <CardDescription>
            {needsSetup
              ? "Enter the one-time setup code from the server, then choose a username and a strong password. There is no default password."
              : "Manage puzzles, leaderboards, and the library board."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            {needsSetup ? (
              <Field label="Setup code" hint="Printed in the server log on first start, and saved to data/setup-code.txt on the device.">
                <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required spellCheck={false} className="font-mono uppercase tracking-widest" />
              </Field>
            ) : null}
            <Field label="Username">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus />
            </Field>
            <Field label="Password" hint={needsSetup ? "At least 12 characters." : undefined}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? "new-password" : "current-password"} required />
            </Field>
            {needsSetup ? (
              <Field label="Confirm password">
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
              </Field>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy} size="lg">
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {needsSetup ? "Create admin" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
