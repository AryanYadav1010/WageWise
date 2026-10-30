import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { count, createMigratedDatabase, type TestDatabase } from "./db-helpers.ts";

// Database-level safety rules. These hold even if application code has a bug.

let database: TestDatabase;
beforeEach(async () => { database = await createMigratedDatabase(); });
afterEach(async () => { await database.drop(); });

const DOCUMENT_ID = "00000000-0000-0000-0000-000000000001";
const VERSION_ID = "00000000-0000-0000-0000-0000000000a1";
const SECTION_ID = "00000000-0000-0000-0000-0000000000b1";
const CHUNK_ID = "00000000-0000-0000-0000-0000000000c1";

async function seedOneChunk(): Promise<void> {
  await database.pool.query(`
    INSERT INTO source_documents (id, publisher, base_path, canonical_url, title, topics, nations)
    VALUES ($1, 'govuk', '/income-tax-rates', 'https://www.gov.uk/income-tax-rates', 'Income Tax rates', '{tax}', '{england,wales}')`, [DOCUMENT_ID]);
  await database.pool.query(`
    INSERT INTO document_versions (id, document_id, content_sha256, content_text, status, parser_version, title)
    VALUES ($1, $2, repeat('a', 64), 'Synthetic test text about tax bands.', 'active', 'test', 'Income Tax rates')`, [VERSION_ID, DOCUMENT_ID]);
  await database.pool.query(`
    INSERT INTO document_sections (id, version_id, section_index, title, url, html_sha256, text)
    VALUES ($1, $2, 0, 'Rates', 'https://www.gov.uk/income-tax-rates', repeat('b', 64), 'Synthetic test text about tax bands.')`, [SECTION_ID, VERSION_ID]);
  await database.pool.query(`
    INSERT INTO document_chunks (id, version_id, section_id, chunk_index, heading, content, char_start, char_end, token_estimate,
                                 chunker_version, content_sha256)
    VALUES ($1, $2, $3, 0, 'Income Tax rates > Rates', 'Synthetic test text about tax bands.', 0, 36, 9, 'test', repeat('c', 64))`,
    [CHUNK_ID, VERSION_ID, SECTION_ID]);
}

async function addEmbedding(dimensions = 3, values = "0.6,0.8,0"): Promise<void> {
  await database.pool.query("INSERT INTO embedding_models (id, dimensions) VALUES ('test-model', $1) ON CONFLICT DO NOTHING", [dimensions]);
  await database.pool.query(
    "INSERT INTO chunk_embeddings (chunk_id, model_id, content_sha256, embedding, source) VALUES ($1, 'test-model', repeat('c', 64), $2::vector, 'computed')",
    [CHUNK_ID, `[${values}]`]);
}

async function approve(): Promise<void> {
  await database.pool.query(`
    UPDATE source_documents SET licence_status = 'approved', licence_id = 'OGL-UK-3.0', licence_reviewed_by = 'test reviewer',
      licence_reviewed_at = now(), attribution_text = 'Contains public sector information licensed under the Open Government Licence v3.0'`);
}

describe("retrievability", () => {
  it("hides content until a named reviewer approves the licence", async () => {
    await seedOneChunk();
    expect(await count(database.pool, "SELECT * FROM retrievable_chunks")).toBe(0);
    await expect(database.pool.query("UPDATE source_documents SET licence_status = 'approved', licence_id = 'OGL-UK-3.0'"))
      .rejects.toThrow(/check constraint/);
    await approve();
    const rows = (await database.pool.query("SELECT section_url, nations, version_sha256 FROM retrievable_chunks")).rows;
    expect(rows).toEqual([{ section_url: "https://www.gov.uk/income-tax-rates", nations: ["england", "wales"], version_sha256: "a".repeat(64) }]);
  });

  it("hides withdrawn, redirected and removed pages", async () => {
    await seedOneChunk();
    await approve();
    for (const lifecycle of ["withdrawn", "redirected", "removed"]) {
      await database.pool.query("UPDATE source_documents SET lifecycle_status = $1", [lifecycle]);
      expect(await count(database.pool, "SELECT * FROM retrievable_chunks")).toBe(0);
    }
  });

  it("supports both halves of hybrid search", async () => {
    await seedOneChunk();
    await approve();
    await addEmbedding();
    expect(await count(database.pool, "SELECT * FROM document_chunks WHERE search_vector @@ plainto_tsquery('english', 'tax bands')")).toBe(1);
    const distance = await database.pool.query<{ d: number }>("SELECT embedding <=> '[0.6,0.8,0]'::vector AS d FROM chunk_embeddings");
    expect(distance.rows[0]?.d).toBeLessThan(0.0001);
  });
});

describe("integrity constraints", () => {
  it("allows only one active version per document", async () => {
    await seedOneChunk();
    await expect(database.pool.query(`
      INSERT INTO document_versions (document_id, content_sha256, content_text, status, parser_version)
      VALUES ($1, repeat('d', 64), 'Newer', 'active', 'test')`, [DOCUMENT_ID])).rejects.toThrow(/one_active_version_per_document/);
  });

  it("rejects a chunk whose section belongs to another version", async () => {
    await seedOneChunk();
    const other = await database.pool.query<{ id: string }>(`
      INSERT INTO document_versions (document_id, content_sha256, content_text, status, parser_version)
      VALUES ($1, repeat('e', 64), 'Other', 'candidate', 'test') RETURNING id`, [DOCUMENT_ID]);
    await expect(database.pool.query(`
      INSERT INTO document_chunks (version_id, section_id, chunk_index, content, char_start, char_end, token_estimate, chunker_version, content_sha256)
      VALUES ($1, $2, 0, 'x', 0, 1, 1, 'test', repeat('f', 64))`, [other.rows[0]?.id, SECTION_ID])).rejects.toThrow(/document_chunks_section_fk/);
  });

  it("rejects an applicability period without quoted evidence", async () => {
    await seedOneChunk();
    await expect(database.pool.query(`
      INSERT INTO document_sections (version_id, section_index, title, url, html_sha256, text, applies_from)
      VALUES ($1, 1, 'Next', 'https://www.gov.uk/income-tax-rates/next', repeat('b', 64), 'x', '2026-04-06')`, [VERSION_ID]))
      .rejects.toThrow(/check constraint/);
  });
});

describe("immutability", () => {
  it("forbids changing a version's content but allows lifecycle changes", async () => {
    await seedOneChunk();
    await expect(database.pool.query("UPDATE document_versions SET content_text = 'tampered'")).rejects.toThrow(/immutable/);
    await expect(database.pool.query("UPDATE document_versions SET content_sha256 = repeat('9', 64)")).rejects.toThrow(/immutable/);
    await database.pool.query("UPDATE document_versions SET status = 'superseded', superseded_at = now()");
  });

  it("forbids any change to a section", async () => {
    await seedOneChunk();
    await expect(database.pool.query("UPDATE document_sections SET text = 'tampered'")).rejects.toThrow(/immutable/);
  });

  it("forbids any change to a chunk (embeddings now live in chunk_embeddings)", async () => {
    await seedOneChunk();
    await expect(database.pool.query("UPDATE document_chunks SET content = 'tampered'")).rejects.toThrow(/immutable/);
    await expect(database.pool.query("UPDATE document_chunks SET char_end = 10")).rejects.toThrow(/immutable/);
  });
});

describe("embedding rules (migration 0003)", () => {
  it("refuses a vector for a chunk whose licence is not approved", async () => {
    await seedOneChunk();
    await expect(addEmbedding()).rejects.toThrow(/not retrievable/);
  });

  it("refuses a vector of the wrong dimension for its model", async () => {
    await seedOneChunk();
    await approve();
    await expect(addEmbedding(4, "1,0,0")).rejects.toThrow(/3 dimensions; model test-model requires 4/);
  });

  it("refuses a vector recorded for different text than the chunk", async () => {
    await seedOneChunk();
    await approve();
    await database.pool.query("INSERT INTO embedding_models (id, dimensions) VALUES ('test-model', 3)");
    await expect(database.pool.query(
      "INSERT INTO chunk_embeddings (chunk_id, model_id, content_sha256, embedding, source) VALUES ($1, 'test-model', repeat('d', 64), '[1,0,0]', 'computed')",
      [CHUNK_ID])).rejects.toThrow(/content hash does not match/);
  });
});
