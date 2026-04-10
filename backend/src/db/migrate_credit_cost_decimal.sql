ALTER TABLE tasks
  MODIFY COLUMN credit_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00
    COMMENT '实际消耗 credits';

ALTER TABLE credit_usage
  MODIFY COLUMN credits_used DECIMAL(12,2) NOT NULL DEFAULT 0.00;

UPDATE tasks
SET credit_cost = ROUND(power_cost / 0.04776, 2)
WHERE provider_id = 'tripo3d'
  AND status = 'success'
  AND power_cost > 0;

UPDATE tasks
SET credit_cost = ROUND(power_cost / 1.9176, 2)
WHERE provider_id = 'hyper3d'
  AND status = 'success'
  AND power_cost > 0;

UPDATE tasks
SET credit_cost = 30.00,
    power_cost = 1.43
WHERE provider_id = 'tripo3d'
  AND status = 'success'
  AND credit_cost = 0
  AND power_cost = 0;

UPDATE tasks
SET credit_cost = 0.50,
    power_cost = 0.96
WHERE provider_id = 'hyper3d'
  AND status = 'success'
  AND credit_cost = 0
  AND power_cost = 0;
