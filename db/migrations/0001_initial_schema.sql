-- 0001: the Milestone 1 schema, unchanged, so databases created in M1 (via the old Docker
-- initdb mount) upgrade cleanly: every statement is idempotent. Never edit an applied
-- migration; the runner rejects files whose checksum no longer matches.
CREATE EXTENSION IF NOT EXISTS vector;

-- One row per GOV.UK page we have chosen to use. Licence review is a human decision:
-- nothing becomes retrievable until licence_status = 'approved'.
CREATE TABLE IF NOT EXISTS source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher TEXT NOT NULL CHECK (publisher IN ('govuk')),
  base_path TEXT NOT NULL UNIQUE CHECK (base_path ~ '^/[a-z0-9/-]+$'),
  canonical_url TEXT NOT NULL UNIQUE CHECK (canonical_url = 'https://www.gov.uk' || base_path),
  title TEXT NOT NULL,
  description TEXT,
  topics TEXT[] NOT NULL CHECK (cardinality(topics) > 0),
  -- 'uk' means the page applies UK-wide. Devolved rules (e.g. Scottish income tax) get their own value.
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('uk', 'great-britain', 'england-and-wales', 'england', 'wales', 'scotland', 'northern-ireland')),
  tax_year TEXT CHECK (tax_year ~ '^\d{4}-\d{2}$'),
  licence_id TEXT NOT NULL DEFAULT 'unreviewed' CHECK (licence_id IN ('unreviewed', 'OGL-UK-3.0', 'excluded')),
  licence_url TEXT,
  attribution_text TEXT,
  licence_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (licence_status IN ('pending_review', 'approved', 'rejected')),
  licence_reviewed_by TEXT,
  licence_reviewed_at TIMESTAMPTZ,
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'withdrawn', 'redirected', 'fetch_failing')),
  last_checked_at TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ,
  consecutive_check_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_check_failures >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An approval must say who approved it, when, and under which licence.
  CHECK (licence_status <> 'approved' OR (licence_id = 'OGL-UK-3.0' AND licence_reviewed_by IS NOT NULL AND licence_reviewed_at IS NOT NULL AND attribution_text IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  checked_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT
);

-- Immutable snapshots of a page. A new hash means a new row, never an UPDATE of content.
CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  ingestion_run_id UUID REFERENCES ingestion_runs(id),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_public_updated_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_text TEXT NOT NULL CHECK (length(content_text) > 0),
  -- candidate -> active -> superseded. Promotion happens in one transaction.
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'superseded')),
  UNIQUE (document_id, content_sha256)
);
-- At most one active version per document, enforced by the database rather than application code.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_version_per_document ON document_versions (document_id) WHERE status = 'active';

-- Embedding dimension is fixed per index. Changing to a model with a different dimension
-- is a migration plus full re-embed, not a config change.
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  -- Breadcrumb of section headings, e.g. 'Tax codes > Emergency tax codes'. Plain text because
  -- generated columns need immutable functions and array_to_string is not.
  heading TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL CHECK (length(content) > 0),
  -- Offsets into document_versions.content_text, so a citation can be checked against the exact source text.
  char_start INTEGER NOT NULL CHECK (char_start >= 0),
  char_end INTEGER NOT NULL,
  token_estimate INTEGER NOT NULL CHECK (token_estimate > 0),
  embedding_model TEXT,
  embedding vector(1536),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', heading), 'A') || setweight(to_tsvector('english', content), 'B')
  ) STORED,
  CHECK (char_end > char_start),
  CHECK ((embedding IS NULL) = (embedding_model IS NULL)),
  UNIQUE (version_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS chunks_fts_idx ON document_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- The only rows retrieval may read: approved licence, live page, active version.
CREATE OR REPLACE VIEW retrievable_chunks AS
SELECT c.*, d.id AS document_id, d.canonical_url, d.title, d.jurisdiction, d.topics, d.tax_year,
       d.attribution_text, v.source_public_updated_at, v.fetched_at
FROM document_chunks c
JOIN document_versions v ON v.id = c.version_id AND v.status = 'active'
JOIN source_documents d ON d.id = v.document_id
WHERE d.licence_status = 'approved' AND d.lifecycle_status = 'active';

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  git_commit TEXT,
  embedding_model TEXT,
  generation_model TEXT,
  test_set_version TEXT NOT NULL,
  metrics JSONB NOT NULL,
  limitations TEXT
);

-- Deliberately absent: user accounts, user questions, payslips or bank data.
-- Answer traces (M4) will store chunk IDs and model metadata, not the question text.
