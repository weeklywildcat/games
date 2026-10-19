// Bundles the server (and its shared code) into single files for production.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};

await build({ ...common, entryPoints: ["apps/server/src/index.ts"], outfile: "apps/server/dist/index.mjs" });
await build({ ...common, entryPoints: ["apps/server/src/cli.ts"], outfile: "apps/server/dist/cli.mjs" });
