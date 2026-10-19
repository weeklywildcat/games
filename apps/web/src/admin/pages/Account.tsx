import { KeyRound, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Confirm, ErrorNote, Loading, PageHeader, useLoad } from "../components/common.tsx";
import { del, get, post, setCsrf } from "../lib/api.ts";
import { formatTime } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card.tsx";
import { Field, Input } from "../ui/input.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";
import { useToast } from "../ui/toast.tsx";

export function AccountPage() {
  const toast = useToast();
  const users = useLoad(() => get<{ users: { id: number; username: string; createdAt: string; lastLoginAt: string | null }[]; me: string }>("/users"), []);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [removeId, setRemoveId] = useState<number | null>(null);

  const changePassword = async () => {
    if (next !== again) {
      toast({ tone: "error", title: "The new passwords don't match" });
      return;
    }
    try {
      const r = await post<{ csrf: string }>("/account/password", { currentPassword: current, newPassword: next });
      setCsrf(r.csrf);
      setCurrent("");
      setNext("");
      setAgain("");
      toast({ tone: "success", title: "Password changed", description: "Other sessions were signed out." });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't change password", description: (err as Error).message });
    }
  };

  return (
    <>
      <PageHeader title="Account" description="Admin accounts for staff and newsroom editors. Students never need an account to play." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Change your password</CardTitle>
            <CardDescription>At least 12 characters. A short sentence works well.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password">
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Repeat new password">
              <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            </Field>
          </CardContent>
          <CardFooter>
            <Button onClick={changePassword} disabled={!current || !next}>
              <KeyRound /> Change password
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div className="grid gap-1">
              <CardTitle>Admins</CardTitle>
              <CardDescription>Lost every password? On the Pi, run npm run admin -- reset-password.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <UserPlus /> Add admin
            </Button>
          </CardHeader>
          <CardContent>
            {users.error ? <ErrorNote error={users.error} /> : null}
            {!users.data ? (
              <Loading />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.data.users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.username} {u.username === users.data!.me ? <Badge variant="secondary">you</Badge> : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatTime(u.lastLoginAt)}</TableCell>
                      <TableCell className="text-right">
                        {u.username !== users.data!.me ? (
                          <Button size="sm" variant="ghost" onClick={() => setRemoveId(u.id)} aria-label={`Remove ${u.username}`}>
                            <Trash2 />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <Confirm
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add an admin"
        destructive={false}
        confirmLabel="Create admin"
        requirePassword
        onConfirm={async (password) => {
          await post("/users", { username: newUser, password: newPass, currentPassword: password });
          toast({ tone: "success", title: `Created ${newUser}` });
          setNewUser("");
          setNewPass("");
          users.reload();
        }}
      >
        <Field label="Username">
          <Input value={newUser} onChange={(e) => setNewUser(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Their password (12+ characters)">
          <Input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" />
        </Field>
      </Confirm>
      <Confirm
        open={removeId !== null}
        onOpenChange={(o) => !o && setRemoveId(null)}
        title="Remove this admin?"
        confirmLabel="Remove"
        requirePassword
        onConfirm={async (password) => {
          await del(`/users/${removeId}`, { currentPassword: password });
          toast({ tone: "success", title: "Admin removed" });
          users.reload();
        }}
      />
    </>
  );
}
