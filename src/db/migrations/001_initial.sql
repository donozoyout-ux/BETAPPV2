CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  short_name text,
  country text,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id),
  home_team_id uuid NOT NULL REFERENCES teams(id),
  away_team_id uuid NOT NULL REFERENCES teams(id),
  kickoff_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled','live','finished','postponed','cancelled','unknown')),
  round text,
  season text,
  home_score integer,
  away_score integer,
  source_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (home_team_id <> away_team_id)
);

CREATE INDEX IF NOT EXISTS matches_kickoff_idx ON matches(kickoff_at);
CREATE INDEX IF NOT EXISTS matches_league_kickoff_idx ON matches(league_id, kickoff_at);

CREATE TABLE IF NOT EXISTS provider_entities (
  provider text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('league','team','match')),
  external_id text NOT NULL,
  internal_id uuid NOT NULL,
  source_updated_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, entity_type, external_id),
  UNIQUE (provider, entity_type, internal_id)
);

CREATE INDEX IF NOT EXISTS provider_entities_internal_idx ON provider_entities(entity_type, internal_id);

CREATE TABLE IF NOT EXISTS match_statistics (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  provider text NOT NULL,
  period text NOT NULL,
  stat_key text NOT NULL,
  label text NOT NULL,
  home_value text,
  away_value text,
  source_updated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, provider, period, stat_key)
);

CREATE TABLE IF NOT EXISTS source_payloads (
  provider text NOT NULL,
  entity_type text NOT NULL,
  external_id text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  source_updated_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, entity_type, external_id, payload_hash)
);

CREATE TABLE IF NOT EXISTS collector_checkpoints (
  provider text NOT NULL,
  scope text NOT NULL,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, scope)
);

CREATE TABLE IF NOT EXISTS provider_status (
  provider text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('healthy','degraded','unavailable','unknown')),
  last_checked_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_fetch_at timestamptz,
  latency_ms integer,
  consecutive_failures integer NOT NULL DEFAULT 0,
  message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
