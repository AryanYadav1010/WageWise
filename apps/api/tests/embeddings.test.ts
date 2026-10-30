import { describe, expect, it } from "vitest";
import { HashingEmbeddingProvider } from "../src/embeddings/mock-provider.ts";
import { embedWithRetry, EmbeddingProviderError, toVectorLiteral, validateVectors, type EmbeddingProvider } from "../src/embeddings/provider.ts";

const noSleep = { sleeps: [] as number[], sleep: async function (this: void, ms: number) { noSleep.sleeps.push(ms); } };
const retry = (overrides: Partial<{ maxAttempts: number; timeoutMs: number }> = {}) =>
  ({ maxAttempts: 3, timeoutMs: 1_000, baseDelayMs: 100, sleep: noSleep.sleep, ...overrides });

/** Fails with the given errors in order, then returns valid vectors. */
function flakyProvider(failures: Error[], dimensions = 4): EmbeddingProvider & { calls: number } {
  return {
    modelId: "test:flaky", dimensions, maxInputTokens: 100, calls: 0,
    async embed(texts) {
      this.calls += 1;
      const failure = failures[this.calls - 1];
      if (failure !== undefined) throw failure;
      return texts.map(() => [1, 0, 0, 0].slice(0, dimensions));
    }
  };
}

describe("validateVectors", () => {
  it("accepts the right count of finite vectors of the right size", () => {
    expect(validateVectors([[1, 0], [0, 1]], 2, 2)).toEqual([[1, 0], [0, 1]]);
  });

  it("rejects wrong counts, wrong dimensions and non-finite values", () => {
    expect(() => validateVectors([[1, 0]], 2, 2)).toThrow(/Expected 2 vectors/);
    expect(() => validateVectors([[1, 0, 0]], 1, 2)).toThrow(/dimension 2/);
    expect(() => validateVectors([[1, Number.NaN]], 1, 2)).toThrow(/non-finite/);
    expect(() => validateVectors([[1, "0.5"]], 1, 2)).toThrow(/non-finite/);
    expect(() => validateVectors({ data: [] }, 1, 2)).toThrow(EmbeddingProviderError);
  });

  it("formats vectors for pgvector without string interpolation of user data", () => {
    expect(toVectorLiteral([0.5, -1, 2e-7])).toBe("[0.5,-1,2e-7]");
  });
});

describe("embedWithRetry", () => {
  it("retries retryable errors with exponential backoff", async () => {
    noSleep.sleeps.length = 0;
    const provider = flakyProvider([
      new EmbeddingProviderError("rate_limited", "429", true),
      new EmbeddingProviderError("server_error", "503", true)
    ]);
    const result = await embedWithRetry(provider, ["a"], "document", retry());
    expect(result.attempts).toBe(3);
    expect(noSleep.sleeps).toEqual([100, 200]);
  });

  it("does not retry errors that cannot succeed on retry", async () => {
    const provider = flakyProvider([new EmbeddingProviderError("input_too_long", "too long", false)]);
    await expect(embedWithRetry(provider, ["a"], "document", retry())).rejects.toThrow(/too long/);
    expect(provider.calls).toBe(1);
  });

  it("gives up after maxAttempts", async () => {
    const failures = Array.from({ length: 5 }, () => new EmbeddingProviderError("server_error", "503", true));
    const provider = flakyProvider(failures);
    await expect(embedWithRetry(provider, ["a"], "document", retry({ maxAttempts: 2 }))).rejects.toThrow(/503/);
    expect(provider.calls).toBe(2);
  });

  it("times out a provider that never answers", async () => {
    const hanging: EmbeddingProvider = { modelId: "test:hang", dimensions: 2, maxInputTokens: 10, embed: () => new Promise(() => undefined) };
    await expect(embedWithRetry(hanging, ["a"], "query", retry({ maxAttempts: 1, timeoutMs: 20 }))).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects a provider that returns vectors of the wrong dimension", async () => {
    const wrongSize: EmbeddingProvider = { modelId: "test:wrong", dimensions: 3, maxInputTokens: 10, embed: async texts => texts.map(() => [1, 0]) };
    await expect(embedWithRetry(wrongSize, ["a"], "document", retry())).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("HashingEmbeddingProvider (test double)", () => {
  it("is deterministic and unit-length", async () => {
    const provider = new HashingEmbeddingProvider(32);
    const [first] = await provider.embed(["Income tax personal allowance"], "document");
    const [second] = await provider.embed(["Income tax personal allowance"], "document");
    expect(first).toEqual(second);
    const norm = Math.sqrt((first ?? []).reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it("returns a unit vector even for stop-word-only text", async () => {
    const [vector] = await new HashingEmbeddingProvider(8).embed(["the and of"], "query");
    expect(vector).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });
});
