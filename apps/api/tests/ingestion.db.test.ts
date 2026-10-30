import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CorpusEntry } from "../src/ingest/corpus.ts";
import { fetchGovukDocument } from "../src/ingest/govuk-client.ts";
import { IngestionAlreadyRunningError, runIngestion, type IngestionDependencies } from "../src/ingest/pipeline.ts";
import type { ChunkFn } from "../src/ingest/repository.ts";
import { verifyStore } from "../src/ingest/verify.ts";
import { count, createMigratedDatabase, silentLogger, type TestDatabase } from "./db-helpers.ts";
import { corpusEntries } from "./db-fixtures.ts";
import { fixtureBody } from "./govuk-fixtures.ts";

// End-to-end through the real client, parser, chunker, repository and SQL. Only the network
// is replaced: a fake fetch serves real (trimmed) GOV.UK responses we can edit per test.

type Upstream = { status: number; body: string } | "timeout";

let database: TestDatabase;
let upstream: Map<string, Upstream>;

beforeEach(async () => {
  database = await createMigratedDatabase();
  upstream = new Map([
    ["/tax-codes", { status: 200, body: fixtureBody("tax-codes") }],
    ["/income-tax-rates", { status: 200, body: fixtureBody("income-tax-rates") }],
    ["/welsh-income-tax", { status: 200, body: fixtureBody("welsh-income-tax") }]
  ]);
});
afterEach(async () => { await database.drop(); });

// No licence decisions unless a test adds one: independent of the real decisions in data/licence-reviews.json.
const entries: CorpusEntry[] = corpusEntries(["/tax-codes", "/income-tax-rates", "/welsh-income-tax"], []);
const options = { trigger: "manual" as const, chunkerConfig: { maxChars: 800, overlapChars: 100 }, delayBetweenRequestsMs: 0 };

const fakeFetch: typeof fetch = async input => {
  const path = new URL(String(input)).pathname.replace("/api/content", "");
  const response = upstream.get(path);
  if (response === undefined) return new Response("", { status: 404 });
  if (response === "timeout") throw new DOMException("timed out", "TimeoutError");
  return new Response(response.body, { status: response.status });
};

function dependencies(overrides: Partial<IngestionDependencies> = {}): IngestionDependencies {
  return {
    pool: database.pool,
    logger: silentLogger,
    sleep: async () => undefined,
    fetchDocument: path => fetchGovukDocument(path, { fetchImpl: fakeFetch, sleep: async () => undefined }),
    ...overrides
  };
}

function editWelshBody(edit: (body: string) => string): void {
  const json = JSON.parse(fixtureBody("welsh-income-tax")) as { details: { body: string } };
  json.details.body = edit(json.details.body);
  upstream.set("/welsh-income-tax", { status: 200, body: JSON.stringify(json) });
}

async function activeVersionId(basePath: string): Promise<string | undefined> {
  const result = await database.pool.query<{ id: string }>(
    "SELECT v.id FROM document_versions v JOIN source_documents d ON d.id = v.document_id WHERE d.base_path = $1 AND v.status = 'active'", [basePath]);
  return result.rows[0]?.id;
}

async function tableCounts() {
  return {
    versions: await count(database.pool, "SELECT * FROM document_versions"),
    sections: await count(database.pool, "SELECT * FROM document_sections"),
    chunks: await count(database.pool, "SELECT * FROM document_chunks")
  };
}

describe("first run", () => {
  it("stores versioned documents, sections and chunks with provenance", async () => {
    const summary = await runIngestion(dependencies(), entries, options);
    expect(summary.status).toBe("success");
    expect(summary.items.map(item => item.outcome)).toEqual(["new_version", "new_version", "new_version"]);

    const counts = await tableCounts();
    expect(counts.versions).toBe(3);
    expect(counts.sections).toBe(7 + 2 + 1);
    expect(counts.chunks).toBeGreaterThan(counts.sections);

    const report = await verifyStore(database.pool);
    expect(report.problems).toEqual([]);
    expect(report.documents.map(document => [document.basePath, document.licenceStatus])).toEqual([
      ["/income-tax-rates", "pending_review"], ["/tax-codes", "pending_review"], ["/welsh-income-tax", "pending_review"]
    ]);
  });

  it("links every chunk to its section deep link, version hash and run", async () => {
    const summary = await runIngestion(dependencies(), entries, options);
    const rows = (await database.pool.query<{ url: string; canonical_url: string; heading: string; ingestion_run_id: string; parser_version: string; chunker_version: string }>(`
      SELECT s.url, d.canonical_url, c.heading, v.ingestion_run_id, v.parser_version, c.chunker_version
      FROM document_chunks c JOIN document_sections s ON s.id = c.section_id
      JOIN document_versions v ON v.id = c.version_id JOIN source_documents d ON d.id = v.document_id`)).rows;
    for (const row of rows) {
      expect(row.url.startsWith(row.canonical_url)).toBe(true);
      expect(row.ingestion_run_id).toBe(summary.runId);
      expect(row.parser_version).toBe("govuk-parser-v2");
      expect(row.chunker_version).toBe("heading-paragraph-v1");
    }
    expect(rows.some(row => row.url === "https://www.gov.uk/tax-codes/emergency-tax-codes")).toBe(true);
    expect(rows.some(row => row.heading.startsWith("Income Tax rates and Personal Allowances > Current rates and allowances"))).toBe(true);
  });

  it("applies a section's tax year only while the quoted evidence is on the page", async () => {
    await runIngestion(dependencies(), entries, options);
    const periods = (await database.pool.query<{ slug: string; applies_from: string | null; applies_to: string | null }>(
      "SELECT slug, applies_from, applies_to FROM document_sections WHERE url LIKE 'https://www.gov.uk/income-tax-rates%' ORDER BY section_index")).rows;
    expect(periods).toEqual([
      { slug: "current-rates-and-allowances", applies_from: "2026-04-06", applies_to: "2027-04-05" },
      { slug: "previous-tax-years", applies_from: null, applies_to: "2026-04-05" }
    ]);

    // GOV.UK updates the page for a new tax year: the old period must not carry over.
    const json = JSON.parse(fixtureBody("income-tax-rates")) as { details: { parts: { body: string }[] } };
    const current = json.details.parts[0];
    if (current === undefined) throw new Error("fixture changed");
    current.body = current.body.replace("6 April 2026 to 5 April 2027", "6 April 2027 to 5 April 2028");
    upstream.set("/income-tax-rates", { status: 200, body: JSON.stringify(json) });
    await runIngestion(dependencies(), entries, options);
    const updated = await database.pool.query<{ applies_from: string | null }>(`
      SELECT s.applies_from FROM document_sections s JOIN document_versions v ON v.id = s.version_id
      WHERE v.status = 'active' AND s.slug = 'current-rates-and-allowances'`);
    expect(updated.rows).toEqual([{ applies_from: null }]);
  });
});

describe("idempotency and change detection", () => {
  it("creates nothing new when the same content is ingested again", async () => {
    await runIngestion(dependencies(), entries, options);
    const before = await tableCounts();
    const second = await runIngestion(dependencies(), entries, options);
    expect(second.status).toBe("success");
    expect(second.items.map(item => item.outcome)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(await tableCounts()).toEqual(before);
    expect(await count(database.pool, "SELECT * FROM ingestion_runs")).toBe(2);
  });

  it("versions changed content, supersedes the old version and keeps it intact", async () => {
    await runIngestion(dependencies(), entries, options);
    const originalVersion = await activeVersionId("/welsh-income-tax");
    const originalText = (await database.pool.query<{ text: string }>("SELECT text FROM document_sections WHERE version_id = $1", [originalVersion])).rows[0]?.text;

    editWelshBody(body => body.replace("You pay Welsh Income Tax rates if you live in Wales.", "You pay Welsh Income Tax rates if your main home is in Wales."));
    const summary = await runIngestion(dependencies(), entries, options);

    expect(summary.items.find(item => item.basePath === "/welsh-income-tax")?.outcome).toBe("new_version");
    expect(summary.items.filter(item => item.outcome === "unchanged")).toHaveLength(2);
    const newVersion = await activeVersionId("/welsh-income-tax");
    expect(newVersion).not.toBe(originalVersion);
    const statuses = (await database.pool.query<{ id: string; status: string }>(
      "SELECT v.id, v.status FROM document_versions v JOIN source_documents d ON d.id = v.document_id WHERE d.base_path = '/welsh-income-tax'")).rows;
    expect(statuses).toHaveLength(2);
    expect(statuses.find(row => row.id === originalVersion)?.status).toBe("superseded");
    // The old version's text is untouched, so earlier citations can still be checked.
    const oldText = (await database.pool.query<{ text: string }>("SELECT text FROM document_sections WHERE version_id = $1", [originalVersion])).rows[0]?.text;
    expect(oldText).toBe(originalText);
    expect((await verifyStore(database.pool)).problems).toEqual([]);
  });

  it("reactivates the earlier version when content reverts, without duplicating it", async () => {
    await runIngestion(dependencies(), entries, options);
    const originalVersion = await activeVersionId("/welsh-income-tax");
    editWelshBody(body => body.replace("Wales", "Cymru"));
    await runIngestion(dependencies(), entries, options);
    upstream.set("/welsh-income-tax", { status: 200, body: fixtureBody("welsh-income-tax") });
    const summary = await runIngestion(dependencies(), entries, options);
    expect(summary.items.find(item => item.basePath === "/welsh-income-tax")?.outcome).toBe("reactivated");
    expect(await activeVersionId("/welsh-income-tax")).toBe(originalVersion);
    expect(await count(database.pool, "SELECT * FROM document_versions")).toBe(4);
  });
});

describe("failures", () => {
  it("records a partial run when one document times out, and keeps that document's content", async () => {
    await runIngestion(dependencies(), entries, options);
    const versionBefore = await activeVersionId("/tax-codes");
    upstream.set("/tax-codes", "timeout");

    const summary = await runIngestion(dependencies(), entries, options);
    expect(summary.status).toBe("partial");
    const failed = summary.items.find(item => item.basePath === "/tax-codes");
    expect(failed).toMatchObject({ outcome: "failed", failureReason: "timeout", attempts: 3 });

    const document = (await database.pool.query<{ lifecycle_status: string; consecutive_check_failures: number; last_failure_reason: string }>(
      "SELECT lifecycle_status, consecutive_check_failures, last_failure_reason FROM source_documents WHERE base_path = '/tax-codes'")).rows[0];
    expect(document).toEqual({ lifecycle_status: "active", consecutive_check_failures: 1, last_failure_reason: "timeout" });
    expect(await activeVersionId("/tax-codes")).toBe(versionBefore);
    const run = (await database.pool.query<{ status: string; failed_count: number }>(
      "SELECT status, failed_count FROM ingestion_runs WHERE id = $1", [summary.runId])).rows[0];
    expect(run).toEqual({ status: "partial", failed_count: 1 });
  });

  it("keeps approved content retrievable through failed checks, and removes it only on withdrawal", async () => {
    const approved = entries.map(entry => ({ ...entry, licence: { ...entry.licence, review: { decision: "approved" as const, reviewedBy: "Test Reviewer", reviewedAt: "2026-10-28T12:00:00Z", notes: null } } }));
    await runIngestion(dependencies(), approved, options);
    const retrievable = () => count(database.pool, "SELECT * FROM retrievable_chunks WHERE canonical_url = 'https://www.gov.uk/welsh-income-tax'");
    const before = await retrievable();
    expect(before).toBeGreaterThan(0);

    upstream.set("/welsh-income-tax", { status: 503, body: "" });
    await runIngestion(dependencies(), approved, options);
    upstream.set("/welsh-income-tax", { status: 200, body: "<html>Service unavailable</html>" });
    await runIngestion(dependencies(), approved, options);
    expect(await retrievable()).toBe(before);

    editWelshBody(body => body);
    const withdrawn = JSON.parse(fixtureBody("welsh-income-tax")) as Record<string, unknown>;
    withdrawn["withdrawn_notice"] = { explanation: "Replaced by new guidance", withdrawn_at: "2026-10-01T00:00:00Z" };
    upstream.set("/welsh-income-tax", { status: 200, body: JSON.stringify(withdrawn) });
    const summary = await runIngestion(dependencies(), approved, options);
    expect(summary.items.find(item => item.basePath === "/welsh-income-tax")?.outcome).toBe("withdrawn");
    expect(await retrievable()).toBe(0);
    // History is kept for audit.
    expect(await count(database.pool, "SELECT * FROM document_versions v JOIN source_documents d ON d.id = v.document_id WHERE d.base_path = '/welsh-income-tax'")).toBe(1);
  });

  it("records redirects and removals as such", async () => {
    await runIngestion(dependencies(), entries, options);
    upstream.set("/tax-codes", { status: 200, body: JSON.stringify({ ...JSON.parse(fixtureBody("redundant-your-rights")), base_path: "/tax-codes" }) });
    upstream.set("/income-tax-rates", { status: 410, body: "" });
    const summary = await runIngestion(dependencies(), entries, options);
    expect(summary.status).toBe("success");
    const lifecycles = (await database.pool.query<{ base_path: string; lifecycle_status: string }>(
      "SELECT base_path, lifecycle_status FROM source_documents ORDER BY base_path")).rows;
    expect(lifecycles).toEqual([
      { base_path: "/income-tax-rates", lifecycle_status: "removed" },
      { base_path: "/tax-codes", lifecycle_status: "redirected" },
      { base_path: "/welsh-income-tax", lifecycle_status: "active" }
    ]);
  });

  it("rolls back a document whose storage fails part-way, leaving the previous version active", async () => {
    await runIngestion(dependencies(), entries, options);
    const versionBefore = await activeVersionId("/welsh-income-tax");
    const before = await tableCounts();

    // A chunker bug producing an impossible chunk: the database rejects it mid-transaction,
    // after the new version and its sections were already inserted.
    const brokenChunker: ChunkFn = text => [{ index: 0, headingPath: [], text, charStart: 5, charEnd: 5 }];
    editWelshBody(body => body.replace("Wales", "Cymru"));
    const summary = await runIngestion(dependencies({ chunk: brokenChunker }), entries, options);

    expect(summary.status).toBe("partial");
    expect(summary.items.find(item => item.basePath === "/welsh-income-tax")).toMatchObject({ outcome: "failed", failureReason: "storage_error" });
    expect(await tableCounts()).toEqual(before);
    expect(await activeVersionId("/welsh-income-tax")).toBe(versionBefore);
    expect((await verifyStore(database.pool)).problems).toEqual([]);
  });

  it("rolls back when application code throws mid-transaction (not just on database errors)", async () => {
    await runIngestion(dependencies(), entries, options);
    const versionBefore = await activeVersionId("/welsh-income-tax");
    const before = await tableCounts();

    // Postgres would roll back an aborted transaction even on COMMIT; a JavaScript exception
    // leaves the transaction healthy, so only our explicit ROLLBACK prevents a half-written version.
    const throwingChunker: ChunkFn = () => { throw new Error("chunker bug"); };
    editWelshBody(body => body.replace("Wales", "Cymru"));
    const summary = await runIngestion(dependencies({ chunk: throwingChunker }), entries, options);

    expect(summary.items.find(item => item.basePath === "/welsh-income-tax")).toMatchObject({ outcome: "failed", failureReason: "storage_error", message: "chunker bug" });
    expect(await tableCounts()).toEqual(before);
    expect(await activeVersionId("/welsh-income-tax")).toBe(versionBefore);
    expect(await count(database.pool, "SELECT * FROM document_versions WHERE status = 'candidate'")).toBe(0);
  });

  it("refuses to start while another run holds the lock", async () => {
    const holder = await database.pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(7120002)");
      await expect(runIngestion(dependencies(), entries, options)).rejects.toThrow(IngestionAlreadyRunningError);
      expect(await count(database.pool, "SELECT * FROM ingestion_runs")).toBe(0);
    } finally {
      await holder.query("SELECT pg_advisory_unlock(7120002)");
      holder.release();
    }
  });
});

describe("verification", () => {
  it("detects stored data that no longer matches its hashes or offsets", async () => {
    await runIngestion(dependencies(), entries, options);
    // Bypass the immutability trigger the way only a database superuser could.
    await database.pool.query("ALTER TABLE document_chunks DISABLE TRIGGER document_chunks_immutable");
    await database.pool.query("UPDATE document_chunks SET content = content || ' (edited)' WHERE chunk_index = 0");
    const problems = (await verifyStore(database.pool)).problems.map(problem => problem.check);
    expect(problems).toContain("chunk_offsets_do_not_match_section_text");
    expect(problems).toContain("chunk_hash_mismatch");
  });
});
