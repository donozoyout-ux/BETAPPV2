ALTER TABLE provider_entities ADD COLUMN IF NOT EXISTS match_confidence text;

ALTER TABLE provider_status ADD COLUMN IF NOT EXISTS total_attempts bigint NOT NULL DEFAULT 0;
ALTER TABLE provider_status ADD COLUMN IF NOT EXISTS total_successes bigint NOT NULL DEFAULT 0;
ALTER TABLE provider_status ADD COLUMN IF NOT EXISTS circuit_state text NOT NULL DEFAULT 'CLOSED';
ALTER TABLE provider_status ADD COLUMN IF NOT EXISTS cooldown_until timestamptz;
ALTER TABLE provider_status DROP CONSTRAINT IF EXISTS provider_status_status_check;
ALTER TABLE provider_status ADD CONSTRAINT provider_status_status_check CHECK(status IN ('healthy','degraded','unavailable','blocked','unknown'));

ALTER TABLE source_payloads ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'application/json';
ALTER TABLE source_payloads ADD COLUMN IF NOT EXISTS parser_version text NOT NULL DEFAULT '1';
ALTER TABLE source_payloads ADD CONSTRAINT source_payload_compact CHECK (octet_length(payload::text) <= 65536) NOT VALID;

CREATE TABLE IF NOT EXISTS team_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(normalized_alias, provider)
);
CREATE INDEX IF NOT EXISTS team_aliases_normalized_idx ON team_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS provider_qualification (
  provider text NOT NULL,
  capability text NOT NULL,
  result text NOT NULL CHECK(result IN ('SUPPORTED','PARTIAL','UNAVAILABLE','BLOCKED','NOT_TESTED')),
  source text NOT NULL,
  checked_at timestamptz NOT NULL,
  http_status integer,
  latency_ms integer NOT NULL,
  sample_count integer NOT NULL,
  parse_success boolean NOT NULL,
  error text,
  notes text,
  PRIMARY KEY(provider, capability)
);

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_match_id text NOT NULL,
  market_type text NOT NULL,
  market_name text NOT NULL,
  line numeric,
  selection text NOT NULL,
  odds_decimal numeric(12,4) NOT NULL CHECK(odds_decimal > 1),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id,provider,market_type,market_name,line,selection,odds_decimal,captured_at)
);
CREATE INDEX IF NOT EXISTS odds_history_idx ON odds_snapshots(match_id,provider,market_type,market_name,line,selection,captured_at);
CREATE UNIQUE INDEX IF NOT EXISTS odds_snapshot_dedupe_idx ON odds_snapshots(
  match_id,provider,market_type,market_name,COALESCE(line,-999999),selection,odds_decimal,captured_at
);

CREATE TABLE IF NOT EXISTS data_observations (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  metric text NOT NULL,
  provider text NOT NULL,
  value text,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY(match_id,metric,provider,observed_at)
);

CREATE TABLE IF NOT EXISTS data_consensus (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  metric text NOT NULL,
  resolved_value text,
  status text NOT NULL CHECK(status IN ('VERIFIED','SINGLE_SOURCE','CONFLICT','MISSING')),
  provider_count integer NOT NULL,
  agreement_count integer NOT NULL,
  confidence numeric(5,4) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,metric)
);

CREATE VIEW odds_summary AS
WITH ranked AS (
  SELECT *, first_value(odds_decimal) OVER w AS opening_odds,
    last_value(odds_decimal) OVER wfull AS current_odds,
    max(odds_decimal) OVER wfull AS highest_odds,
    min(odds_decimal) OVER wfull AS lowest_odds,
    count(*) OVER wfull AS snapshot_count
  FROM odds_snapshots
  WINDOW w AS (PARTITION BY match_id,provider,market_type,market_name,line,selection ORDER BY captured_at),
    wfull AS (PARTITION BY match_id,provider,market_type,market_name,line,selection ORDER BY captured_at ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
)
SELECT DISTINCT match_id,provider,market_type,market_name,line,selection,opening_odds,current_odds,highest_odds,lowest_odds,
  CASE WHEN opening_odds=0 THEN 0 ELSE ((current_odds-opening_odds)/opening_odds)*100 END AS movement_percent,
  snapshot_count
FROM ranked;
