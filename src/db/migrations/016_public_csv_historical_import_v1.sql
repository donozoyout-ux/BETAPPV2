CREATE TABLE IF NOT EXISTS historical_csv_imports (
  source_key text PRIMARY KEY,
  source_name text NOT NULL,
  competition text NOT NULL,
  season text NOT NULL,
  source_url text NOT NULL,
  content_hash text,
  status text NOT NULL CHECK(status IN ('PENDING','RUNNING','PARTIAL','COMPLETED','FAILED')) DEFAULT 'PENDING',
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  imported_rows integer NOT NULL DEFAULT 0,
  matches_inserted integer NOT NULL DEFAULT 0,
  matches_updated integer NOT NULL DEFAULT 0,
  duplicates_prevented integer NOT NULL DEFAULT 0,
  statistics_rows integer NOT NULL DEFAULT 0,
  odds_rows integer NOT NULL DEFAULT 0,
  cursor_row integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS historical_market_odds (
  id bigserial PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_key text NOT NULL REFERENCES historical_csv_imports(source_key) ON DELETE CASCADE,
  bookmaker text NOT NULL,
  market_type text NOT NULL,
  market_name text NOT NULL,
  line numeric,
  selection text NOT NULL,
  odds_decimal numeric NOT NULL CHECK(odds_decimal > 1),
  observation_stage text NOT NULL CHECK(observation_stage IN ('PRE_CLOSING','CLOSING')),
  observed_at timestamptz,
  pre_kickoff_verified boolean NOT NULL DEFAULT true,
  source_row_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(match_id,source,bookmaker,market_type,market_name,line,selection,observation_stage,source_row_hash)
);

CREATE INDEX IF NOT EXISTS historical_csv_imports_status_idx ON historical_csv_imports(status,updated_at);
CREATE INDEX IF NOT EXISTS historical_market_odds_match_idx ON historical_market_odds(match_id,market_type,line,bookmaker);
CREATE INDEX IF NOT EXISTS historical_market_odds_source_idx ON historical_market_odds(source_key);
