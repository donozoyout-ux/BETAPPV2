ALTER TABLE historical_match_stats ADD COLUMN IF NOT EXISTS home_offsides numeric;
ALTER TABLE historical_match_stats ADD COLUMN IF NOT EXISTS away_offsides numeric;
ALTER TABLE historical_match_stats ADD COLUMN IF NOT EXISTS referee_external_id text;
ALTER TABLE historical_match_stats ADD COLUMN IF NOT EXISTS data_quality text NOT NULL DEFAULT 'LIMITED'
  CHECK(data_quality IN ('COMPLETE','PARTIAL','LIMITED','POOR'));

CREATE TABLE IF NOT EXISTS historical_stat_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_external_id text NOT NULL,
  fetched_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  raw_payload_hash text NOT NULL,
  data_quality text NOT NULL CHECK(data_quality IN ('COMPLETE','PARTIAL','LIMITED','POOR')),
  normalization_version text NOT NULL,
  field_presence jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id,provider,provider_external_id,raw_payload_hash,normalization_version)
);
CREATE INDEX IF NOT EXISTS historical_stat_provenance_match_idx
  ON historical_stat_provenance(match_id,provider,created_at DESC);

CREATE TABLE IF NOT EXISTS historical_backfill_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  competition_id text NOT NULL,
  season text NOT NULL,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED','DISABLED_BY_POLICY','MANUAL_REVIEW_REQUIRED','DRY_RUN')),
  requested integer NOT NULL DEFAULT 0,
  received integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  duplicates integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(provider,competition_id,season)
);
CREATE INDEX IF NOT EXISTS historical_backfill_jobs_status_idx
  ON historical_backfill_jobs(provider,status,updated_at DESC);
