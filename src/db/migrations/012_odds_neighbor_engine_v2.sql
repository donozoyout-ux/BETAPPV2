-- Supports one batched historical-odds lookup per API response. These indexes
-- do not alter Prediction V1 tables or journal behaviour.
CREATE INDEX IF NOT EXISTS odds_snapshots_neighbor_market_idx
  ON odds_snapshots(market_type,market_name,line,selection,match_id,captured_at);
CREATE INDEX IF NOT EXISTS matches_status_kickoff_idx ON matches(status,kickoff_at);
