CREATE TABLE IF NOT EXISTS prediction_self_audit_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_version text NOT NULL,
  model_version text NOT NULL,
  prediction_config_hash text NOT NULL,
  config_hash text NOT NULL,
  input_hash text NOT NULL,
  dimension text NOT NULL CHECK(dimension IN (
    'PREDICTION_SCORE','BOOKMAKER_COUNT','HISTORICAL_SAMPLE','DATA_QUALITY_GRADE',
    'CONFIDENCE_GRADE','MOVEMENT_CLASS','AGREEMENT_RATIO'
  )),
  bucket_key text NOT NULL,
  bucket_label text NOT NULL,
  evaluated_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('INSUFFICIENT_DATA','HEALTHY','WATCH','HIGH_RISK')),
  settled_sample_size integer NOT NULL,
  binary_sample_size integer NOT NULL,
  positive_rate numeric(10,8),
  reference_paper_roi numeric(12,8),
  calibration_gap numeric(10,8),
  calibration_sample_size integer NOT NULL,
  baseline_binary_sample_size integer NOT NULL,
  baseline_positive_rate numeric(10,8),
  baseline_reference_paper_roi numeric(12,8),
  positive_rate_gap numeric(10,8),
  reference_paper_roi_gap numeric(12,8),
  evidence_strength numeric(10,8) NOT NULL,
  root_cause_score numeric(8,2) NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(audit_version,model_version,prediction_config_hash,config_hash,dimension,bucket_key,input_hash)
);

CREATE INDEX IF NOT EXISTS prediction_self_audit_factors_latest_idx
  ON prediction_self_audit_factors(model_version,prediction_config_hash,dimension,bucket_key,evaluated_at DESC,created_at DESC);

CREATE INDEX IF NOT EXISTS prediction_self_audit_factors_risk_idx
  ON prediction_self_audit_factors(model_version,prediction_config_hash,status,root_cause_score DESC,evaluated_at DESC);
