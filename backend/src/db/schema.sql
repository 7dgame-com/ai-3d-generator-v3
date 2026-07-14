-- AI 3D Generator V3 Plugin Database Schema
-- Database: ai_3d_generator_v3

CREATE TABLE IF NOT EXISTS tasks (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id       VARCHAR(64) NOT NULL UNIQUE COMMENT '平台本地任务 ID',
  provider_task_id VARCHAR(128) NULL COMMENT '供应商任务 ID',
  user_id       INT UNSIGNED NOT NULL COMMENT '主系统用户 ID',
  provider_id   VARCHAR(32)  NOT NULL DEFAULT 'tripo3d' COMMENT '服务提供商标识符',
  type          ENUM('text_to_model', 'image_to_model') NOT NULL,
  prompt        TEXT COMMENT '文本提示词（image-to-3D 时为空）',
  status        VARCHAR(32) NOT NULL DEFAULT 'waiting_provider',
  progress      TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '进度 0-100',
  credit_cost   DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '实际消耗 credits',
  power_cost    DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '实际消耗 power（= credit_cost / CREDITS_PER_POWER）',
  file_size     BIGINT UNSIGNED COMMENT '模型文件大小（字节）',
  output_url    TEXT COMMENT 'Provider 输出 GLB URL',
  thumbnail_url TEXT COMMENT 'Provider 输出缩略图 URL',
  provider_status_key VARCHAR(1024) COMMENT 'Provider 轮询任务键，若为空则回退到 task_id',
  request_payload LONGTEXT COMMENT '待派发供应商请求 JSON',
  credential_scope VARCHAR(64) NOT NULL DEFAULT 'default',
  priority INT NOT NULL DEFAULT 0,
  queue_entered_at DATETIME NULL,
  next_attempt_at DATETIME NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  lease_owner VARCHAR(128) NULL,
  lease_expires_at DATETIME NULL,
  provider_slot_acquired_at DATETIME NULL,
  provider_slot_released_at DATETIME NULL,
  provider_error_category VARCHAR(32) NULL,
  provider_error_code VARCHAR(64) NULL,
  provider_trace_id VARCHAR(128) NULL,
  retry_after_seconds INT UNSIGNED NULL,
  quota_epoch INT UNSIGNED NOT NULL DEFAULT 1,
  reserved_power DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cancellation_reason VARCHAR(256) NULL,
  resource_id   INT UNSIGNED COMMENT '主系统 Resource 资产 ID（上传后填写）',
  error_message VARCHAR(512) COMMENT '失败原因',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at  DATETIME COMMENT '完成时间',
  expires_at    DATETIME COMMENT '任务输出 URL 过期时间（UTC）',
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_provider_id (provider_id),
  INDEX idx_provider_queue (provider_id, credential_scope, status, next_attempt_at, priority, queue_entered_at),
  INDEX idx_provider_slots (provider_id, credential_scope, provider_slot_released_at, status),
  INDEX idx_user_provider_outstanding (user_id, provider_id, status),
  INDEX idx_lease_expires (lease_expires_at),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS credit_usage (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  task_id      VARCHAR(64) NOT NULL COMMENT 'Provider 任务 ID',
  credits_used DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_config (
  `key`       VARCHAR(64) NOT NULL PRIMARY KEY,
  `value`     TEXT NOT NULL COMMENT 'AES-256-GCM 加密存储',
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id         VARCHAR(128) NOT NULL PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO system_config (`key`, `value`)
VALUES ('quota.default_limit_power', '0')
ON DUPLICATE KEY UPDATE `value` = `value`;

-- Simple per-user usage quota tool

CREATE TABLE IF NOT EXISTS quota_user_usage (
  user_id     INT UNSIGNED NOT NULL PRIMARY KEY COMMENT '主系统用户 ID',
  quota_epoch INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '当前额度周期',
  used_power  DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '累计已使用 power',
  user_snapshot JSON NULL COMMENT '使用时记录的主系统用户快照',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_quota_user_usage_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quota_usage_ledger (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id              INT UNSIGNED NOT NULL COMMENT '主系统用户 ID',
  quota_epoch          INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '额度周期',
  event_type           ENUM('pre_deduct', 'refund', 'confirm_deduct', 'admin_reset') NOT NULL,
  power_delta          DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '本次对 used_power 的增减',
  used_power_after     DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '事件后的累计已用 power',
  task_id              VARCHAR(64) COMMENT '关联任务 ID',
  provider_id          VARCHAR(32) COMMENT '关联 provider_id',
  provider_credit_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Provider 原始 credits 消耗',
  power_cost           DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '内部统一 power 消耗',
  note                 VARCHAR(256),
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_quota_usage_ledger_user_id (user_id),
  INDEX idx_quota_usage_ledger_task_id (task_id),
  INDEX idx_quota_usage_ledger_provider_user (provider_id, user_id),
  INDEX idx_quota_usage_ledger_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

INSERT INTO provider_runtime_config (provider_id, credential_scope, max_concurrency)
VALUES ('tripo3d', 'default', 4), ('hyper3d', 'default', 1)
ON DUPLICATE KEY UPDATE provider_id = provider_id;

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
