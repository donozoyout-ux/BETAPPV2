CREATE TABLE IF NOT EXISTS openfootball_imports (
  source_key text PRIMARY KEY,
  source_name text NOT NULL DEFAULT 'openfootball/football.json',
  competition text NOT NULL,
  season text NOT NULL,
  source_url text NOT NULL,
  content_hash text,
  status text NOT NULL CHECK(status IN ('PENDING','RUNNING','PARTIAL','COMPLETED','FAILED')) DEFAULT 'PENDING',
  total_matches integer NOT NULL DEFAULT 0,
  finished_rows integer NOT NULL DEFAULT 0,
  imported_rows integer NOT NULL DEFAULT 0,
  matches_inserted integer NOT NULL DEFAULT 0,
  matches_updated integer NOT NULL DEFAULT 0,
  duplicates_prevented integer NOT NULL DEFAULT 0,
  result_rows integer NOT NULL DEFAULT 0,
  skipped_unfinished integer NOT NULL DEFAULT 0,
  skipped_unsafe_time integer NOT NULL DEFAULT 0,
  cursor_row integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS openfootball_imports_status_idx ON openfootball_imports(status,updated_at);
