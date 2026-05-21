-- Replace wallet/pool/cycle quota management with simple per-user usage quotas.
-- Destructive: old quota management tables are dropped after the new tables exist.

START TRANSACTION;

CREATE TABLE IF NOT EXISTS quota_user_usage (
  user_id     INT UNSIGNED NOT NULL PRIMARY KEY,
  used_power  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  user_snapshot JSON NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_quota_user_usage_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quota_usage_ledger (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id              INT UNSIGNED NOT NULL,
  event_type           ENUM('pre_deduct', 'refund', 'confirm_deduct', 'admin_reset') NOT NULL,
  power_delta          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  used_power_after     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  task_id              VARCHAR(64) NULL,
  provider_id          VARCHAR(32) NULL,
  provider_credit_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  power_cost           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  note                 VARCHAR(256) NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_quota_usage_ledger_user_id (user_id),
  INDEX idx_quota_usage_ledger_task_id (task_id),
  INDEX idx_quota_usage_ledger_provider_user (provider_id, user_id),
  INDEX idx_quota_usage_ledger_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @quota_user_snapshot_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quota_user_usage'
    AND COLUMN_NAME = 'user_snapshot'
);
SET @quota_user_snapshot_column_sql = IF(
  @quota_user_snapshot_column_exists = 0,
  'ALTER TABLE quota_user_usage ADD COLUMN user_snapshot JSON NULL AFTER used_power',
  'SELECT 1'
);
PREPARE quota_user_snapshot_column_stmt FROM @quota_user_snapshot_column_sql;
EXECUTE quota_user_snapshot_column_stmt;
DEALLOCATE PREPARE quota_user_snapshot_column_stmt;

INSERT INTO system_config (`key`, `value`)
VALUES ('quota.default_limit_power', '0')
ON DUPLICATE KEY UPDATE `value` = `value`;

DROP TABLE IF EXISTS site_power_jobs;
DROP TABLE IF EXISTS site_power_ledger;
DROP TABLE IF EXISTS site_power_accounts;
DROP TABLE IF EXISTS power_jobs;
DROP TABLE IF EXISTS power_ledger;
DROP TABLE IF EXISTS power_accounts;
DROP TABLE IF EXISTS quota_jobs;
DROP TABLE IF EXISTS credit_ledger;
DROP TABLE IF EXISTS user_accounts;

COMMIT;
