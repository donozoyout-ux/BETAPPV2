CREATE TABLE IF NOT EXISTS odds_collection_state (
  provider text NOT NULL,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  provider_match_id text,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_snapshot_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  snapshots_inserted integer NOT NULL DEFAULT 0,
  last_status text NOT NULL CHECK(last_status IN ('SUCCESS','NO_ODDS','ERROR')),
  last_error text,
  PRIMARY KEY(provider,match_id)
);

CREATE INDEX IF NOT EXISTS odds_collection_state_provider_attempt_idx
  ON odds_collection_state(provider,last_attempt_at);
CREATE INDEX IF NOT EXISTS odds_snapshots_prematch_coverage_idx
  ON odds_snapshots(match_id,captured_at,provider);
