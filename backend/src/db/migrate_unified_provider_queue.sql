-- Unified provider queue migration reference.
-- Production startup applies the idempotent equivalent through schemaHealth.ts
-- migration id: 20260714_ai3d_unified_provider_queue.

ALTER TABLE tasks MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'waiting_provider';
ALTER TABLE tasks ADD COLUMN provider_task_id VARCHAR(128) NULL AFTER task_id;
ALTER TABLE tasks ADD COLUMN credential_scope VARCHAR(64) NOT NULL DEFAULT 'default' AFTER provider_id;
ALTER TABLE tasks ADD COLUMN request_payload LONGTEXT NULL AFTER provider_status_key;
ALTER TABLE tasks ADD COLUMN priority INT NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN queue_entered_at DATETIME NULL;
ALTER TABLE tasks ADD COLUMN next_attempt_at DATETIME NULL;
ALTER TABLE tasks ADD COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN lease_owner VARCHAR(128) NULL;
ALTER TABLE tasks ADD COLUMN lease_expires_at DATETIME NULL;
ALTER TABLE tasks ADD COLUMN provider_slot_acquired_at DATETIME NULL;
ALTER TABLE tasks ADD COLUMN provider_slot_released_at DATETIME NULL;
ALTER TABLE tasks ADD COLUMN provider_error_category VARCHAR(32) NULL;
ALTER TABLE tasks ADD COLUMN provider_error_code VARCHAR(64) NULL;
ALTER TABLE tasks ADD COLUMN provider_trace_id VARCHAR(128) NULL;
ALTER TABLE tasks ADD COLUMN retry_after_seconds INT UNSIGNED NULL;
ALTER TABLE tasks ADD COLUMN quota_epoch INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN reserved_power DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE tasks ADD COLUMN cancellation_reason VARCHAR(256) NULL;
CREATE INDEX idx_user_provider_outstanding ON tasks (user_id, provider_id, status);

ALTER TABLE quota_user_usage ADD COLUMN quota_epoch INT UNSIGNED NOT NULL DEFAULT 1 AFTER user_id;
ALTER TABLE quota_usage_ledger ADD COLUMN quota_epoch INT UNSIGNED NOT NULL DEFAULT 1 AFTER user_id;

CREATE TABLE IF NOT EXISTS provider_runtime_config (
  provider_id VARCHAR(32) NOT NULL,
  credential_scope VARCHAR(64) NOT NULL DEFAULT 'default',
  max_concurrency INT UNSIGNED NOT NULL,
  paused TINYINT(1) NOT NULL DEFAULT 0,
  pause_reason VARCHAR(256) NULL,
  poll_interval_seconds INT UNSIGNED NOT NULL DEFAULT 3,
  retry_limit INT UNSIGNED NOT NULL DEFAULT 6,
  config_version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_id, credential_scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

CREATE TABLE IF NOT EXISTS provider_task_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL,
  provider_id VARCHAR(32) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  from_status VARCHAR(32) NULL,
  to_status VARCHAR(32) NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  trace_id VARCHAR(128) NULL,
  detail_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_provider_task_events_task (task_id, created_at),
  INDEX idx_provider_task_events_provider (provider_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
