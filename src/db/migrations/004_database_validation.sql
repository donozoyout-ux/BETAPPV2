ALTER TABLE historical_match_stats ADD COLUMN IF NOT EXISTS lineup_metadata jsonb;
ALTER TABLE historical_match_stats ADD COLUMN IF NOT EXISTS referee_metadata jsonb;

CREATE TABLE IF NOT EXISTS backfill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  competition_external_id text NOT NULL,
  competition_name text NOT NULL,
  season text NOT NULL,
  status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED','DRY_RUN')),
  fixtures_discovered integer NOT NULL DEFAULT 0,
  matches_fetched integer NOT NULL DEFAULT 0,
  matches_stored integer NOT NULL DEFAULT 0,
  corner_complete integer NOT NULL DEFAULT 0,
  partial integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  retries integer NOT NULL DEFAULT 0,
  last_checkpoint integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,competition_external_id,season)
);
CREATE INDEX IF NOT EXISTS backfill_runs_status_idx ON backfill_runs(status,updated_at DESC);

CREATE TABLE IF NOT EXISTS backfill_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  competition_external_id text NOT NULL,
  season text NOT NULL,
  match_external_id text NOT NULL,
  classification text NOT NULL CHECK(classification IN ('RETRYABLE','PERMANENT')),
  attempts integer NOT NULL DEFAULT 1,
  last_error text NOT NULL,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(provider,competition_external_id,season,match_external_id)
);
CREATE INDEX IF NOT EXISTS backfill_failures_retry_idx ON backfill_failures(classification,resolved_at,last_failed_at);

CREATE TABLE IF NOT EXISTS dataset_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dataset_audits_created_idx ON dataset_audits(created_at DESC);
CREATE INDEX IF NOT EXISTS corner_backtests_created_idx ON corner_backtests(created_at DESC);
