import { Gamepad2, Grid3x3, HardDrive, LayoutDashboard, ListOrdered, LogOut, Monitor, Puzzle, Settings2, Trophy, UserCog, Brain } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { get, post, setCsrf, setUnauthenticatedHandler } from "./lib/api.ts";
import { Link, match, useRouter } from "./lib/router.tsx";
import { cn } from "./lib/utils.ts";
import { Loading } from "./components/common.tsx";
import { AccountPage } from "./pages/Account.tsx";
import { AuthScreen } from "./pages/Auth.tsx";
import { ContentEditorPage } from "./pages/ContentEditor.tsx";
import { ContentListPage } from "./pages/ContentList.tsx";
import { KioskPage } from "./pages/Kiosk.tsx";
import { LeaderboardsPage } from "./pages/Leaderboards.tsx";
import { OverviewPage } from "./pages/Overview.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { SystemPage } from "./pages/System.tsx";

interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
  user: { username: string } | null;
  csrf: string | null;
  version: string;
}

const NAV: { to: string; label: string; icon: ReactNode; match?: string }[] = [
  { to: "/admin", label: "Overview", icon: <LayoutDashboard /> },
  { to: "/admin/kiosk", label: "Kiosk control", icon: <Monitor /> },
  { to: "/admin/content/word", label: "Word answers", icon: <Grid3x3 />, match: "/admin/content/word" },
  { to: "/admin/content/connections", label: "Connections", icon: <Puzzle />, match: "/admin/content/connections" },
  { to: "/admin/content/trivia", label: "Trivia", icon: <Brain />, match: "/admin/content/trivia" },
  { to: "/admin/content/match", label: "Mini Match themes", icon: <Gamepad2 />, match: "/admin/content/match" },
  { to: "/admin/leaderboards", label: "Leaderboards", icon: <Trophy /> },
  { to: "/admin/settings", label: "Settings", icon: <Settings2 /> },
  { to: "/admin/system", label: "System", icon: <HardDrive /> },
  { to: "/admin/account", label: "Account", icon: <UserCog /> },
];

function Page({ path }: { path: string }) {
  let m: Record<string, string> | null;
  if ((m = match("/admin", path))) return <OverviewPage />;
  if ((m = match("/admin/kiosk", path))) return <KioskPage />;
  if ((m = match("/admin/content/item/:id", path))) return <ContentEditorPage id={m.id} />;
  if ((m = match("/admin/content/:type/new", path))) return <ContentEditorPage type={m.type} />;
  if ((m = match("/admin/content/:type", path))) return <ContentListPage key={m.type} type={m.type} />;
  if ((m = match("/admin/leaderboards", path))) return <LeaderboardsPage />;
  if ((m = match("/admin/settings", path))) return <SettingsPage />;
  if ((m = match("/admin/system", path))) return <SystemPage />;
  if ((m = match("/admin/account", path))) return <AccountPage />;
  return (
    <div className="py-20 text-center text-muted-foreground">
      <p>That page doesn't exist.</p>
      <Link to="/admin" className="underline">
        Back to the overview
      </Link>
    </div>
  );
}

export function AdminApp() {
  const { path } = useRouter();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await get<AuthStatus>("/auth/status");
      setCsrf(s.csrf);
      setStatus(s);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => void refresh());
    void refresh();
  }, [refresh]);

  if (error && !status)
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div className="grid gap-2">
          <p className="font-medium">The dashboard can't reach the server.</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  if (!status) return <Loading label="Connecting" />;
  if (!status.authenticated) return <AuthScreen needsSetup={status.needsSetup} onDone={refresh} />;

  const active = (item: (typeof NAV)[number]) => (item.match ? path.startsWith(item.match) : path.split("?")[0].replace(/\/$/, "") === item.to);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b bg-card lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <span className="grid grid-cols-2 gap-0.5" aria-hidden="true">
            <i className="size-2.5 rounded-[2px] bg-word" />
            <i className="size-2.5 rounded-[2px] bg-amber-400" />
            <i className="size-2.5 rounded-[2px] bg-trivia" />
            <i className="size-2.5 rounded-[2px] bg-match" />
          </span>
          <div className="leading-tight">
            <p className="display text-sm uppercase">Wildcat Games</p>
            <p className="text-xs text-muted-foreground">Admin · v{status.version}</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:grid lg:overflow-visible" aria-label="Admin">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4",
                active(item) && "bg-muted text-foreground",
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t px-5 py-4 text-sm lg:absolute lg:inset-x-0 lg:bottom-0 lg:block">
          <p className="truncate text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{status.user?.username}</span>
          </p>
          <div className="mt-2 flex gap-3">
            <a href="/play" target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline">
              <ListOrdered className="size-3.5" /> Open board
            </a>
            <button
              className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
              onClick={async () => {
                await post("/auth/logout").catch(() => undefined);
                await refresh();
              }}
            >
              <LogOut className="size-3.5" /> Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <Page path={path} />
      </main>
    </div>
  );
}
