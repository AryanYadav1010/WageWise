-- 0003: embeddings for Milestone 3 retrieval.
-- Vectors live in their own table, keyed by (chunk, model), so a model change adds rows
-- instead of overwriting them, and each model has its own dimension.

-- 1. Remove the unused M1 placeholder (vector(1536) on document_chunks). It was never
--    written to; refuse to continue if it somehow was.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM document_chunks WHERE embedding IS NOT NULL OR embedding_model IS NOT NULL) THEN
    RAISE EXCEPTION 'document_chunks.embedding has data; migrate it before dropping the column';
  END IF;
END $$;
DROP VIEW retrievable_chunks;
DROP INDEX IF EXISTS chunks_embedding_idx;
ALTER TABLE document_chunks DROP COLUMN embedding, DROP COLUMN embedding_model;

-- Chunk immutability no longer needs an exception for embedding columns: all updates are refused.
DROP TRIGGER document_chunks_immutable ON document_chunks;
CREATE TRIGGER document_chunks_immutable BEFORE UPDATE ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION forbid_update();
DROP FUNCTION forbid_chunk_content_update();

-- 2. The retrieval view, now also exposing when each page was last checked.
CREATE VIEW retrievable_chunks AS
SELECT c.id AS chunk_id, c.content, c.heading, c.char_start, c.char_end, c.token_estimate, c.content_sha256,
       c.search_vector,
       s.id AS section_id, s.url AS section_url, s.title AS section_title,
       s.applies_from, s.applies_to, s.applicability_evidence,
       v.id AS version_id, v.content_sha256 AS version_sha256, v.fetched_at, v.source_public_updated_at,
       d.id AS document_id, d.canonical_url, d.title AS document_title, d.nations, d.nations_basis,
       d.topics, d.tax_year, d.attribution_text, d.last_checked_at
FROM document_chunks c
JOIN document_sections s ON s.id = c.section_id
JOIN document_versions v ON v.id = c.version_id AND v.status = 'active'
JOIN source_documents d ON d.id = v.document_id
WHERE d.licence_status = 'approved' AND d.lifecycle_status = 'active';

-- 3. Embedding models and vectors.
CREATE TABLE embedding_models (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 3 AND 200),
  dimensions INTEGER NOT NULL CHECK (dimensions BETWEEN 1 AND 4096),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chunk_embeddings (
  chunk_id UUID NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES embedding_models(id),
  -- The chunk text this vector was computed from; must equal the chunk's own hash.
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- No fixed dimension here: it is checked per model by the trigger below.
  embedding vector NOT NULL,
  -- 'computed' by the model, or 'reused' from an identical text already embedded with this model.
  source TEXT NOT NULL CHECK (source IN ('computed', 'reused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, model_id)
);
CREATE INDEX chunk_embeddings_reuse_idx ON chunk_embeddings (model_id, content_sha256);

-- Defence in depth: the job only selects approved chunks, and the database also refuses
-- a vector for a chunk that is not currently retrievable, of the wrong size, or for other text.
CREATE FUNCTION check_chunk_embedding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_dimensions INTEGER;
  chunk_hash TEXT;
BEGIN
  SELECT dimensions INTO expected_dimensions FROM embedding_models WHERE id = NEW.model_id;
  IF vector_dims(NEW.embedding) <> expected_dimensions THEN
    RAISE EXCEPTION 'embedding has % dimensions; model % requires %', vector_dims(NEW.embedding), NEW.model_id, expected_dimensions;
  END IF;
  SELECT content_sha256 INTO chunk_hash FROM document_chunks WHERE id = NEW.chunk_id;
  IF chunk_hash IS DISTINCT FROM NEW.content_sha256 THEN
    RAISE EXCEPTION 'embedding content hash does not match chunk %', NEW.chunk_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM retrievable_chunks WHERE chunk_id = NEW.chunk_id) THEN
    RAISE EXCEPTION 'chunk % is not retrievable (licence not approved, page not live, or version not active)', NEW.chunk_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chunk_embeddings_check BEFORE INSERT OR UPDATE ON chunk_embeddings
  FOR EACH ROW EXECUTE FUNCTION check_chunk_embedding();

-- 4. Observable, resumable jobs.
CREATE TABLE embedding_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT NOT NULL REFERENCES embedding_models(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  candidates INTEGER NOT NULL DEFAULT 0,
  computed INTEGER NOT NULL DEFAULT 0,
  reused INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT CHECK (length(error_summary) <= 1000)
);
