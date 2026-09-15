import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    timeout: 30000,
    // Remote-DB integration suite: beforeAll/afterAll hooks run several
    // round-trips (and PBKDF2 user seeding) against the pooled Neon endpoint,
    // so vitest's 10s default hook timeout is too small for them.
    hookTimeout: 120000,
    // Both integration suites share ONE database and content-integrity performs
    // global sweeps (questionOption/questionVersion/questionNumericAnswer
    // deleteMany({})), so test FILES must not interleave. Keeping it serial also
    // avoids pool starvation on the pooled Neon endpoint.
    fileParallelism: false,
  },
});
