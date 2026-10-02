-- 020_data_retention_and_cleanup.sql
-- Immediately reclaims ~750MB of disk space by truncating unbounded log tables.

TRUNCATE TABLE data_observations;
TRUNCATE TABLE source_payloads;
