-- Global power-account migration for the unified quota model.
-- This migration only backfills tasks.power_cost for historical display/statistics
-- and creates the new global account tables. Legacy provider-scoped balance tables
-- remain in place for archive compatibility and are not rewritten here.

ALTER TABLE tasks
  MODIFY COLUMN credit_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  MODIFY COLUMN power_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00;

UPDATE tasks
SET power_cost = ROUND(
  CASE provider_id
    WHEN 'tripo3d' THEN credit_cost / 30
    WHEN 'hyper3d' THEN credit_cost / 0.5
    ELSE power_cost
  END,
  2
)
WHERE credit_cost > 0;

CREATE TABLE IF NOT EXISTS power_accounts (
  user_id                     INT UNSIGNED NOT NULL PRIMARY KEY COMMENT '主系统用户 ID',
  wallet_balance              DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Wallet 余额',
  pool_balance                DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Pool 余额',
  pool_baseline               DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '充值时的 pool_amount，节流基准线',
  wallet_injection_per_cycle  DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '每周期注入额度',
  cycles_remaining            INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '剩余周期数',
  cycle_duration              INT UNSIGNED NOT NULL DEFAULT 1440 COMMENT '周期时长（分钟）',
  total_duration              INT UNSIGNED NOT NULL DEFAULT 1440 COMMENT '总使用时长（分钟）',
  cycle_started_at            DATETIME COMMENT '当前周期开始时间',
  next_cycle_at               DATETIME COMMENT '下一个周期开始时间',
  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_power_accounts_next_cycle (next_cycle_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS power_ledger (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id              INT UNSIGNED NOT NULL COMMENT '主系统用户 ID',
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
  task_id              VARCHAR(64) COMMENT '关联任务 ID',
  provider_id          VARCHAR(32) COMMENT '关联 provider_id，仅任务结算场景写入',
  provider_credit_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Provider 原始 credits 消耗',
  power_cost           DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '内部统一 power 消耗',
  idempotency_key      VARCHAR(128) COMMENT '幂等键（inject/settle 时填写）',
  note                 VARCHAR(256),
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_power_ledger_user_id (user_id),
  INDEX idx_power_ledger_task_id (task_id),
  INDEX idx_power_ledger_provider_user (provider_id, user_id),
  UNIQUE KEY uk_power_ledger_idempotency (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS power_jobs (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL COMMENT '主系统用户 ID',
  job_type      ENUM('inject', 'settle') NOT NULL,
  cycle_key     VARCHAR(96) NOT NULL COMMENT '{user_id}:{cycle_start_at}，幂等键',
  status        ENUM('pending', 'done', 'failed') NOT NULL DEFAULT 'pending',
  executed_at   DATETIME,
  error_message VARCHAR(256),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_power_jobs_cycle_key (cycle_key),
  INDEX idx_power_jobs_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
