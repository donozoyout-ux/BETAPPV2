CREATE TABLE IF NOT EXISTS prediction_stage_historical_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_version text NOT NULL DEFAULT 'CSV_STAGE_V1' CHECK(evidence_version='CSV_STAGE_V1'),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  competition_id uuid NOT NULL REFERENCES leagues(id),
  kickoff_at timestamptz NOT NULL,
  source_key text NOT NULL REFERENCES historical_csv_imports(source_key) ON DELETE CASCADE,
  odds_input_hash text NOT NULL,
  stage_basis text NOT NULL DEFAULT 'PRE_CLOSING_TO_CLOSING' CHECK(stage_basis='PRE_CLOSING_TO_CLOSING'),
  timing_known boolean NOT NULL DEFAULT false CHECK(timing_known=false),
  official_eligible boolean NOT NULL DEFAULT false CHECK(official_eligible=false),
  research_eligible boolean NOT NULL,
  bookmaker_count integer NOT NULL CHECK(bookmaker_count > 0),
  market_type text NOT NULL,
  market_name text NOT NULL,
  line numeric,
  selection text NOT NULL,
  opening_odds numeric(12,4) NOT NULL CHECK(opening_odds > 1),
  closing_odds numeric(12,4) NOT NULL CHECK(closing_odds > 1),
  opening_fair_probability numeric(10,8) NOT NULL,
  closing_fair_probability numeric(10,8) NOT NULL,
  probability_delta_pp numeric(10,6) NOT NULL,
  movement_agreement_ratio numeric(8,6) NOT NULL,
  movement_class text NOT NULL,
  settlement_result text NOT NULL CHECK(settlement_result IN('WIN','LOSS','PUSH','HALF_WIN','HALF_LOSS','VOID')),
  home_score integer,
  away_score integer,
  home_corners numeric,
  away_corners numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS prediction_stage_historical_identity_idx
  ON prediction_stage_historical_examples(match_id,source_key,odds_input_hash,market_type,market_name,COALESCE(line,-999999),selection);
CREATE INDEX IF NOT EXISTS prediction_stage_historical_lookup_idx
  ON prediction_stage_historical_examples(research_eligible,competition_id,market_type,market_name,line,selection,kickoff_at);

CREATE TABLE IF NOT EXISTS prediction_stage_historical_refreshes (
  source_key text PRIMARY KEY REFERENCES historical_csv_imports(source_key) ON DELETE CASCADE,
  source_content_hash text,
  evidence_version text NOT NULL DEFAULT 'CSV_STAGE_V1',
  status text NOT NULL CHECK(status IN('RUNNING','COMPLETED','FAILED')),
  matches_inspected integer NOT NULL DEFAULT 0,
  examples_inserted integer NOT NULL DEFAULT 0,
  research_eligible_examples integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
