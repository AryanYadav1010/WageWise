import type { Pool } from "../db/pool.ts";
import { hashSections, sha256, type ParsedSection } from "./govuk.ts";

export type DocumentReport = {
  basePath: string;
  lifecycle: string;
  licenceStatus: string;
  consecutiveFailures: number;
  versions: number;
  activeVersionSha256: string | null;
  sections: number;
  chunks: number;
};

export type Problem = { check: string; detail: string };
export type VerificationReport = { documents: DocumentReport[]; problems: Problem[] };

type SectionRow = { version_id: string; title: string | null; content_sha256: string; section_id: string; section_index: number; section_title: string; url: string; slug: string | null; html_sha256: string; text: string };
type ChunkRow = { section_id: string; content: string; char_start: number; char_end: number; content_sha256: string; chunk_index: number };

async function documentReports(pool: Pool): Promise<DocumentReport[]> {
  const result = await pool.query<{
    base_path: string; lifecycle_status: string; licence_status: string; consecutive_check_failures: number;
    versions: string; active_sha: string | null; sections: string; chunks: string;
  }>(`
    SELECT d.base_path, d.lifecycle_status, d.licence_status, d.consecutive_check_failures,
      (SELECT count(*) FROM document_versions v WHERE v.document_id = d.id) AS versions,
      av.content_sha256 AS active_sha,
      (SELECT count(*) FROM document_sections s WHERE s.version_id = av.id) AS sections,
      (SELECT count(*) FROM document_chunks c WHERE c.version_id = av.id) AS chunks
    FROM source_documents d
    LEFT JOIN document_versions av ON av.document_id = d.id AND av.status = 'active'
    ORDER BY d.base_path`);
  return result.rows.map(row => ({
    basePath: row.base_path,
    lifecycle: row.lifecycle_status,
    licenceStatus: row.licence_status,
    consecutiveFailures: row.consecutive_check_failures,
    versions: Number(row.versions),
    activeVersionSha256: row.active_sha,
    sections: Number(row.sections),
    chunks: Number(row.chunks)
  }));
}

/** Checks done in SQL: structural invariants the schema cannot express on its own. */
async function sqlProblems(pool: Pool): Promise<Problem[]> {
  const checks: { check: string; sql: string }[] = [
    { check: "document_without_active_version", sql: `
      SELECT d.base_path AS detail FROM source_documents d
      WHERE EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id = d.id AND v.status = 'active')` },
    { check: "version_without_sections", sql: `
      SELECT v.id::text AS detail FROM document_versions v
      WHERE NOT EXISTS (SELECT 1 FROM document_sections s WHERE s.version_id = v.id)` },
    { check: "section_without_chunks", sql: `
      SELECT s.url || ' (version ' || s.version_id || ')' AS detail FROM document_sections s
      WHERE NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.section_id = s.id)` },
    { check: "chunk_hash_mismatch", sql: `
      SELECT c.id::text AS detail FROM document_chunks c
      WHERE c.content_sha256 <> encode(sha256(convert_to(c.content, 'UTF8')), 'hex')` },
    { check: "candidate_version_left_behind", sql: `
      SELECT v.id::text AS detail FROM document_versions v WHERE v.status = 'candidate'` }
  ];
  const problems: Problem[] = [];
  for (const { check, sql } of checks) {
    const result = await pool.query<{ detail: string }>(sql);
    problems.push(...result.rows.map(row => ({ check, detail: row.detail })));
  }
  return problems;
}

/**
 * Checks done in TypeScript, because they must use the same rules as the code that wrote
 * the data: chunk offsets are JavaScript string offsets, and the version hash is computed
 * by hashSections().
 */
async function provenanceProblems(pool: Pool): Promise<Problem[]> {
  const sections = (await pool.query<SectionRow>(`
    SELECT v.id AS version_id, v.title, v.content_sha256, s.id AS section_id, s.section_index, s.title AS section_title,
           s.url, s.slug, s.html_sha256, s.text
    FROM document_versions v JOIN document_sections s ON s.version_id = v.id
    ORDER BY v.id, s.section_index`)).rows;
  const chunks = (await pool.query<ChunkRow>(
    "SELECT section_id, content, char_start, char_end, content_sha256, chunk_index FROM document_chunks ORDER BY chunk_index")).rows;

  const problems: Problem[] = [];
  const textBySection = new Map(sections.map(section => [section.section_id, section.text]));
  for (const chunk of chunks) {
    const sectionText = textBySection.get(chunk.section_id);
    if (sectionText === undefined || sectionText.slice(chunk.char_start, chunk.char_end) !== chunk.content) {
      problems.push({ check: "chunk_offsets_do_not_match_section_text", detail: `section ${chunk.section_id}, chunk ${chunk.chunk_index}` });
    }
    if (sha256(chunk.content) !== chunk.content_sha256) {
      problems.push({ check: "chunk_sha256_mismatch", detail: `section ${chunk.section_id}, chunk ${chunk.chunk_index}` });
    }
  }

  const sectionsByVersion = new Map<string, SectionRow[]>();
  for (const section of sections) {
    sectionsByVersion.set(section.version_id, [...(sectionsByVersion.get(section.version_id) ?? []), section]);
  }
  for (const [versionId, versionSections] of sectionsByVersion) {
    const first = versionSections[0];
    if (first === undefined || first.title === null) continue; // legacy rows without a stored title
    const parsed: ParsedSection[] = versionSections.map(section => ({
      index: section.section_index, slug: section.slug, title: section.section_title, url: section.url,
      htmlSha256: section.html_sha256, text: section.text
    }));
    if (hashSections(first.title, parsed) !== first.content_sha256) {
      problems.push({ check: "version_hash_does_not_match_stored_sections", detail: versionId });
    }
  }
  return problems;
}

export async function verifyStore(pool: Pool): Promise<VerificationReport> {
  return {
    documents: await documentReports(pool),
    problems: [...await sqlProblems(pool), ...await provenanceProblems(pool)]
  };
}
