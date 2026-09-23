CREATE TABLE live_source_snapshots (
  match_id uuid NOT NULL REFERENCES matches(id),
  provider text NOT NULL CHECK (provider IN ('fotmob','api-football')),
  data jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY(match_id,provider)
);
CREATE TABLE live_match_events (
  id bigserial PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES matches(id),
  provider text NOT NULL,
  fingerprint text NOT NULL,
  data jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id,provider,fingerprint)
);
CREATE INDEX live_events_match ON live_match_events(match_id,observed_at);
CREATE TABLE live_provider_health (
  provider text PRIMARY KEY,
  status text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  detail text
);
