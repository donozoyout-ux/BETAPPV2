CREATE TABLE IF NOT EXISTS prediction_model_versions (
  model_version text NOT NULL,
  config_hash text NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(model_version,config_hash)
);

CREATE TABLE IF NOT EXISTS prediction_historical_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  competition_id uuid NOT NULL REFERENCES leagues(id),
  kickoff_at timestamptz NOT NULL,
  model_version text NOT NULL,
  config_hash text NOT NULL,
  odds_input_hash text NOT NULL,
  feature_cutoff_at timestamptz NOT NULL,
  feature_lead_minutes numeric(10,3) NOT NULL CHECK(feature_lead_minutes > 0),
  analysis_eligible boolean NOT NULL,
  data_quality_grade text NOT NULL,
  confidence_grade text NOT NULL,
  complete_state_bookmaker_count integer NOT NULL,
  minimum_complete_state_count integer NOT NULL,
  market_type text NOT NULL,
  market_name text NOT NULL,
  line numeric,
  selection text NOT NULL,
  opening_odds numeric(12,4) NOT NULL,
  current_odds numeric(12,4) NOT NULL,
  opening_fair_probability numeric(10,8) NOT NULL,
  current_fair_probability numeric(10,8) NOT NULL,
  probability_delta_pp numeric(10,6) NOT NULL,
  bookmaker_count integer NOT NULL,
  movement_agreement_ratio numeric(8,6) NOT NULL,
  odds_analysis_score numeric(6,2) NOT NULL,
  data_quality_score integer NOT NULL,
  confidence_score integer NOT NULL,
  movement_class text NOT NULL,
  settlement_result text NOT NULL CHECK(settlement_result IN ('WIN','LOSS','PUSH','HALF_WIN','HALF_LOSS','VOID')),
  home_score integer,
  away_score integer,
  home_corners numeric,
  away_corners numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(model_version,config_hash) REFERENCES prediction_model_versions(model_version,config_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS prediction_historical_examples_identity_idx ON prediction_historical_examples(
  match_id,model_version,config_hash,odds_input_hash,market_type,market_name,COALESCE(line,-999999),selection
);
CREATE INDEX IF NOT EXISTS prediction_historical_examples_lookup_idx ON prediction_historical_examples(
  market_type,market_name,line,selection,kickoff_at
);
CREATE INDEX IF NOT EXISTS prediction_historical_examples_competition_idx ON prediction_historical_examples(
  competition_id,market_type,market_name,line,selection,kickoff_at
);
CREATE INDEX IF NOT EXISTS prediction_historical_examples_eligible_idx ON prediction_historical_examples(
  analysis_eligible,market_type,market_name,line,selection,kickoff_at
);

CREATE TABLE IF NOT EXISTS prediction_historical_refreshes (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  model_version text NOT NULL,
  config_hash text NOT NULL,
  examples_inserted integer NOT NULL DEFAULT 0,
  rejected_ineligible integer NOT NULL DEFAULT 0,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,model_version,config_hash),
  FOREIGN KEY(model_version,config_hash) REFERENCES prediction_model_versions(model_version,config_hash)
);

CREATE TABLE IF NOT EXISTS prediction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  model_version text NOT NULL,
  config_hash text NOT NULL,
  input_hash text NOT NULL,
  odds_analysis_input_hash text NOT NULL,
  generated_at timestamptz NOT NULL,
  decision text NOT NULL CHECK(decision IN ('PREDICT','SKIP')),
  selected_candidate jsonb,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  skip_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id,model_version,config_hash,input_hash),
  FOREIGN KEY(model_version,config_hash) REFERENCES prediction_model_versions(model_version,config_hash)
);
CREATE INDEX IF NOT EXISTS prediction_runs_match_created_idx ON prediction_runs(match_id,created_at DESC);

CREATE TABLE IF NOT EXISTS prediction_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id),
  prediction_run_id uuid NOT NULL UNIQUE REFERENCES prediction_runs(id),
  model_version text NOT NULL,
  config_hash text NOT NULL,
  locked_at timestamptz NOT NULL,
  kickoff_at timestamptz NOT NULL,
  minutes_to_kickoff numeric(10,3) NOT NULL,
  decision text NOT NULL CHECK(decision IN ('PREDICT','SKIP')),
  market_type text,
  market_name text,
  line numeric,
  selection text,
  reference_odds numeric(12,4),
  opening_odds numeric(12,4),
  current_odds numeric(12,4),
  current_fair_probability numeric(10,8),
  probability_delta_pp numeric(10,6),
  prediction_score numeric(6,2),
  score_components jsonb,
  bookmaker_count integer,
  agreement_ratio numeric(8,6),
  data_quality_score integer,
  data_quality_grade text,
  confidence_score integer,
  confidence_grade text,
  movement_class text,
  historical_sample_size integer NOT NULL DEFAULT 0,
  historical_settled_sample_size integer NOT NULL DEFAULT 0,
  historical_hit_rate numeric(10,8),
  historical_wilson_lower95 numeric(10,8),
  historical_wilson_upper95 numeric(10,8),
  historical_scope text,
  historical_frequency_gap_pp numeric(10,6),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id,model_version),
  FOREIGN KEY(model_version,config_hash) REFERENCES prediction_model_versions(model_version,config_hash),
  CHECK(locked_at < kickoff_at),
  CHECK(minutes_to_kickoff > 0),
  CHECK((decision='SKIP' AND market_type IS NULL AND selection IS NULL)
    OR (decision='PREDICT' AND market_type IS NOT NULL AND selection IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS prediction_journal_kickoff_idx ON prediction_journal(kickoff_at DESC);
CREATE INDEX IF NOT EXISTS prediction_journal_decision_idx ON prediction_journal(decision,kickoff_at DESC);

CREATE TABLE IF NOT EXISTS prediction_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_journal_id uuid NOT NULL UNIQUE REFERENCES prediction_journal(id),
  outcome text NOT NULL CHECK(outcome IN ('WIN','LOSS','PUSH','HALF_WIN','HALF_LOSS','VOID')),
  home_score integer,
  away_score integer,
  home_corners numeric,
  away_corners numeric,
  reference_paper_return numeric(12,6) NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS prediction_settlements_outcome_idx ON prediction_settlements(outcome,settled_at DESC);

CREATE OR REPLACE FUNCTION prevent_prediction_journal_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'prediction_journal is immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS prediction_journal_immutable ON prediction_journal;
CREATE TRIGGER prediction_journal_immutable BEFORE UPDATE OR DELETE ON prediction_journal
FOR EACH ROW EXECUTE FUNCTION prevent_prediction_journal_mutation();

CREATE OR REPLACE FUNCTION prevent_prediction_settlement_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'prediction_settlements are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS prediction_settlement_immutable ON prediction_settlements;
CREATE TRIGGER prediction_settlement_immutable BEFORE UPDATE OR DELETE ON prediction_settlements
FOR EACH ROW EXECUTE FUNCTION prevent_prediction_settlement_mutation();
