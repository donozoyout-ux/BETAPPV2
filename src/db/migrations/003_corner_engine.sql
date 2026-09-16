CREATE TABLE IF NOT EXISTS historical_match_stats (
  match_id uuid PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  competition_id uuid NOT NULL REFERENCES leagues(id),
  season text,
  kickoff_at timestamptz NOT NULL,
  home_team_id uuid NOT NULL REFERENCES teams(id),
  away_team_id uuid NOT NULL REFERENCES teams(id),
  home_goals integer,
  away_goals integer,
  home_corners numeric,
  away_corners numeric,
  first_half_home_corners numeric,
  first_half_away_corners numeric,
  home_xg numeric,
  away_xg numeric,
  home_shots numeric,
  away_shots numeric,
  home_shots_on_target numeric,
  away_shots_on_target numeric,
  home_possession numeric,
  away_possession numeric,
  home_fouls numeric,
  away_fouls numeric,
  home_yellow_cards numeric,
  away_yellow_cards numeric,
  home_red_cards numeric,
  away_red_cards numeric,
  provider text NOT NULL,
  source_timestamp timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS historical_stats_competition_kickoff_idx ON historical_match_stats(competition_id,kickoff_at);
CREATE INDEX IF NOT EXISTS historical_stats_home_kickoff_idx ON historical_match_stats(home_team_id,kickoff_at);
CREATE INDEX IF NOT EXISTS historical_stats_away_kickoff_idx ON historical_match_stats(away_team_id,kickoff_at);

CREATE TABLE IF NOT EXISTS team_corner_profiles (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  competition_id uuid NOT NULL REFERENCES leagues(id),
  season text NOT NULL,
  window_type text NOT NULL CHECK(window_type IN ('LAST_5','LAST_10','LAST_20','SEASON')),
  venue text NOT NULL CHECK(venue IN ('HOME','AWAY')),
  sample_size integer NOT NULL,
  corners_for_avg numeric,
  corners_against_avg numeric,
  total_match_corners_avg numeric,
  corners_for_stddev numeric,
  corners_against_stddev numeric,
  over_7_5_rate numeric,
  over_8_5_rate numeric,
  over_9_5_rate numeric,
  over_10_5_rate numeric,
  over_11_5_rate numeric,
  over_12_5_rate numeric,
  first_half_corners_for_avg numeric,
  first_half_corners_against_avg numeric,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,competition_id,season,window_type,venue)
);

CREATE TABLE IF NOT EXISTS league_corner_baselines (
  competition_id uuid NOT NULL REFERENCES leagues(id),
  season text NOT NULL,
  avg_home_corners numeric,
  avg_away_corners numeric,
  avg_total_corners numeric,
  stddev_total_corners numeric,
  variance_total_corners numeric,
  over_7_5_rate numeric,
  over_8_5_rate numeric,
  over_9_5_rate numeric,
  over_10_5_rate numeric,
  over_11_5_rate numeric,
  over_12_5_rate numeric,
  sample_size integer NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(competition_id,season)
);

CREATE TABLE IF NOT EXISTS corner_model_versions (
  model_version text NOT NULL,
  config_hash text NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(model_version,config_hash)
);

CREATE TABLE IF NOT EXISTS corner_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  model_version text NOT NULL,
  config_hash text NOT NULL,
  expected_home_corners numeric NOT NULL,
  expected_away_corners numeric NOT NULL,
  expected_total_corners numeric NOT NULL,
  probabilities jsonb NOT NULL,
  distribution text NOT NULL,
  data_quality_score integer NOT NULL,
  data_quality_status text NOT NULL,
  analysis_eligible boolean NOT NULL,
  model_confidence integer NOT NULL,
  sample jsonb NOT NULL,
  calculation_details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id,model_version,config_hash),
  FOREIGN KEY(model_version,config_hash) REFERENCES corner_model_versions(model_version,config_hash)
);

CREATE TABLE IF NOT EXISTS corner_backtests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL,
  config_hash text NOT NULL,
  competition_id uuid REFERENCES leagues(id),
  season text,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(model_version,config_hash) REFERENCES corner_model_versions(model_version,config_hash)
);
