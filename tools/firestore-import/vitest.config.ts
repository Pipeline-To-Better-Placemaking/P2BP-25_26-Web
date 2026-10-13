import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The server's env.ts (pulled in by createTestDb) needs these dummy variables.
    setupFiles: ["../../BetterPlacemaking.SERVER.EXPRESS/src/test/setupEnv.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
