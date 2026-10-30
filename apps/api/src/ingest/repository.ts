import type { PoolClient } from "../db/pool.ts";
import { sha256, type ParsedDocument, type ParsedSection } from "./govuk.ts";
import type { CorpusEntry, SectionApplicability } from "./corpus.ts";
import type { Chunk } from "./chunker.ts";

// All SQL in the ingestion pipeline lives here, always parameterised.

export type RunItemOutcome = "new_version" | "unchanged" | "reactivated" | "withdrawn" | "redirected" | "removed" | "failed";

export type RunItem = {
  basePath: string;
  outcome: RunItemOutcome;
  failureReason: string | null;
  message: string | null;
  httpStatus: number | null;
  attempts: number;
  versionId: string | null;
  durationMs: number;
};

export type ChunkFn = (sectionText: string, baseHeadingPath: readonly string[]) => Chunk[];

/** Inserts or updates curated metadata only. Operational fields (lifecycle, checks) are untouched. */
export async function upsertCorpusEntry(client: PoolClient, entry: CorpusEntry): Promise<void> {
  const review = entry.licence.review;
  await client.query(
    `INSERT INTO source_documents (
       publisher, base_path, canonical_url, title, topics, nations, nations_basis, nations_evidence,
       applicability_note, licence_id, licence_url, attribution_text, licence_status, licence_reviewed_by, licence_reviewed_at)
     VALUES ('govuk', $1, 'https://www.gov.uk' || $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (base_path) DO UPDATE SET
       topics = EXCLUDED.topics, nations = EXCLUDED.nations, nations_basis = EXCLUDED.nations_basis,
       nations_evidence = EXCLUDED.nations_evidence, applicability_note = EXCLUDED.applicability_note,
       licence_id = EXCLUDED.licence_id, licence_url = EXCLUDED.licence_url, attribution_text = EXCLUDED.attribution_text,
       licence_status = EXCLUDED.licence_status, licence_reviewed_by = EXCLUDED.licence_reviewed_by,
       licence_reviewed_at = EXCLUDED.licence_reviewed_at`,
    [
      entry.basePath, entry.title, [entry.area, ...entry.topics], entry.nations, entry.nationsBasis, entry.nationsEvidence,
      entry.applicabilityNote, entry.licence.id, entry.licence.url, entry.licence.attribution,
      review === null ? "pending_review" : review.decision, review?.reviewedBy ?? null, review?.reviewedAt ?? null
    ]
  );
}

/** Locks the document row so two runs can never interleave writes for the same page. */
export async function lockDocument(client: PoolClient, basePath: string): Promise<string> {
  const result = await client.query<{ id: string }>("SELECT id FROM source_documents WHERE base_path = $1 FOR UPDATE", [basePath]);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Document ${basePath} is not in source_documents`);
  return row.id;
}

export async function markChecked(
  client: PoolClient,
  documentId: string,
  lifecycle: "active" | "withdrawn" | "redirected" | "removed",
  failureReason: string | null
): Promise<void> {
  await client.query(
    `UPDATE source_documents
     SET lifecycle_status = $2, last_checked_at = now(), consecutive_check_failures = 0, last_failure_reason = $3
     WHERE id = $1`,
    [documentId, lifecycle, failureReason]
  );
}

/** A failed check changes nothing about the page: only the failure counter and reason. */
export async function markCheckFailed(client: PoolClient, documentId: string, reason: string): Promise<void> {
  await client.query(
    `UPDATE source_documents
     SET last_checked_at = now(), consecutive_check_failures = consecutive_check_failures + 1, last_failure_reason = $2
     WHERE id = $1`,
    [documentId, reason]
  );
}

function applicabilityFor(section: ParsedSection, rules: readonly SectionApplicability[]): SectionApplicability | null {
  const rule = rules.find(candidate => candidate.slug === section.slug);
  // Only trust the period while the page still says it.
  if (rule === undefined || !section.text.includes(rule.evidence)) return null;
  return rule;
}

async function insertVersion(client: PoolClient, documentId: string, runId: string, document: ParsedDocument, rawSha256: string, parserVersion: string): Promise<string> {
  const contentText = document.sections.map(section => section.text).join("\n\n");
  const result = await client.query<{ id: string }>(
    `INSERT INTO document_versions (
       document_id, ingestion_run_id, content_sha256, source_public_updated_at, source_updated_at,
       content_text, status, parser_version, raw_response_sha256, title)
     VALUES ($1, $2, $3, $4, $5, $6, 'candidate', $7, $8, $9) RETURNING id`,
    [documentId, runId, document.contentSha256, document.sourcePublicUpdatedAt, document.sourceUpdatedAt, contentText,
      parserVersion, rawSha256, document.title]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Version insert returned no id");
  return row.id;
}

type SectionRow = { section: ParsedSection; applicability: SectionApplicability | null };

/** Inserts all of a version's sections in one statement (one round trip). Returns section index → id. */
async function insertSections(client: PoolClient, versionId: string, rows: readonly SectionRow[]): Promise<Map<number, string>> {
  const result = await client.query<{ id: string; section_index: number }>(
    `INSERT INTO document_sections (version_id, section_index, slug, title, url, html_sha256, text, applies_from, applies_to, applicability_evidence)
     SELECT $1, s.section_index, s.slug, s.title, s.url, s.html_sha256, s.text, s.applies_from, s.applies_to, s.applicability_evidence
     FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::date[], $9::date[], $10::text[])
       AS s(section_index, slug, title, url, html_sha256, text, applies_from, applies_to, applicability_evidence)
     RETURNING id, section_index`,
    [versionId, rows.map(row => row.section.index), rows.map(row => row.section.slug), rows.map(row => row.section.title),
      rows.map(row => row.section.url), rows.map(row => row.section.htmlSha256), rows.map(row => row.section.text),
      rows.map(row => row.applicability?.appliesFrom ?? null), rows.map(row => row.applicability?.appliesTo ?? null),
      rows.map(row => row.applicability?.evidence ?? null)]
  );
  if (result.rows.length !== rows.length) throw new Error("Section insert returned the wrong number of ids");
  return new Map(result.rows.map(row => [row.section_index, row.id]));
}

type ChunkRow = { sectionId: string; chunk: Chunk };

/** Inserts all of a version's chunks in one statement; chunk_index is the position in `rows`. */
async function insertChunks(client: PoolClient, versionId: string, rows: readonly ChunkRow[], chunkerVersion: string): Promise<void> {
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO document_chunks (
       version_id, section_id, chunk_index, heading, content, char_start, char_end, token_estimate, chunker_version, content_sha256)
     SELECT $1, c.section_id, c.chunk_index, c.heading, c.content, c.char_start, c.char_end, c.token_estimate, $2, c.content_sha256
     FROM unnest($3::uuid[], $4::int[], $5::text[], $6::text[], $7::int[], $8::int[], $9::int[], $10::text[])
       AS c(section_id, chunk_index, heading, content, char_start, char_end, token_estimate, content_sha256)`,
    [versionId, chunkerVersion, rows.map(row => row.sectionId), rows.map((_, index) => index),
      rows.map(row => row.chunk.headingPath.join(" > ")), rows.map(row => row.chunk.text),
      rows.map(row => row.chunk.charStart), rows.map(row => row.chunk.charEnd),
      rows.map(row => Math.ceil(row.chunk.text.length / 4)), rows.map(row => sha256(row.chunk.text))]
  );
}

/** Makes `versionId` the only active version of the document. Must run inside a transaction. */
async function activateVersion(client: PoolClient, documentId: string, versionId: string): Promise<void> {
  // Supersede first: the partial unique index allows only one active version at a time.
  await client.query(
    "UPDATE document_versions SET status = 'superseded', superseded_at = now() WHERE document_id = $1 AND status = 'active' AND id <> $2",
    [documentId, versionId]
  );
  await client.query("UPDATE document_versions SET status = 'active', activated_at = now() WHERE id = $1", [versionId]);
}

export type StoreResult = { outcome: "new_version" | "unchanged" | "reactivated"; versionId: string; sections: number; chunks: number };

export type StoreOptions = {
  runId: string;
  entry: CorpusEntry;
  document: ParsedDocument;
  rawSha256: string;
  parserVersion: string;
  chunkerVersion: string;
  chunk: ChunkFn;
};

/**
 * Stores fetched content idempotently. The same content hash never creates a second version;
 * content that reverts to an earlier hash reactivates that earlier version.
 */
export async function storeDocumentContent(client: PoolClient, documentId: string, options: StoreOptions): Promise<StoreResult> {
  const { document } = options;
  const existing = await client.query<{ id: string; status: string; sections: string; chunks: string }>(
    `SELECT v.id, v.status,
       (SELECT count(*) FROM document_sections s WHERE s.version_id = v.id) AS sections,
       (SELECT count(*) FROM document_chunks c WHERE c.version_id = v.id) AS chunks
     FROM document_versions v WHERE v.document_id = $1 AND v.content_sha256 = $2`,
    [documentId, document.contentSha256]
  );
  const match = existing.rows[0];
  await client.query("UPDATE source_documents SET title = $2, schema_name = $3 WHERE id = $1", [documentId, document.title, document.schemaName]);

  if (match !== undefined) {
    const counts = { sections: Number(match.sections), chunks: Number(match.chunks) };
    if (match.status === "active") {
      return { outcome: "unchanged", versionId: match.id, ...counts };
    }
    await activateVersion(client, documentId, match.id);
    await client.query("UPDATE source_documents SET last_changed_at = now() WHERE id = $1", [documentId]);
    return { outcome: "reactivated", versionId: match.id, ...counts };
  }

  const versionId = await insertVersion(client, documentId, options.runId, document, options.rawSha256, options.parserVersion);
  // Batched: one round trip for all sections and one for all chunks, not one per row.
  const sectionIds = await insertSections(client, versionId,
    document.sections.map(section => ({ section, applicability: applicabilityFor(section, options.entry.sectionApplicability) })));
  const chunks: ChunkRow[] = [];
  for (const section of document.sections) {
    const sectionId = sectionIds.get(section.index);
    if (sectionId === undefined) throw new Error("Section id missing after insert");
    for (const chunk of options.chunk(section.text, [document.title, section.title])) chunks.push({ sectionId, chunk });
  }
  await insertChunks(client, versionId, chunks, options.chunkerVersion);
  await activateVersion(client, documentId, versionId);
  await client.query("UPDATE source_documents SET last_changed_at = now() WHERE id = $1", [documentId]);
  return { outcome: "new_version", versionId, sections: document.sections.length, chunks: chunks.length };
}

export async function startRun(client: PoolClient, trigger: "manual" | "scheduled", chunkerConfig: object): Promise<string> {
  const result = await client.query<{ id: string }>(
    "INSERT INTO ingestion_runs (trigger, status, chunker_config) VALUES ($1, 'running', $2) RETURNING id",
    [trigger, JSON.stringify(chunkerConfig)]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Run insert returned no id");
  return row.id;
}

export async function insertRunItem(client: PoolClient, runId: string, documentId: string | null, item: RunItem): Promise<void> {
  await client.query(
    `INSERT INTO ingestion_run_items (run_id, document_id, base_path, outcome, failure_reason, message, http_status, attempts, version_id, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [runId, documentId, item.basePath, item.outcome, item.failureReason, item.message?.slice(0, 500) ?? null,
      item.httpStatus, item.attempts, item.versionId, item.durationMs]
  );
}

export async function finishRun(
  client: PoolClient,
  runId: string,
  status: "success" | "partial" | "failed",
  counts: { checked: number; changed: number; failed: number },
  errorSummary: string | null
): Promise<void> {
  await client.query(
    `UPDATE ingestion_runs SET status = $2, completed_at = now(), checked_count = $3, changed_count = $4, failed_count = $5, error_summary = $6
     WHERE id = $1`,
    [runId, status, counts.checked, counts.changed, counts.failed, errorSummary?.slice(0, 1_000) ?? null]
  );
}
