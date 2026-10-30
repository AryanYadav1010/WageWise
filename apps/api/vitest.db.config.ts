import { defineConfig } from "vitest/config";

// PostgreSQL integration tests. Each test creates and drops its own database (and advisory
// locks are per database), so files run in parallel safely. Against a remote database (Neon,
// ~150 ms per round trip from the UK to us-east-2) most of the time is network latency.
// Requires TEST_DATABASE_URL: a direct connection to a separate test database or Neon branch.
export default defineConfig({
  test: { include: ["tests/**/*.db.test.ts"], fileParallelism: true, testTimeout: 180_000, hookTimeout: 300_000 }
});
