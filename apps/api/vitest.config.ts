import { defineConfig } from "vitest/config";

// Unit and HTTP tests: no database or network needed.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], exclude: ["tests/**/*.db.test.ts"] }
});
