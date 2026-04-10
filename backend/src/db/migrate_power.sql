-- Credits to Power migration for ai-3d-generator-v3
-- All wallet/pool/ledger balances are converted from provider credits to power.

START TRANSACTION;

ALTER TABLE tasks
  ADD COLUMN power_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00
    COMMENT '转换后的 power 消耗值'
  AFTER credit_cost;

UPDATE tasks
SET power_cost = ROUND(credit_cost * 0.04776, 2)
WHERE provider_id = 'tripo3d' AND credit_cost > 0;

UPDATE tasks
SET power_cost = ROUND(credit_cost * 1.9176, 2)
WHERE provider_id = 'hyper3d' AND credit_cost > 0;

UPDATE tasks
SET power_cost = ROUND(credit_cost, 2)
WHERE provider_id NOT IN ('tripo3d', 'hyper3d')
  AND credit_cost > 0
  AND power_cost = 0;

SELECT CONCAT('WARN unknown provider_id in tasks uses default ratio 1.0: ', provider_id) AS warning
FROM tasks
WHERE provider_id NOT IN ('tripo3d', 'hyper3d')
GROUP BY provider_id;

UPDATE user_accounts
SET wallet_balance = ROUND(wallet_balance * 0.04776, 2),
    pool_balance = ROUND(pool_balance * 0.04776, 2),
    pool_baseline = ROUND(pool_baseline * 0.04776, 2),
    wallet_injection_per_cycle = ROUND(wallet_injection_per_cycle * 0.04776, 2)
WHERE provider_id = 'tripo3d';

UPDATE user_accounts
SET wallet_balance = ROUND(wallet_balance * 1.9176, 2),
    pool_balance = ROUND(pool_balance * 1.9176, 2),
    pool_baseline = ROUND(pool_baseline * 1.9176, 2),
    wallet_injection_per_cycle = ROUND(wallet_injection_per_cycle * 1.9176, 2)
WHERE provider_id = 'hyper3d';

UPDATE credit_ledger
SET wallet_delta = ROUND(wallet_delta * 0.04776, 2),
    pool_delta = ROUND(pool_delta * 0.04776, 2)
WHERE provider_id = 'tripo3d';

UPDATE credit_ledger
SET wallet_delta = ROUND(wallet_delta * 1.9176, 2),
    pool_delta = ROUND(pool_delta * 1.9176, 2)
WHERE provider_id = 'hyper3d';

COMMIT;
