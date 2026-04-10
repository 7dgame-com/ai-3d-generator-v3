import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../db/connection';
import {
  type ConfirmDeductResult,
  type DeductResult,
  type PowerAccountStatus,
  zeroPowerAccountStatus,
} from './powerManager';

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

interface TaskRowForBilling {
  status: string;
  error_message: string | null;
}

interface PreDeductLedgerRow {
  wallet_delta: string | number;
  pool_delta: string | number;
  provider_id?: string | null;
}

export class SitePowerManager {
  private async applyConfirmDeductInTransaction(
    conn: Pick<PoolConnection, 'query'>,
    providerId: string,
    taskId: string,
    actualAmount: number,
    providerCreditCost = 0
  ): Promise<ConfirmDeductResult> {
    const [preRowsRaw] = await conn.query<any[]>(
      `SELECT wallet_delta, pool_delta, provider_id
       FROM site_power_ledger
       WHERE task_id = ? AND event_type = 'pre_deduct'`,
      [taskId]
    );

    const preRows = preRowsRaw as PreDeductLedgerRow[];
    const preDeductedWallet = preRows.reduce(
      (sum, row) => sum + Math.abs(toNumber(row.wallet_delta)),
      0
    );
    const preDeductedPool = preRows.reduce(
      (sum, row) => sum + Math.abs(toNumber(row.pool_delta)),
      0
    );
    const preDeducted = preDeductedWallet + preDeductedPool;
    const diff = actualAmount - preDeducted;
    const persistedProviderId = preRows[0]?.provider_id ?? providerId;

    let shortfallAmount = 0;

    if (diff < 0) {
      const refundAmount = Math.abs(diff);

      await conn.query(
        'SELECT id FROM site_power_accounts WHERE id = ? FOR UPDATE',
        [SITE_POWER_ACCOUNT_ID]
      );

      const poolRefund = Math.min(refundAmount, preDeductedPool);
      const walletRefund = refundAmount - poolRefund;

      await conn.query(
        `UPDATE site_power_accounts
         SET wallet_balance = wallet_balance + ?,
             pool_balance = pool_balance + ?
         WHERE id = ?`,
        [walletRefund, poolRefund, SITE_POWER_ACCOUNT_ID]
      );

      await conn.query(
        `INSERT INTO site_power_ledger
          (event_type, wallet_delta, pool_delta, task_id, provider_id, provider_credit_cost, power_cost, note)
         VALUES ('confirm_deduct', ?, ?, ?, ?, ?, ?, ?)`,
        [
          walletRefund,
          poolRefund,
          taskId,
          persistedProviderId,
          providerCreditCost,
          actualAmount,
          `actual=${actualAmount},pre=${preDeducted},refund=${refundAmount}`,
        ]
      );
    } else if (diff > 0) {
      const [balRows] = await conn.query<any[]>(
        'SELECT wallet_balance, pool_balance FROM site_power_accounts WHERE id = ? FOR UPDATE',
        [SITE_POWER_ACCOUNT_ID]
      );

      let walletExtra = 0;
      let poolExtra = 0;

      if (balRows && balRows.length > 0) {
        const walletBal = toNumber(balRows[0].wallet_balance);
        const poolBal = toNumber(balRows[0].pool_balance);

        poolExtra = Math.min(diff, poolBal);
        walletExtra = Math.min(diff - poolExtra, walletBal);
        const totalExtra = poolExtra + walletExtra;
        shortfallAmount = Math.max(0, diff - totalExtra);

        if (totalExtra > 0) {
          await conn.query(
            `UPDATE site_power_accounts
             SET pool_balance = pool_balance - ?,
                 wallet_balance = wallet_balance - ?
             WHERE id = ?`,
            [poolExtra, walletExtra, SITE_POWER_ACCOUNT_ID]
          );
        }
      } else {
        shortfallAmount = diff;
      }

      const noteParts = [`actual=${actualAmount}`, `pre=${preDeducted}`, `extra=${diff}`];
      if (shortfallAmount > 0) {
        noteParts.push(`shortfall=${shortfallAmount}`);
      }

      await conn.query(
        `INSERT INTO site_power_ledger
          (event_type, wallet_delta, pool_delta, task_id, provider_id, provider_credit_cost, power_cost, note)
         VALUES ('confirm_deduct', ?, ?, ?, ?, ?, ?, ?)`,
        [
          -walletExtra,
          -poolExtra,
          taskId,
          persistedProviderId,
          providerCreditCost,
          actualAmount,
          noteParts.join(','),
        ]
      );
    } else {
      await conn.query(
        `INSERT INTO site_power_ledger
          (event_type, wallet_delta, pool_delta, task_id, provider_id, provider_credit_cost, power_cost, note)
         VALUES ('confirm_deduct', ?, ?, ?, ?, ?, ?, ?)`,
        [
          -preDeductedWallet,
          -preDeductedPool,
          taskId,
          persistedProviderId,
          providerCreditCost,
          actualAmount,
          `actual=${actualAmount}`,
        ]
      );
    }

    if (shortfallAmount > 0) {
      return {
        billingStatus: 'undercharged',
        billingMessage: `计费待补扣：shortfall=${shortfallAmount}, actual=${actualAmount}`,
        shortfallAmount,
      };
    }

    return {
      billingStatus: 'settled',
      billingMessage: null,
      shortfallAmount: 0,
    };
  }

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

      await conn.query(
        `INSERT INTO site_power_ledger
          (event_type, wallet_delta, pool_delta, power_cost, note)
         VALUES ('recharge', ?, ?, ?, ?)`,
        [
          wallet_amount,
          pool_amount,
          total_power,
          `wallet_percent=${wallet_percent},pool_percent=${pool_percent}`,
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

  async preDeduct(providerId: string, amount: number, taskId: string): Promise<DeductResult> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query<any[]>(
        'SELECT wallet_balance, pool_balance FROM site_power_accounts WHERE id = ? FOR UPDATE',
        [SITE_POWER_ACCOUNT_ID]
      );

      if (!rows || rows.length === 0) {
        await conn.rollback();
        return { success: false, errorCode: 'INSUFFICIENT_CREDITS' };
      }

      const walletBal = toNumber(rows[0].wallet_balance);
      const poolBal = toNumber(rows[0].pool_balance);

      const walletDeducted = Math.min(walletBal, amount);
      const poolDeducted = amount - walletDeducted;

      if (poolDeducted > poolBal) {
        await conn.rollback();
        return { success: false, errorCode: 'INSUFFICIENT_CREDITS' };
      }

      const [updateResult] = await conn.query<any>(
        `UPDATE site_power_accounts
         SET wallet_balance = wallet_balance - ?,
             pool_balance = pool_balance - ?
         WHERE id = ?
           AND wallet_balance >= ?
           AND pool_balance >= ?`,
        [walletDeducted, poolDeducted, SITE_POWER_ACCOUNT_ID, walletDeducted, poolDeducted]
      );

      if (updateResult.affectedRows === 0) {
        await conn.rollback();
        return { success: false, errorCode: 'CONCURRENT_CONFLICT' };
      }

      await conn.query(
        `INSERT INTO site_power_ledger
          (event_type, wallet_delta, pool_delta, task_id, provider_id, power_cost)
         VALUES ('pre_deduct', ?, ?, ?, ?, ?)`,
        [-walletDeducted, -poolDeducted, taskId, providerId, amount]
      );

      await conn.commit();
      return { success: true, walletDeducted, poolDeducted };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async refund(providerId: string, taskId: string): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [ledgerRows] = await conn.query<any[]>(
        `SELECT wallet_delta, pool_delta, provider_id
         FROM site_power_ledger
         WHERE task_id = ? AND event_type = 'pre_deduct'
         LIMIT 1`,
        [taskId]
      );

      if (!ledgerRows || ledgerRows.length === 0) {
        await conn.rollback();
        return;
      }

      const walletRefund = Math.abs(toNumber(ledgerRows[0].wallet_delta));
      const poolRefund = Math.abs(toNumber(ledgerRows[0].pool_delta));
      const persistedProviderId = ledgerRows[0].provider_id ?? providerId;

      await conn.query(
        `UPDATE site_power_accounts
         SET wallet_balance = wallet_balance + ?,
             pool_balance = pool_balance + ?
         WHERE id = ?`,
        [walletRefund, poolRefund, SITE_POWER_ACCOUNT_ID]
      );

      await conn.query(
        `INSERT INTO site_power_ledger
          (event_type, wallet_delta, pool_delta, task_id, provider_id, power_cost)
         VALUES ('refund', ?, ?, ?, ?, ?)`,
        [walletRefund, poolRefund, taskId, persistedProviderId, walletRefund + poolRefund]
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async confirmDeduct(
    providerId: string,
    taskId: string,
    actualAmount: number,
    providerCreditCost = 0
  ): Promise<ConfirmDeductResult> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await this.applyConfirmDeductInTransaction(
        conn,
        providerId,
        taskId,
        actualAmount,
        providerCreditCost
      );
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async finalizeTaskSuccess(
    providerId: string,
    taskId: string,
    outputUrl: string,
    powerCost: number,
    creditCost: number,
    thumbnailUrl?: string
  ): Promise<ConfirmDeductResult> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [taskRowsRaw] = await conn.query<any[]>(
        `SELECT status, error_message
         FROM tasks
         WHERE task_id = ?
         FOR UPDATE`,
        [taskId]
      );

      const taskRows = taskRowsRaw as TaskRowForBilling[];
      const task = taskRows?.[0];
      if (!task) {
        throw new Error(`任务不存在: ${taskId}`);
      }

      if (task.status === 'success') {
        await conn.commit();
        const billingMessage = task.error_message?.startsWith('计费待补扣：') ? task.error_message : null;
        return {
          billingStatus: billingMessage ? 'undercharged' : 'settled',
          billingMessage,
          shortfallAmount: 0,
        };
      }

      const result = await this.applyConfirmDeductInTransaction(
        conn,
        providerId,
        taskId,
        powerCost,
        creditCost
      );

      await conn.query(
        `UPDATE tasks
         SET status = 'success',
             output_url = ?,
             thumbnail_url = ?,
             credit_cost = ?,
             power_cost = ?,
             error_message = ?,
             completed_at = NOW()
         WHERE task_id = ?`,
        [outputUrl, thumbnailUrl ?? null, creditCost, powerCost, result.billingMessage, taskId]
      );

      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async injectWallet(cycleKey: string): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.query<any[]>(
        "SELECT id FROM site_power_ledger WHERE idempotency_key = ? AND event_type = 'inject' LIMIT 1",
        [cycleKey]
      );
      if (existingRows && existingRows.length > 0) {
        await conn.commit();
        return;
      }

      const [rows] = await conn.query<any[]>(
        'SELECT wallet_injection_per_cycle, cycles_remaining FROM site_power_accounts WHERE id = ? FOR UPDATE',
        [SITE_POWER_ACCOUNT_ID]
      );

      if (!rows || rows.length === 0 || toNumber(rows[0].cycles_remaining) === 0) {
        await conn.rollback();
        return;
      }

      const injectionAmount = toNumber(rows[0].wallet_injection_per_cycle);

      await conn.query(
        `UPDATE site_power_accounts
         SET wallet_balance = wallet_balance + ?,
             cycles_remaining = cycles_remaining - 1
         WHERE id = ?`,
        [injectionAmount, SITE_POWER_ACCOUNT_ID]
      );

      await conn.query(
        `INSERT INTO site_power_ledger
          (event_type, wallet_delta, pool_delta, idempotency_key)
         VALUES ('inject', ?, 0, ?)`,
        [injectionAmount, cycleKey]
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async settleWallet(cycleKey: string): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.query<any[]>(
        "SELECT id FROM site_power_ledger WHERE idempotency_key = ? AND event_type = 'settle' LIMIT 1",
        [cycleKey]
      );
      if (existingRows && existingRows.length > 0) {
        await conn.commit();
        return;
      }

      const [rows] = await conn.query<any[]>(
        'SELECT wallet_balance FROM site_power_accounts WHERE id = ? FOR UPDATE',
        [SITE_POWER_ACCOUNT_ID]
      );

      if (!rows || rows.length === 0) {
        await conn.rollback();
        return;
      }

      const walletBalance = toNumber(rows[0].wallet_balance);

      await conn.query(
        `UPDATE site_power_accounts
         SET pool_balance = pool_balance + wallet_balance,
             wallet_balance = 0
         WHERE id = ?`,
        [SITE_POWER_ACCOUNT_ID]
      );

      await conn.query(
        `INSERT INTO site_power_ledger
          (event_type, wallet_delta, pool_delta, idempotency_key)
         VALUES ('settle', ?, ?, ?)`,
        [-walletBalance, walletBalance, cycleKey]
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
