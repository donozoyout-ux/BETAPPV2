CREATE TABLE IF NOT EXISTS prediction_self_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_version text NOT NULL,
  model_version text NOT NULL,
  config_hash text NOT NULL,
  input_hash text NOT NULL,
  evaluated_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('INSUFFICIENT_DATA','HEALTHY','WATCH','PAUSED')),
  settled_sample_size integer NOT NULL,
  binary_sample_size integer NOT NULL,
  recent_sample_size integer NOT NULL,
  recent_binary_sample_size integer NOT NULL,
  recent_positive_rate numeric(10,8),
  recent_reference_paper_roi numeric(12,8),
  calibration_mae numeric(10,8),
  calibration_sample_size integer NOT NULL,
  loss_streak integer NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(audit_version,model_version,config_hash,input_hash)
);

CREATE INDEX IF NOT EXISTS prediction_self_audits_latest_idx
  ON prediction_self_audits(model_version,evaluated_at DESC,created_at DESC);
