CREATE TABLE control_audit_runs (
  id bigserial PRIMARY KEY,
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS','WARN','FAIL')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX control_audit_runs_checked_at_idx ON control_audit_runs(checked_at DESC);
