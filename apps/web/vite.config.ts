import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = import.meta.dirname;
const api = `http://127.0.0.1:${process.env.WG_PORT ?? 8787}`;

/** Dev-only SPA fallbacks that mirror the production server's routes. */
function spaRoutes(): Plugin {
  return {
    name: "wildcat-spa-routes",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "/";
        if (url === "/" ) req.url = "/play/";
        else if (/^\/(play|preview)(\/|\?|$)/.test(url) && !url.includes(".")) req.url = "/play/index.html";
        else if (/^\/admin(\/|\?|$)/.test(url) && !url.includes(".")) req.url = "/admin/index.html";
        next();
      });
    },
  };
}

export default defineConfig({
  root,
  base: "/",
  publicDir: resolve(root, "public"),
  plugins: [spaRoutes(), react(), tailwindcss()],
  resolve: {
    alias: { "@admin": resolve(root, "src/admin"), "@play": resolve(root, "src/play") },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/health": api,
      "/uploads": api,
    },
  },
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: { play: resolve(root, "play/index.html"), admin: resolve(root, "admin/index.html") },
    },
  },
});
