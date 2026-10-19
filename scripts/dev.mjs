// Runs the API server (with reload) and the Vite dev server together.
// Open http://127.0.0.1:5173/play for the board and /admin for the dashboard.
import { spawn } from "node:child_process";

const procs = [
  ["server", "npx", ["tsx", "watch", "--clear-screen=false", "apps/server/src/index.ts"]],
  ["web", "npx", ["vite", "--config", "apps/web/vite.config.ts"]],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const tag = name === "server" ? "\x1b[35m[server]\x1b[0m" : "\x1b[36m[web]\x1b[0m";
  for (const stream of [p.stdout, p.stderr]) {
    stream.on("data", (buf) => {
      for (const line of buf.toString().split("\n")) if (line.trim()) console.log(`${tag} ${line}`);
    });
  }
  p.on("exit", (code) => {
    console.log(`${tag} exited with ${code}`);
    shutdown(code ?? 1);
  });
  return p;
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
