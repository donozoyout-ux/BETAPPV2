-- 020_data_retention_and_cleanup.sql
-- Reclaims ~750MB+ disk space and bounds data_observations and source_payloads.

TRUNCATE TABLE data_observations;
TRUNCATE TABLE source_payloads;

DO $$
BEGIN
  -- Drop existing PK on data_observations if any
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'data_observations'::regclass AND contype = 'p'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE data_observations DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'data_observations'::regclass AND contype = 'p'
    );
  END IF;

  -- Drop existing PK on source_payloads if any
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'source_payloads'::regclass AND contype = 'p'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE source_payloads DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'source_payloads'::regclass AND contype = 'p'
    );
  END IF;
END $$;

ALTER TABLE data_observations ADD PRIMARY KEY (match_id, metric, provider);
ALTER TABLE source_payloads ADD PRIMARY KEY (provider, entity_type, external_id);
