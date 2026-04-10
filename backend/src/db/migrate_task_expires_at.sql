ALTER TABLE tasks
ADD COLUMN expires_at DATETIME NULL COMMENT '任务输出 URL 过期时间（UTC）' AFTER completed_at;

CREATE INDEX idx_expires_at ON tasks (expires_at);
