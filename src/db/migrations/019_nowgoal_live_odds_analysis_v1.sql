CREATE TABLE IF NOT EXISTS nowgoal_live_odds_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  nowgoal_match_id text NOT NULL,
  source_url text NOT NULL,
  captured_at timestamptz NOT NULL,
  match_minute text,
  minute_label text,
  score_home integer,
  score_away integer,
  score_text text,
  period text NOT NULL,
  bookmaker text,
  ah_initial_home numeric, ah_initial_line numeric, ah_initial_away numeric,
  ah_live_home numeric, ah_live_line numeric, ah_live_away numeric,
  one_x_two_initial_home numeric, one_x_two_initial_draw numeric, one_x_two_initial_away numeric,
  one_x_two_live_home numeric, one_x_two_live_draw numeric, one_x_two_live_away numeric,
  ou_initial_over numeric, ou_initial_line numeric, ou_initial_under numeric,
  ou_live_over numeric, ou_live_line numeric, ou_live_under numeric,
  parser_version text NOT NULL,
  raw_hash text NOT NULL,
  raw_payload jsonb,
  sheet_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (score_home IS NULL OR score_home >= 0),
  CHECK (score_away IS NULL OR score_away >= 0),
  CHECK (octet_length(COALESCE(raw_payload::text,'')) <= 65536)
);
CREATE INDEX IF NOT EXISTS nowgoal_live_odds_match_captured_idx
  ON nowgoal_live_odds_snapshots(match_id,captured_at DESC);
CREATE INDEX IF NOT EXISTS nowgoal_live_odds_provider_captured_idx
  ON nowgoal_live_odds_snapshots(nowgoal_match_id,captured_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS nowgoal_live_odds_observation_identity_idx
  ON nowgoal_live_odds_snapshots(match_id,nowgoal_match_id,COALESCE(match_minute,''),
    COALESCE(score_home,-1),COALESCE(score_away,-1),period,COALESCE(bookmaker,''),raw_hash);
CREATE INDEX IF NOT EXISTS nowgoal_live_odds_unsynced_idx
  ON nowgoal_live_odds_snapshots(captured_at,id) WHERE sheet_synced_at IS NULL;

CREATE TABLE IF NOT EXISTS nowgoal_live_match_tracking (
  match_id uuid PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  finished_final_capture_at timestamptz,
  last_capture_at timestamptz,
  last_status text NOT NULL DEFAULT 'NOT_CONFIGURED',
  last_error text,
  duplicates_blocked bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nowgoal_live_tracking_pending_idx
  ON nowgoal_live_match_tracking(last_capture_at);
