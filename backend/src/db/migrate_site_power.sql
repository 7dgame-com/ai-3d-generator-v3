CREATE TABLE IF NOT EXISTS site_power_accounts (
  id                         TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  wallet_balance             DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  pool_balance               DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  pool_baseline              DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  wallet_injection_per_cycle DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cycles_remaining           INT UNSIGNED NOT NULL DEFAULT 0,
  cycle_duration             INT UNSIGNED NOT NULL DEFAULT 1440,
  total_duration             INT UNSIGNED NOT NULL DEFAULT 1440,
  cycle_started_at           DATETIME NULL,
  next_cycle_at              DATETIME NULL,
  created_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_site_power_accounts_next_cycle (next_cycle_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS site_power_ledger (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type           ENUM(
    'recharge',
    'inject',
    'settle',
    'pre_deduct',
    'refund',
    'confirm_deduct'
  ) NOT NULL,
  wallet_delta         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  pool_delta           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  task_id              VARCHAR(64) NULL,
  provider_id          VARCHAR(32) NULL,
  provider_credit_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  power_cost           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  idempotency_key      VARCHAR(128) NULL,
  note                 VARCHAR(256) NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_site_power_ledger_task_id (task_id),
  UNIQUE KEY uk_site_power_ledger_idempotency (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS site_power_jobs (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_type      ENUM('inject', 'settle') NOT NULL,
  cycle_key     VARCHAR(96) NOT NULL,
  status        ENUM('pending', 'done', 'failed') NOT NULL DEFAULT 'pending',
  executed_at   DATETIME NULL,
  error_message VARCHAR(256) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_site_power_jobs_cycle_key (cycle_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
