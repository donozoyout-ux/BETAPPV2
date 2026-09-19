CREATE TABLE IF NOT EXISTS prediction_adaptive_rule_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_version text NOT NULL CHECK(audit_version='SELF_AUDIT_V4'),
  model_version text NOT NULL,
  prediction_config_hash text NOT NULL,
  config_hash text NOT NULL,
  input_hash text NOT NULL,
  proposal_key text NOT NULL,
  proposal_type text NOT NULL CHECK(proposal_type IN ('SINGLE_FACTOR_GUARD','COMBINATION_GUARD')),
  severity text NOT NULL CHECK(severity IN ('WATCH','HIGH_RISK')),
  title text NOT NULL,
  conditions jsonb NOT NULL,
  suggested_change jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL,
  binary_sample_size integer NOT NULL,
  positive_rate numeric(10,8) NOT NULL,
  reference_paper_roi numeric(12,8) NOT NULL,
  baseline_binary_sample_size integer NOT NULL,
  baseline_positive_rate numeric(10,8) NOT NULL,
  baseline_reference_paper_roi numeric(12,8) NOT NULL,
  positive_rate_gap numeric(10,8) NOT NULL,
  reference_paper_roi_gap numeric(12,8) NOT NULL,
  interaction_positive_rate_gap numeric(10,8),
  interaction_reference_paper_roi_gap numeric(12,8),
  evidence_strength numeric(10,8) NOT NULL,
  proposal_score numeric(8,2) NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(audit_version,model_version,prediction_config_hash,config_hash,proposal_key,input_hash)
);

CREATE INDEX IF NOT EXISTS prediction_adaptive_rule_proposals_latest_idx
  ON prediction_adaptive_rule_proposals(model_version,prediction_config_hash,proposal_key,evaluated_at DESC,created_at DESC);

CREATE INDEX IF NOT EXISTS prediction_adaptive_rule_proposals_risk_idx
  ON prediction_adaptive_rule_proposals(model_version,prediction_config_hash,severity,proposal_score DESC,evaluated_at DESC);

CREATE TABLE IF NOT EXISTS prediction_adaptive_rule_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL UNIQUE REFERENCES prediction_adaptive_rule_proposals(id),
  decision text NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
  note text,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_prediction_adaptive_proposal_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'prediction_adaptive_rule_proposals are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS prediction_adaptive_rule_proposals_immutable ON prediction_adaptive_rule_proposals;
CREATE TRIGGER prediction_adaptive_rule_proposals_immutable
BEFORE UPDATE OR DELETE ON prediction_adaptive_rule_proposals
FOR EACH ROW EXECUTE FUNCTION prevent_prediction_adaptive_proposal_mutation();

CREATE OR REPLACE FUNCTION prevent_prediction_adaptive_decision_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'prediction_adaptive_rule_decisions are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS prediction_adaptive_rule_decisions_immutable ON prediction_adaptive_rule_decisions;
CREATE TRIGGER prediction_adaptive_rule_decisions_immutable
BEFORE UPDATE OR DELETE ON prediction_adaptive_rule_decisions
FOR EACH ROW EXECUTE FUNCTION prevent_prediction_adaptive_decision_mutation();
