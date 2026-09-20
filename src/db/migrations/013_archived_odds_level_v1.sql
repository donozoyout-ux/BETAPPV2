-- Historical archived odds are deliberately separate from odds_snapshots.
-- Rows here have no genuine source observation timestamp and therefore MUST NOT
-- participate in Odds Route movement, opening/closing semantics, or Prediction V1.

CREATE TABLE IF NOT EXISTS historical_archived_odds_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  source text NOT NULL,
  provider text NOT NULL,
  provider_match_id text NOT NULL,
  market_type text NOT NULL,
  market_name text NOT NULL,
  line numeric,
  selection text NOT NULL,
  odds_decimal numeric(12,4) NOT NULL CHECK(odds_decimal > 1),
  state_group text NOT NULL CHECK(state_group IN ('CURRENT_FIELD_GROUP')),
  source_date date NOT NULL,
  source_observation_at timestamptz,
  match_kickoff_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  raw_payload_hash text NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK(source_observation_at IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS historical_archived_odds_states_dedupe_idx
  ON historical_archived_odds_states(
    match_id,provider,market_type,market_name,COALESCE(line,-999999),
    selection,state_group,source_date,odds_decimal
  );

CREATE INDEX IF NOT EXISTS historical_archived_odds_states_lookup_idx
  ON historical_archived_odds_states(
    market_type,market_name,line,selection,odds_decimal,match_kickoff_at
  );

CREATE INDEX IF NOT EXISTS historical_archived_odds_states_match_idx
  ON historical_archived_odds_states(match_id,provider,source_date);

CREATE TABLE IF NOT EXISTS historical_odds_backfill_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  cursor_date date,
  status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED','DRY_RUN')),
  dates_requested integer NOT NULL DEFAULT 0,
  fixtures_seen integer NOT NULL DEFAULT 0,
  finished_fixtures integer NOT NULL DEFAULT 0,
  matched integer NOT NULL DEFAULT 0,
  unmatched integer NOT NULL DEFAULT 0,
  ambiguous integer NOT NULL DEFAULT 0,
  states_seen integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  duplicates integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(source,from_date,to_date)
);
