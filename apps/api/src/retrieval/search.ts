import type { Pool } from "../db/pool.ts";
import { embedWithRetry, toVectorLiteral, type EmbeddingProvider, type RetryOptions } from "../embeddings/provider.ts";
import type { NATIONS } from "../ingest/corpus.ts";

// Hybrid retrieval over the `retrievable_chunks` view only: approved licence, live page,
// active version. Nothing else in the database is reachable from here.

export type Nation = (typeof NATIONS)[number];
export type RetrievalMode = "lexical" | "vector" | "hybrid";

export type SearchRequest = {
  query: string;
  /** null means "not specified": no nation filter, and results show which nations they cover. */
  nation: Nation | null;
  /** Sections whose stated period excludes this date are removed. */
  asOfDate: string;
  limit: number;
};

export type SearchResult = {
  rank: number;
  sectionUrl: string;
  sectionTitle: string;
  documentTitle: string;
  canonicalUrl: string;
  heading: string;
  excerpt: string;
  /**
   * Text of this section's retrieved chunks (best first within a budget, then in page order), for
   * answer generation and citation checks. Not returned by the search API.
   */
  passage: string;
  nations: string[];
  nationsBasis: string;
  applicability: { status: "stated"; appliesFrom: string | null; appliesTo: string | null } | { status: "not_stated" };
  sourceFetchedAt: string;
  sourceCheckedAt: string | null;
  attribution: string;
  /** vectorSimilarity is cosine similarity to the query (null if not among the vector candidates). */
  match: { lexicalRank: number | null; vectorRank: number | null; vectorSimilarity: number | null; fusedScore: number };
};

export type SearchOutcome = {
  results: SearchResult[];
  /** Cosine similarity of the closest passage, or null when semantic search did not run. */
  bestSimilarity: number | null;
  /**
   * "below_threshold": the closest passage was less similar than the configured minimum, so
   * results were withheld. "not_assessed": no threshold set, or semantic search unavailable.
   */
  relevance: "ok" | "below_threshold" | "not_assessed";
  /** Meaningful words in the query, after Postgres removes stop words. */
  termCount: number;
  /** One approved passage contains every meaningful word: a strong sign the corpus covers the question. */
  allTermsMatch: boolean;
  lexical: "ok" | "failed" | "skipped";
  vector: "ok" | "failed" | "skipped" | "not_configured";
};

/** Satisfied by both pino and Fastify loggers. */
export type WarnLogger = { warn: (details: object, message: string) => void };

export type SearchDependencies = {
  pool: Pool;
  provider: EmbeddingProvider | null;
  logger: WarnLogger;
  retry: RetryOptions;
  /** Evidence gate: withhold all results if the closest passage is below this similarity. */
  minSimilarity?: number | null;
};

/** Candidates taken from each list before fusion. */
export const CANDIDATES_PER_LIST = 30;
/** Reciprocal Rank Fusion constant from Cormack, Clarke & Büttcher (2009). */
export const RRF_K = 60;
/** Vector ranks count 3× keyword ranks: chosen on the frozen benchmark, where 3 and 5 score the same. */
export const VECTOR_WEIGHT = 3;
const MAX_QUERY_TERMS = 32;
const EXCERPT_CHARS = 320;
// Per-section text given to the answer model: enough for a whole typical section, so a table isn't cut.
const PASSAGE_CHARS = 6_000;

/**
 * Lexical terms: lowercase letters and digits only, so user input can never inject tsquery
 * syntax (& | ! : etc.). Terms are ORed: natural questions rarely contain every word of a passage.
 */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words.filter(word => word.length <= 40))].slice(0, MAX_QUERY_TERMS);
}

// Shared filter: $2 nation (or null), $3 as-of date. Unknown applicability is kept but
// labelled "not stated" in results; it is never presented as current.
const FILTERS = `
  ($2::text IS NULL OR $2 = ANY(rc.nations))
  AND (rc.applies_from IS NULL OR rc.applies_from <= $3::date)
  AND (rc.applies_to IS NULL OR rc.applies_to >= $3::date)`;

type RankedChunk = { chunkId: string; rank: number; similarity?: number };

export async function lexicalSearch(pool: Pool, request: SearchRequest, limit = CANDIDATES_PER_LIST): Promise<RankedChunk[]> {
  const terms = queryTerms(request.query);
  if (terms.length === 0) return [];
  const result = await pool.query<{ chunk_id: string }>(`
    SELECT rc.chunk_id
    FROM retrievable_chunks rc, to_tsquery('english', $1) AS q
    WHERE rc.search_vector @@ q AND ${FILTERS}
    ORDER BY ts_rank_cd(rc.search_vector, q) DESC, rc.chunk_id
    LIMIT $4`, [terms.join(" | "), request.nation, request.asOfDate, limit]);
  return result.rows.map((row, index) => ({ chunkId: row.chunk_id, rank: index + 1 }));
}

// Exact (sequential) cosine search. With hundreds of chunks this is a few milliseconds and has
// perfect recall; an approximate HNSW index is only worth adding when a benchmark shows a need.
export async function vectorSearch(pool: Pool, queryVector: readonly number[], modelId: string, request: SearchRequest, limit = CANDIDATES_PER_LIST): Promise<RankedChunk[]> {
  const result = await pool.query<{ chunk_id: string; similarity: number }>(`
    SELECT rc.chunk_id, 1 - (e.embedding <=> $1::vector) AS similarity
    FROM retrievable_chunks rc
    JOIN chunk_embeddings e ON e.chunk_id = rc.chunk_id AND e.model_id = $5
    WHERE ${FILTERS}
    ORDER BY e.embedding <=> $1::vector, rc.chunk_id
    LIMIT $4`, [toVectorLiteral(queryVector), request.nation, request.asOfDate, limit, modelId]);
  return result.rows.map((row, index) => ({ chunkId: row.chunk_id, rank: index + 1, similarity: Number(row.similarity) }));
}

/** How well the corpus covers the query's words. Uses queryTerms because Postgres rejects raw text with NUL bytes. */
async function termEvidence(pool: Pool, request: SearchRequest): Promise<{ termCount: number; allTermsMatch: boolean }> {
  const terms = queryTerms(request.query);
  if (terms.length === 0) return { termCount: 0, allTermsMatch: false };
  const result = await pool.query<{ nodes: number; covered: boolean }>(`
    SELECT numnode(q) AS nodes,
      numnode(q) > 0 AND EXISTS (SELECT 1 FROM retrievable_chunks rc WHERE rc.search_vector @@ q AND ${FILTERS}) AS covered
    FROM plainto_tsquery('english', $1) AS q`, [terms.join(" "), request.nation, request.asOfDate]);
  const row = result.rows[0];
  return { termCount: Math.ceil((row?.nodes ?? 0) / 2), allTermsMatch: row?.covered ?? false };
}

export type FusedChunk = { chunkId: string; fusedScore: number; lexicalRank: number | null; vectorRank: number | null; vectorSimilarity: number | null };

/** Weighted Reciprocal Rank Fusion: score = Σ weight / (k + rank). Uses ranks only, so the lists' raw scores need no normalising. */
export function reciprocalRankFusion(lexical: readonly RankedChunk[], vector: readonly RankedChunk[], k = RRF_K, vectorWeight = VECTOR_WEIGHT): FusedChunk[] {
  const fused = new Map<string, FusedChunk>();
  const entry = (chunkId: string) => fused.get(chunkId) ?? { chunkId, fusedScore: 0, lexicalRank: null, vectorRank: null, vectorSimilarity: null };
  for (const item of lexical) {
    const current = entry(item.chunkId);
    fused.set(item.chunkId, { ...current, fusedScore: current.fusedScore + 1 / (k + item.rank), lexicalRank: item.rank });
  }
  for (const item of vector) {
    const current = entry(item.chunkId);
    fused.set(item.chunkId, { ...current, fusedScore: current.fusedScore + vectorWeight / (k + item.rank), vectorRank: item.rank, vectorSimilarity: item.similarity ?? null });
  }
  return [...fused.values()].sort((a, b) => b.fusedScore - a.fusedScore || a.chunkId.localeCompare(b.chunkId));
}

/**
 * Plain-text excerpt of a chunk. A chunk that starts part-way through its section (because of
 * overlap) and mid-sentence gets a leading ellipsis, so it is not read as a complete statement.
 */
export function makeExcerpt(content: string, startsInsideSection = false): string {
  const plain = content.replace(/^#{2,4} (.+)$/gm, "$1:").replace(/\s+/g, " ").trim();
  const lead = startsInsideSection && /^[a-z]/.test(plain) ? "…" : "";
  if (plain.length <= EXCERPT_CHARS) return `${lead}${plain}`;
  const cut = plain.slice(0, EXCERPT_CHARS);
  return `${lead}${cut.slice(0, Math.max(cut.lastIndexOf(" "), EXCERPT_CHARS - 40))}…`;
}

type DetailRow = {
  chunk_id: string; content: string; char_start: number; heading: string; section_url: string; section_title: string; document_title: string;
  canonical_url: string; nations: string[]; nations_basis: string; applies_from: string | null; applies_to: string | null;
  fetched_at: Date; last_checked_at: Date | null; attribution_text: string | null;
};

/**
 * The model sees every candidate chunk of a section, not only the best one: the sentence that
 * answers a question is often in a neighbouring chunk (e.g. "1257L is the tax code currently used…").
 * Best-ranked chunks are kept first until the budget is used, then put back in page order.
 */
function sectionPassage(rows: readonly DetailRow[]): string {
  const chosen: DetailRow[] = [];
  let used = 0;
  for (const row of rows) {
    if (chosen.length > 0 && used + row.content.length > PASSAGE_CHARS) continue;
    chosen.push(row);
    used += row.content.length;
  }
  return chosen.sort((a, b) => a.char_start - b.char_start).map(row => row.content).join("\n…\n");
}

/** One result per section (ranked by its best-scoring chunk), so five results mean five different sources. */
async function buildResults(pool: Pool, fused: readonly FusedChunk[], limit: number): Promise<SearchResult[]> {
  if (fused.length === 0) return [];
  const details = await pool.query<DetailRow>(`
    SELECT chunk_id, content, char_start, heading, section_url, section_title, document_title, canonical_url, nations, nations_basis,
           applies_from, applies_to, fetched_at, last_checked_at, attribution_text
    FROM retrievable_chunks WHERE chunk_id = ANY($1::uuid[])`, [fused.map(item => item.chunkId)]);
  const byId = new Map(details.rows.map(row => [row.chunk_id, row]));
  // Candidate chunks per section, in fused (best-first) order.
  const bySection = new Map<string, DetailRow[]>();
  for (const item of fused) {
    const row = byId.get(item.chunkId);
    if (row === undefined) continue;
    bySection.set(row.section_url, [...(bySection.get(row.section_url) ?? []), row]);
  }

  const results: SearchResult[] = [];
  const seenSections = new Set<string>();
  for (const item of fused) {
    const row = byId.get(item.chunkId);
    if (row === undefined || seenSections.has(row.section_url)) continue;
    seenSections.add(row.section_url);
    const stated = row.applies_from !== null || row.applies_to !== null;
    results.push({
      rank: results.length + 1,
      sectionUrl: row.section_url,
      sectionTitle: row.section_title,
      documentTitle: row.document_title,
      canonicalUrl: row.canonical_url,
      heading: row.heading,
      excerpt: makeExcerpt(row.content, row.char_start > 0),
      passage: sectionPassage(bySection.get(row.section_url) ?? [row]),
      nations: row.nations,
      nationsBasis: row.nations_basis,
      applicability: stated ? { status: "stated", appliesFrom: row.applies_from, appliesTo: row.applies_to } : { status: "not_stated" },
      sourceFetchedAt: row.fetched_at.toISOString(),
      sourceCheckedAt: row.last_checked_at?.toISOString() ?? null,
      attribution: row.attribution_text ?? "Contains public sector information licensed under the Open Government Licence v3.0",
      match: { lexicalRank: item.lexicalRank, vectorRank: item.vectorRank, vectorSimilarity: item.vectorSimilarity, fusedScore: item.fusedScore }
    });
    if (results.length === limit) break;
  }
  return results;
}

/**
 * Runs the requested retrieval mode. In hybrid mode a failure of the semantic side (model
 * unavailable, timeout) degrades to keyword results and says so; it does not fail the search.
 */
type Side<Status> = { chunks: RankedChunk[]; status: Status };

async function lexicalSide(pool: SearchDependencies["pool"], request: SearchRequest, mode: RetrievalMode): Promise<Side<SearchOutcome["lexical"]>> {
  if (mode === "vector") return { chunks: [], status: "skipped" };
  return { chunks: await lexicalSearch(pool, request), status: "ok" };
}

async function semanticSide(dependencies: SearchDependencies, request: SearchRequest, mode: RetrievalMode): Promise<Side<SearchOutcome["vector"]>> {
  const { pool, provider, logger } = dependencies;
  if (mode === "lexical") return { chunks: [], status: "skipped" };
  if (provider === null) return { chunks: [], status: "not_configured" };
  try {
    const { vectors } = await embedWithRetry(provider, [request.query], "query", dependencies.retry);
    const queryVector = vectors[0];
    if (queryVector === undefined) throw new Error("No query vector");
    return { chunks: await vectorSearch(pool, queryVector, provider.modelId, request), status: "ok" };
  } catch (error) {
    if (mode === "vector") throw error;
    // Never log the query itself; the error message comes from our own code or the provider.
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "semantic search failed; using keyword results only");
    return { chunks: [], status: "failed" };
  }
}

/**
 * Runs the requested retrieval mode. In hybrid mode a failure of the semantic side (model
 * unavailable, timeout) degrades to keyword results and says so; it does not fail the search.
 */
export async function searchGuidance(dependencies: SearchDependencies, request: SearchRequest, mode: RetrievalMode = "hybrid"): Promise<SearchOutcome> {
  const { pool } = dependencies;
  // Both sides run concurrently: against a remote database every sequential round trip adds latency.
  const [lexicalResult, vectorResult, evidence] = await Promise.all([lexicalSide(pool, request, mode), semanticSide(dependencies, request, mode), termEvidence(pool, request)]);
  const { chunks: lexical, status: lexicalStatus } = lexicalResult;
  const { chunks: vector, status: vectorStatus } = vectorResult;

  const bestSimilarity = vectorStatus === "ok" ? (vector[0]?.similarity ?? null) : null;
  const minSimilarity = dependencies.minSimilarity ?? null;
  const base = { lexical: lexicalStatus, vector: vectorStatus, bestSimilarity, ...evidence };
  if (minSimilarity !== null && bestSimilarity !== null && bestSimilarity < minSimilarity) {
    // Nothing in the approved corpus is close enough: say so rather than show weak matches.
    return { ...base, results: [], relevance: "below_threshold" };
  }
  const relevance = minSimilarity !== null && bestSimilarity !== null ? "ok" : "not_assessed";
  const fused = reciprocalRankFusion(lexical, vector);
  return { ...base, results: await buildResults(pool, fused, request.limit), relevance };
}
