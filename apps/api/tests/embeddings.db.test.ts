import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmbeddingJobAlreadyRunningError, runEmbeddingJob } from "../src/embeddings/job.ts";
import { HashingEmbeddingProvider } from "../src/embeddings/mock-provider.ts";
import { EmbeddingProviderError, type EmbeddingProvider, type EmbeddingPurpose } from "../src/embeddings/provider.ts";
import { count, createMigratedDatabase, silentLogger, type TestDatabase } from "./db-helpers.ts";
import { fixtureUpstream, ingestFixtures } from "./db-fixtures.ts";

let database: TestDatabase;
beforeEach(async () => { database = await createMigratedDatabase(); });
afterEach(async () => { await database.drop(); });

const options = { batchSize: 8, retry: { maxAttempts: 3, timeoutMs: 2_000, baseDelayMs: 1, sleep: async () => undefined } };
const embed = (provider: EmbeddingProvider) => runEmbeddingJob(database.pool, provider, silentLogger, options);
const approvedChunks = () => count(database.pool, "SELECT * FROM retrievable_chunks");

/** Wraps a provider so selected calls fail. */
class FailingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  readonly maxInputTokens = 10_000;
  calls = 0;
  constructor(private readonly inner: EmbeddingProvider, private readonly failOnCall: (call: number) => Error | null) {
    this.modelId = inner.modelId;
    this.dimensions = inner.dimensions;
  }
  async embed(texts: readonly string[], purpose: EmbeddingPurpose): Promise<number[][]> {
    this.calls += 1;
    const failure = this.failOnCall(this.calls);
    if (failure !== null) throw failure;
    return this.inner.embed(texts, purpose);
  }
}

describe("licence gate", () => {
  it("never sends unapproved content to the provider", async () => {
    await ingestFixtures(database.pool, { approved: [] });
    const provider = new HashingEmbeddingProvider();
    const summary = await embed(provider);
    expect(summary).toMatchObject({ status: "success", candidates: 0, computed: 0 });
    expect(provider.calls).toHaveLength(0);
    expect(await count(database.pool, "SELECT * FROM chunk_embeddings")).toBe(0);
  });

  it("embeds only the approved guides", async () => {
    await ingestFixtures(database.pool, { approved: ["/tax-codes"] });
    const provider = new HashingEmbeddingProvider();
    await embed(provider);
    const embeddedTexts = provider.calls.flatMap(call => call.texts);
    const taxCodeChunks = await count(database.pool, "SELECT * FROM retrievable_chunks WHERE canonical_url = 'https://www.gov.uk/tax-codes'");
    expect(embeddedTexts).toHaveLength(taxCodeChunks);
    expect(await count(database.pool, `
      SELECT * FROM chunk_embeddings e JOIN document_chunks c ON c.id = e.chunk_id JOIN document_versions v ON v.id = c.version_id
      JOIN source_documents d ON d.id = v.document_id WHERE d.base_path <> '/tax-codes'`)).toBe(0);
    expect(provider.calls.every(call => call.purpose === "document")).toBe(true);
  });
});

describe("idempotency and resumption", () => {
  it("embeds everything once; a second run does nothing", async () => {
    await ingestFixtures(database.pool, { approved: ["/tax-codes", "/welsh-income-tax"] });
    const total = await approvedChunks();
    expect(await embed(new HashingEmbeddingProvider())).toMatchObject({ status: "success", candidates: total, computed: total, failed: 0 });
    expect(await embed(new HashingEmbeddingProvider())).toMatchObject({ status: "success", candidates: 0, computed: 0 });
    expect(await count(database.pool, "SELECT * FROM chunk_embeddings")).toBe(total);
    expect(await count(database.pool, "SELECT * FROM embedding_runs WHERE status = 'success'")).toBe(2);
  });

  it("records a partial run when a batch fails, and a later run finishes the rest", async () => {
    await ingestFixtures(database.pool, { approved: ["/tax-codes", "/national-insurance"] });
    const total = await approvedChunks();
    const failSecondBatch = new FailingProvider(new HashingEmbeddingProvider(), call =>
      call === 2 ? new EmbeddingProviderError("invalid_response", "bad batch", false) : null);
    const first = await embed(failSecondBatch);
    expect(first.status).toBe("partial");
    expect(first.failed).toBe(8);
    expect(first.computed).toBe(total - 8);

    const second = await embed(new HashingEmbeddingProvider());
    expect(second).toMatchObject({ status: "success", candidates: 8, computed: 8 });
    expect(await count(database.pool, "SELECT * FROM chunk_embeddings")).toBe(total);
  });

  it("retries transient provider errors within a batch", async () => {
    await ingestFixtures(database.pool, { approved: ["/welsh-income-tax"] });
    const flaky = new FailingProvider(new HashingEmbeddingProvider(), call =>
      call <= 2 ? new EmbeddingProviderError("rate_limited", "429", true) : null);
    const summary = await embed(flaky);
    expect(summary).toMatchObject({ status: "success", failed: 0 });
    expect(flaky.calls).toBeGreaterThanOrEqual(3);
  });

  it("marks the run failed when the provider is down for every batch", async () => {
    await ingestFixtures(database.pool, { approved: ["/welsh-income-tax"] });
    const down = new FailingProvider(new HashingEmbeddingProvider(), () => new EmbeddingProviderError("unavailable", "down", true));
    expect((await embed(down)).status).toBe("failed");
    expect(await count(database.pool, "SELECT * FROM chunk_embeddings")).toBe(0);
  });

  it("refuses to run while another job holds the lock", async () => {
    const holder = await database.pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(7120003)");
      await expect(embed(new HashingEmbeddingProvider())).rejects.toThrow(EmbeddingJobAlreadyRunningError);
    } finally {
      await holder.query("SELECT pg_advisory_unlock(7120003)");
      holder.release();
    }
  });
});

describe("vector validation", () => {
  it("rejects a provider that returns the wrong dimension, storing nothing", async () => {
    await ingestFixtures(database.pool, { approved: ["/welsh-income-tax"] });
    const liar: EmbeddingProvider = { modelId: "test:liar", dimensions: 8, maxInputTokens: 100, embed: async texts => texts.map(() => [1, 0, 0]) };
    expect((await embed(liar)).status).toBe("failed");
    expect(await count(database.pool, "SELECT * FROM chunk_embeddings")).toBe(0);
  });

  it("refuses a model id already registered with a different dimension", async () => {
    await ingestFixtures(database.pool, { approved: ["/welsh-income-tax"] });
    await embed(new HashingEmbeddingProvider(64, "same"));
    const changed = new HashingEmbeddingProvider(32, "same");
    Object.defineProperty(changed, "modelId", { value: new HashingEmbeddingProvider(64, "same").modelId });
    await expect(embed(changed)).rejects.toThrow(/registered with 64 dimensions/);
  });
});

describe("content updates", () => {
  it("reuses vectors for unchanged text in a new version and computes only what changed", async () => {
    const upstream = fixtureUpstream();
    await ingestFixtures(database.pool, { approved: ["/tax-codes"], paths: ["/tax-codes"], upstream });
    await embed(new HashingEmbeddingProvider());

    // GOV.UK edits one part of the guide: a new version with mostly identical chunk texts.
    const json = JSON.parse(upstream.get("/tax-codes") ?? "{}") as { details: { parts: { body: string }[] } };
    const firstPart = json.details.parts[0];
    if (firstPart === undefined) throw new Error("fixture changed");
    firstPart.body = `${firstPart.body}<p>A new sentence added by GOV.UK.</p>`;
    upstream.set("/tax-codes", JSON.stringify(json));
    await ingestFixtures(database.pool, { approved: ["/tax-codes"], paths: ["/tax-codes"], upstream });

    const provider = new HashingEmbeddingProvider();
    const summary = await embed(provider);
    expect(summary.reused).toBeGreaterThan(0);
    expect(summary.computed).toBeGreaterThan(0);
    expect(summary.computed).toBeLessThan(summary.reused);
    // Every active chunk now has a vector; superseded chunks are no longer candidates.
    expect(await count(database.pool, `
      SELECT * FROM retrievable_chunks rc LEFT JOIN chunk_embeddings e ON e.chunk_id = rc.chunk_id WHERE e.chunk_id IS NULL`)).toBe(0);
  });
});
