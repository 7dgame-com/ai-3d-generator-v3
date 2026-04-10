-- frontend-direct-api mode switch defaults
-- Requirement 10.1 / 10.2 / 10.3

INSERT INTO system_config (`key`, `value`)
VALUES
  ('api_mode', 'direct'),
  ('prepare_timeout_minutes', '15')
ON DUPLICATE KEY UPDATE
  `value` = VALUES(`value`),
  updated_at = CURRENT_TIMESTAMP;
