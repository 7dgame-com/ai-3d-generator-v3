-- P1 administrator runtime, diagnostics, and audit storage migration reference.
-- Production startup applies the idempotent equivalent through schemaHealth.ts.
-- migration id: 20260714_ai3d_p1_admin_observability.

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id INT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(128) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  detail_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_audit_logs_created_at (created_at),
  INDEX idx_admin_audit_logs_target (target_type, target_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
