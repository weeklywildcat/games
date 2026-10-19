import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppContext } from "./context.ts";
import { clientIp, errorResponse, HttpError, requireNetwork, type Env } from "./http.ts";
import { adminRoutes } from "./routes/admin.ts";
import { publicRoutes } from "./routes/public.ts";

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Motion writes inline transform styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export function createApp(app: AppContext) {
  const web = new Hono<Env>();

  web.use("*", async (c, next) => {
    c.set("app", app);
    c.set("ip", clientIp(c, app.config.trustProxy));
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
  });

  web.onError((err, c) => errorResponse(err, c));

  web.get("/health", (c) => {
    let db = "ok";
    try {
      app.db.get("SELECT 1");
    } catch {
      db = "error";
    }
    const status = db === "ok" ? "ok" : "degraded";
    c.header("Cache-Control", "no-store");
    return c.json({ status, version: app.config.version, uptimeSec: Math.round((Date.now() - app.startedAt) / 1000), db }, status === "ok" ? 200 : 503);
  });

  // Small JSON bodies everywhere except uploads and restores.
  web.use("/api/*", async (c, next) => {
    if (c.req.path.endsWith("/uploads") || c.req.path.endsWith("/system/restore") || c.req.path.endsWith("/import")) return next();
    return bodyLimit({ maxSize: 256 * 1024, onError: (cc) => cc.json({ error: "Request too large", code: "too_large" }, 413) })(c, next);
  });
  web.use("/api/admin/system/restore", bodyLimit({ maxSize: 210 * 1024 * 1024, onError: (cc) => cc.json({ error: "File too large" }, 413) }));
  web.use("/api/admin/uploads", bodyLimit({ maxSize: 3 * 1024 * 1024, onError: (cc) => cc.json({ error: "File too large" }, 413) }));
  web.use("/api/admin/content/*", bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (cc) => cc.json({ error: "Import too large" }, 413) }));

  web.route("/api/admin", adminRoutes());
  web.route("/api", publicRoutes());
  web.all("/api/*", (c) => c.json({ error: "Not found", code: "not_found" }, 404));

  // Uploaded images (Mini Match cards, logos).
  web.get("/uploads/:id", (c) => {
    const id = c.req.param("id");
    if (!/^[a-z0-9]{8,32}$/.test(id)) throw new HttpError(404, "Not found");
    const row = app.db.get<{ mime: string }>("SELECT mime FROM uploads WHERE id = ?", [id]);
    if (!row) throw new HttpError(404, "Not found");
    const ext = row.mime === "image/png" ? "png" : row.mime === "image/webp" ? "webp" : "jpg";
    const path = join(app.config.dataDir, "uploads", `${id}.${ext}`);
    if (!existsSync(path)) throw new HttpError(404, "Not found");
    c.header("Content-Type", row.mime);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(readFileSync(path));
  });

  // --- Built frontend ----------------------------------------------------------------
  const dist = app.config.staticDir;
  const page = (file: string) => {
    const path = join(dist, file);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };
  const sendPage = (c: Context<Env>, file: string) => {
    const html = page(file);
    if (!html) return c.text("The app hasn't been built yet. Run `npm run build`.", 503);
    c.header("Content-Security-Policy", PAGE_CSP);
    c.header("Cache-Control", "no-cache");
    return c.html(html);
  };

  web.get("/", (c) => c.redirect("/play", 302));
  web.get("/play", (c) => sendPage(c, "play/index.html"));
  web.get("/play/*", (c) => sendPage(c, "play/index.html"));
  web.get("/preview", (c) => sendPage(c, "play/index.html"));
  web.get("/preview/*", (c) => sendPage(c, "play/index.html"));
  web.get("/admin", (c) => {
    requireNetwork(c, app.config.adminNetworks, "The admin dashboard");
    return sendPage(c, "admin/index.html");
  });
  web.get("/admin/*", (c) => {
    requireNetwork(c, app.config.adminNetworks, "The admin dashboard");
    return sendPage(c, "admin/index.html");
  });

  web.get("/sw.js", async (c, next) => {
    c.header("Cache-Control", "no-cache");
    c.header("Service-Worker-Allowed", "/");
    await next();
  });
  web.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.status === 200) c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  web.use(
    "/*",
    serveStatic({
      root: dist,
      rewriteRequestPath: (p) => normalize(p).replace(/^(\.\.(\/|\\|$))+/, ""),
    }),
  );

  web.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "Not found" }, 404) : c.text("Not found", 404)));
  return web;
}
