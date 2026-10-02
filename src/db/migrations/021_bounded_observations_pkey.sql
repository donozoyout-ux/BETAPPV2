-- 021_bounded_observations_pkey.sql
-- Runs in separate transaction after disk space is reclaimed, bounding tables to 1 row per entity.

ALTER TABLE data_observations DROP CONSTRAINT IF EXISTS data_observations_pkey;
ALTER TABLE data_observations ADD PRIMARY KEY (match_id, metric, provider);

ALTER TABLE source_payloads DROP CONSTRAINT IF EXISTS source_payloads_pkey;
ALTER TABLE source_payloads ADD PRIMARY KEY (provider, entity_type, external_id);
