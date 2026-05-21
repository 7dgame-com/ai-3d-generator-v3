-- ai_3d_generator_v3 数据库初始化兜底脚本
-- 用于首次初始化、云端应急导入或本地快速恢复
-- 正式结构演进请优先维护 plugins/ai-3d-generator-v3/backend/src/db/schema.sql
--
-- 使用方法:
--   mysql -h <HOST> -P <PORT> -u <USER> -p < ai-3d-generator-v3-schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS `ai_3d_generator_v3`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

USE `ai_3d_generator_v3`;

-- AI 3D Generator V3 Plugin Database Schema
-- Database: ai_3d_generator_v3

CREATE TABLE IF NOT EXISTS tasks (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id       VARCHAR(64) NOT NULL UNIQUE COMMENT 'Tripo3D 任务 ID',
  user_id       INT UNSIGNED NOT NULL COMMENT '主系统用户 ID',
  provider_id   VARCHAR(32)  NOT NULL DEFAULT 'tripo3d' COMMENT '服务提供商标识符',
  type          ENUM('text_to_model', 'image_to_model') NOT NULL,
  prompt        TEXT COMMENT '文本提示词（image-to-3D 时为空）',
  status        ENUM('queued', 'processing', 'success', 'failed', 'timeout') NOT NULL DEFAULT 'queued',
  progress      TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '进度 0-100',
  credit_cost   DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '实际消耗 credits',
  power_cost    DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '实际消耗 power（= credit_cost / CREDITS_PER_POWER）',
  file_size     BIGINT UNSIGNED COMMENT '模型文件大小（字节）',
  output_url    TEXT COMMENT 'Provider 输出 GLB URL',
  thumbnail_url TEXT COMMENT 'Provider 输出缩略图 URL',
  provider_status_key VARCHAR(1024) COMMENT 'Provider 轮询任务键，若为空则回退到 task_id',
  resource_id   INT UNSIGNED COMMENT '主系统 Resource 资产 ID（上传后填写）',
  error_message VARCHAR(512) COMMENT '失败原因',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at  DATETIME COMMENT '完成时间',
  expires_at    DATETIME COMMENT '任务输出 URL 过期时间（UTC）',
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_provider_id (provider_id),
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

INSERT INTO system_config (`key`, `value`)
VALUES ('quota.default_limit_power', '0')
ON DUPLICATE KEY UPDATE `value` = `value`;

-- Simple per-user usage quota tool

CREATE TABLE IF NOT EXISTS quota_user_usage (
  user_id     INT UNSIGNED NOT NULL PRIMARY KEY COMMENT '主系统用户 ID',
  used_power  DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '累计已使用 power',
  user_snapshot JSON NULL COMMENT '使用时记录的主系统用户快照',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_quota_user_usage_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quota_usage_ledger (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id              INT UNSIGNED NOT NULL COMMENT '主系统用户 ID',
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
