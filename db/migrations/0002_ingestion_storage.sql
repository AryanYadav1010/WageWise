-- 0002: storage for Milestone 2 ingestion.
-- Safe on an M1 database: existing rows are backfilled, and the new NOT NULL chunk columns
-- have no default, so this migration fails (and rolls back) rather than inventing values
-- if document_chunks already holds rows.

-- 1. Nations as a list, so retrieval can filter with `user_nation = ANY(nations)`.
--    A single jurisdiction value could not express "England, Wales and Northern Ireland".
DROP VIEW IF EXISTS retrievable_chunks;

ALTER TABLE source_documents ADD COLUMN nations TEXT[];
UPDATE source_documents SET nations = CASE jurisdiction
  WHEN 'uk' THEN ARRAY['england', 'wales', 'scotland', 'northern-ireland']
  WHEN 'great-britain' THEN ARRAY['england', 'wales', 'scotland']
  WHEN 'england-and-wales' THEN ARRAY['england', 'wales']
  ELSE ARRAY[jurisdiction]
END;
ALTER TABLE source_documents
  ALTER COLUMN nations SET NOT NULL,
  ADD CONSTRAINT source_documents_nations_check
    CHECK (cardinality(nations) > 0 AND nations <@ ARRAY['england', 'wales', 'scotland', 'northern-ireland']),
  -- 'stated' means the page itself says where it applies; 'inferred' is our judgement.
  ADD COLUMN nations_basis TEXT NOT NULL DEFAULT 'inferred' CHECK (nations_basis IN ('stated', 'inferred')),
  ADD COLUMN nations_evidence TEXT,
  ADD COLUMN applicability_note TEXT,
  ADD COLUMN schema_name TEXT,
  ADD COLUMN last_failure_reason TEXT;
ALTER TABLE source_documents DROP COLUMN jurisdiction;

-- 2. Lifecycle: a failed fetch is not evidence of anything, so 'fetch_failing' is removed.
--    Failures are counted in consecutive_check_failures; the page stays retrievable.
--    'removed' records an explicit 404/410 from GOV.UK.
UPDATE source_documents SET lifecycle_status = 'active' WHERE lifecycle_status = 'fetch_failing';
ALTER TABLE source_documents DROP CONSTRAINT source_documents_lifecycle_status_check;
ALTER TABLE source_documents ADD CONSTRAINT source_documents_lifecycle_status_check
  CHECK (lifecycle_status IN ('active', 'withdrawn', 'redirected', 'removed'));

-- 3. Version provenance.
ALTER TABLE document_versions
  -- The title as fetched, so content_sha256 can be recomputed from stored rows alone.
  ADD COLUMN title TEXT,
  ADD COLUMN parser_version TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN raw_response_sha256 TEXT CHECK (raw_response_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN source_updated_at TIMESTAMPTZ,
  ADD COLUMN activated_at TIMESTAMPTZ,
  ADD COLUMN superseded_at TIMESTAMPTZ;
ALTER TABLE document_versions ALTER COLUMN parser_version DROP DEFAULT;

-- 4. Sections: one row per guide part (or one for single-body pages), immutable.
CREATE TABLE document_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  section_index INTEGER NOT NULL CHECK (section_index >= 0),
  slug TEXT,
  title TEXT NOT NULL CHECK (length(title) > 0),
  -- Deep link used in citations, e.g. https://www.gov.uk/tax-codes/emergency-tax-codes
  url TEXT NOT NULL CHECK (url LIKE 'https://www.gov.uk/%'),
  html_sha256 TEXT NOT NULL CHECK (html_sha256 ~ '^[0-9a-f]{64}$'),
  text TEXT NOT NULL CHECK (length(text) > 0),
  -- Only set when the page states the period, e.g. "The current tax year is from 6 April 2026 to 5 April 2027".
  applies_from DATE,
  applies_to DATE,
  applicability_evidence TEXT,
  CHECK (applies_to IS NULL OR applies_from IS NULL OR applies_to >= applies_from),
  CHECK ((applies_from IS NULL AND applies_to IS NULL) OR applicability_evidence IS NOT NULL),
  UNIQUE (version_id, section_index),
  UNIQUE (version_id, url),
  UNIQUE (id, version_id)
);

-- 5. Chunks belong to a section of the same version; offsets are into document_sections.text.
ALTER TABLE document_chunks
  ADD COLUMN section_id UUID NOT NULL,
  ADD COLUMN chunker_version TEXT NOT NULL,
  ADD COLUMN content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT document_chunks_section_fk
    FOREIGN KEY (section_id, version_id) REFERENCES document_sections (id, version_id) ON DELETE CASCADE;
CREATE INDEX document_chunks_section_idx ON document_chunks (section_id);

-- 6. Per-document results of each run, so partial failures are visible and auditable.
ALTER TABLE ingestion_runs ADD COLUMN chunker_config JSONB;
CREATE TABLE ingestion_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  document_id UUID REFERENCES source_documents(id) ON DELETE SET NULL,
  base_path TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('new_version', 'unchanged', 'reactivated', 'withdrawn', 'redirected', 'removed', 'failed')),
  failure_reason TEXT,
  -- Our own short message, never an upstream response body.
  message TEXT CHECK (length(message) <= 500),
  http_status INTEGER,
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  version_id UUID REFERENCES document_versions(id) ON DELETE SET NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((outcome = 'failed') = (failure_reason IS NOT NULL)),
  UNIQUE (run_id, base_path)
);

-- 7. Immutability, enforced by the database. Only lifecycle fields of a version may change,
--    and only embeddings (added in M3) may be set on a chunk.
CREATE FUNCTION forbid_version_content_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.content_text IS DISTINCT FROM OLD.content_text
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.parser_version IS DISTINCT FROM OLD.parser_version
     OR NEW.raw_response_sha256 IS DISTINCT FROM OLD.raw_response_sha256
     OR NEW.fetched_at IS DISTINCT FROM OLD.fetched_at THEN
    RAISE EXCEPTION 'document_versions content is immutable (version %)', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_versions_immutable BEFORE UPDATE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_version_content_update();

CREATE FUNCTION forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END $$;
CREATE TRIGGER document_sections_immutable BEFORE UPDATE ON document_sections
  FOR EACH ROW EXECUTE FUNCTION forbid_update();

CREATE FUNCTION forbid_chunk_content_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content
     OR NEW.section_id IS DISTINCT FROM OLD.section_id
     OR NEW.version_id IS DISTINCT FROM OLD.version_id
     OR NEW.char_start IS DISTINCT FROM OLD.char_start
     OR NEW.char_end IS DISTINCT FROM OLD.char_end
     OR NEW.heading IS DISTINCT FROM OLD.heading THEN
    RAISE EXCEPTION 'document_chunks content is immutable (chunk %)', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_chunks_immutable BEFORE UPDATE ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION forbid_chunk_content_update();

-- 8. Retrieval may only read approved, live, active content, now with full provenance.
CREATE VIEW retrievable_chunks AS
SELECT c.id AS chunk_id, c.content, c.heading, c.char_start, c.char_end, c.token_estimate,
       c.embedding, c.embedding_model, c.search_vector,
       s.id AS section_id, s.url AS section_url, s.title AS section_title, s.applies_from, s.applies_to,
       v.id AS version_id, v.content_sha256 AS version_sha256, v.fetched_at, v.source_public_updated_at,
       d.id AS document_id, d.canonical_url, d.title AS document_title, d.nations, d.topics, d.tax_year,
       d.attribution_text
FROM document_chunks c
JOIN document_sections s ON s.id = c.section_id
JOIN document_versions v ON v.id = c.version_id AND v.status = 'active'
JOIN source_documents d ON d.id = v.document_id
WHERE d.licence_status = 'approved' AND d.lifecycle_status = 'active';
