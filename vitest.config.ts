import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/server/test/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 20_000,
    env: { NODE_ENV: "test" },
  },
});
