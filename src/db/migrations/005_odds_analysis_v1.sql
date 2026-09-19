CREATE TABLE IF NOT EXISTS odds_analysis_model_versions (
  model_version text NOT NULL,
  config_hash text NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(model_version, config_hash)
);

CREATE TABLE IF NOT EXISTS odds_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  model_version text NOT NULL,
  config_hash text NOT NULL,
  input_hash text NOT NULL,
  generated_at timestamptz NOT NULL,
  data_quality_score integer NOT NULL CHECK(data_quality_score BETWEEN 0 AND 100),
  data_quality_grade text NOT NULL CHECK(data_quality_grade IN ('GOOD','LIMITED','POOR')),
  confidence_score integer NOT NULL CHECK(confidence_score BETWEEN 0 AND 100),
  confidence_grade text NOT NULL CHECK(confidence_grade IN ('GOOD','LIMITED','POOR')),
  analysis_eligible boolean NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id, model_version, config_hash, input_hash),
  FOREIGN KEY(model_version, config_hash)
    REFERENCES odds_analysis_model_versions(model_version, config_hash)
);

CREATE TABLE IF NOT EXISTS odds_analysis_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES odds_analysis_runs(id) ON DELETE CASCADE,
  market_type text NOT NULL,
  market_name text NOT NULL,
  line numeric,
  selection text NOT NULL,
  opening_odds numeric(12,4) NOT NULL,
  current_odds numeric(12,4) NOT NULL,
  highest_odds numeric(12,4) NOT NULL,
  lowest_odds numeric(12,4) NOT NULL,
  snapshot_count integer NOT NULL,
  opening_fair_probability numeric(10,8) NOT NULL,
  current_fair_probability numeric(10,8) NOT NULL,
  probability_delta_pp numeric(10,6) NOT NULL,
  raw_odds_movement_percent numeric(10,6) NOT NULL,
  bookmaker_count integer NOT NULL,
  agreeing_bookmaker_count integer NOT NULL,
  disagreeing_bookmaker_count integer NOT NULL,
  movement_agreement_ratio numeric(8,6) NOT NULL,
  probability_dispersion numeric(10,6) NOT NULL,
  odds_dispersion numeric(10,6) NOT NULL,
  movement_class text NOT NULL CHECK(movement_class IN ('STRONG_SUPPORT','SUPPORT','NEUTRAL','OPPOSE','STRONG_OPPOSE')),
  score numeric(6,2) NOT NULL CHECK(score BETWEEN 0 AND 100),
  score_components jsonb NOT NULL,
  data_quality_score integer NOT NULL CHECK(data_quality_score BETWEEN 0 AND 100),
  data_quality_grade text NOT NULL CHECK(data_quality_grade IN ('GOOD','LIMITED','POOR')),
  confidence_score integer NOT NULL CHECK(confidence_score BETWEEN 0 AND 100),
  confidence_grade text NOT NULL CHECK(confidence_grade IN ('GOOD','LIMITED','POOR')),
  analysis_eligible boolean NOT NULL,
  model_market_gap_pp numeric(10,6),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS odds_analysis_backtests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL,
  config_hash text NOT NULL,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(model_version, config_hash)
    REFERENCES odds_analysis_model_versions(model_version, config_hash)
);

CREATE INDEX IF NOT EXISTS odds_analysis_runs_match_created_idx
  ON odds_analysis_runs(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS odds_analysis_runs_upcoming_idx
  ON odds_analysis_runs(model_version, analysis_eligible, created_at DESC);
CREATE INDEX IF NOT EXISTS odds_analysis_items_run_idx ON odds_analysis_items(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS odds_analysis_items_unique_idx
  ON odds_analysis_items(run_id, market_type, market_name, COALESCE(line, -999999), selection);
CREATE INDEX IF NOT EXISTS odds_analysis_items_market_idx
  ON odds_analysis_items(market_type, market_name, line, selection);
CREATE INDEX IF NOT EXISTS odds_analysis_items_class_score_idx
  ON odds_analysis_items(movement_class, score DESC);
CREATE INDEX IF NOT EXISTS odds_analysis_backtests_created_idx
  ON odds_analysis_backtests(created_at DESC);
