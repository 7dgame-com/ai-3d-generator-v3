import { pool } from '../db/connection';
import { type PowerAccountStatus, zeroPowerAccountStatus } from './powerManager';

const SITE_POWER_ACCOUNT_ID = 1;

export interface SiteRechargeParams {
  total_power: number;
  wallet_percent: number;
  pool_percent: number;
  wallet_amount: number;
  pool_amount: number;
  total_duration: number;
  cycle_duration: number;
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

export class SitePowerManager {
  async getAccountStatus(): Promise<PowerAccountStatus> {
    const [rows] = await pool.query<any[]>(
      `SELECT wallet_balance, pool_balance, pool_baseline, cycles_remaining,
              cycle_duration, total_duration, cycle_started_at, next_cycle_at
       FROM site_power_accounts
       WHERE id = ?
       LIMIT 1`,
      [SITE_POWER_ACCOUNT_ID]
    );

    if (!rows?.length) {
      return zeroPowerAccountStatus();
    }

    return {
      wallet_balance: toNumber(rows[0].wallet_balance),
      pool_balance: toNumber(rows[0].pool_balance),
      pool_baseline: toNumber(rows[0].pool_baseline),
      cycles_remaining: toNumber(rows[0].cycles_remaining),
      cycle_duration: toNumber(rows[0].cycle_duration),
      total_duration: toNumber(rows[0].total_duration),
      cycle_started_at: rows[0].cycle_started_at ?? null,
      next_cycle_at: rows[0].next_cycle_at ?? null,
    };
  }

  async recharge(params: SiteRechargeParams): Promise<void> {
    const {
      total_power,
      wallet_percent,
      pool_percent,
      wallet_amount,
      pool_amount,
      total_duration,
      cycle_duration,
    } = params;

    if (total_power <= 0 || wallet_amount < 0 || pool_amount < 0) {
      throw { code: 'INVALID_AMOUNT', message: 'total_power 必须大于 0，钱包和池塘额度不能为负数' };
    }
    if (wallet_percent + pool_percent !== 100) {
      throw { code: 'INVALID_PARAMS', message: 'wallet_percent 与 pool_percent 之和必须为 100' };
    }
    if (cycle_duration < 60 || cycle_duration > 43200) {
      throw { code: 'INVALID_PARAMS', message: 'cycle_duration 必须在 [60, 43200] 范围内' };
    }
    if (total_duration < cycle_duration) {
      throw { code: 'INVALID_PARAMS', message: 'total_duration 必须大于或等于 cycle_duration' };
    }

    const walletInjectionPerCycle = wallet_amount * cycle_duration / total_duration;
    const cyclesRemaining = Math.floor(total_duration / cycle_duration);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      await conn.query(
        'SELECT id FROM site_power_accounts WHERE id = ? FOR UPDATE',
        [SITE_POWER_ACCOUNT_ID]
      );

      await conn.query(
        `INSERT INTO site_power_accounts
          (id, wallet_balance, pool_balance, pool_baseline, wallet_injection_per_cycle,
           cycles_remaining, cycle_duration, total_duration, cycle_started_at, next_cycle_at)
         VALUES (${SITE_POWER_ACCOUNT_ID}, 0.00, ?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE))
         ON DUPLICATE KEY UPDATE
           wallet_balance = 0.00,
           pool_balance = VALUES(pool_balance),
           pool_baseline = VALUES(pool_baseline),
           wallet_injection_per_cycle = VALUES(wallet_injection_per_cycle),
           cycles_remaining = VALUES(cycles_remaining),
           cycle_duration = VALUES(cycle_duration),
           total_duration = VALUES(total_duration),
           cycle_started_at = NOW(),
           next_cycle_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)`,
        [
          pool_amount,
          pool_amount,
          walletInjectionPerCycle,
          cyclesRemaining,
          cycle_duration,
          total_duration,
          cycle_duration,
          cycle_duration,
        ]
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}

export const sitePowerManager = new SitePowerManager();
