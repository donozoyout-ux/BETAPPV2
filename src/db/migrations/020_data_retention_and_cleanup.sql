-- 020_data_retention_and_cleanup.sql
-- Reclaims ~750MB+ of disk space and bounds data_observations and source_payloads to 1 row per entity.

TRUNCATE TABLE data_observations;
TRUNCATE TABLE source_payloads;

ALTER TABLE data_observations DROP CONSTRAINT IF EXISTS data_observations_pkey;
ALTER TABLE data_observations ADD PRIMARY KEY (match_id, metric, provider);

ALTER TABLE source_payloads DROP CONSTRAINT IF EXISTS source_payloads_pkey;
ALTER TABLE source_payloads ADD PRIMARY KEY (provider, entity_type, external_id);
