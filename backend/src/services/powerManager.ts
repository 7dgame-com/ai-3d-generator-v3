import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../db/connection';

export interface RechargeParams {
  wallet_amount: number;
  pool_amount: number;
  total_duration: number;
  cycle_duration: number;
}

export interface DeductResult {
  success: boolean;
  errorCode?: 'INSUFFICIENT_CREDITS' | 'CONCURRENT_CONFLICT';
  walletDeducted?: number;
  poolDeducted?: number;
}

export interface PowerAccountStatus {
  wallet_balance: number;
  pool_balance: number;
  pool_baseline: number;
  cycles_remaining: number;
  cycle_duration: number;
  total_duration: number;
  cycle_started_at: Date | null;
  next_cycle_at: Date | null;
}

export interface ConfirmDeductResult {
  billingStatus: 'settled' | 'undercharged';
  billingMessage: string | null;
  shortfallAmount: number;
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

export function computeThrottleDelay(
  poolCurrent: number,
  poolBaseline: number,
  maxDelayMs: number
): number {
  if (poolBaseline <= 0) return 0;
  if (poolCurrent <= 0) return -1;
  if (poolCurrent >= poolBaseline) return 0;

  const ratio = (poolBaseline - poolCurrent) / poolBaseline;
  return Math.round(maxDelayMs * ratio);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

export function zeroPowerAccountStatus(): PowerAccountStatus {
  return {
    wallet_balance: 0,
    pool_balance: 0,
    pool_baseline: 0,
    cycles_remaining: 0,
    cycle_duration: 0,
    total_duration: 0,
    cycle_started_at: null,
    next_cycle_at: null,
  };
}

export class PowerManager {
  private async applyConfirmDeductInTransaction(
    conn: Pick<PoolConnection, 'query'>,
    userId: number,
    providerId: string,
    taskId: string,
    actualAmount: number,
    providerCreditCost = 0
  ): Promise<ConfirmDeductResult> {
    const [preRowsRaw] = await conn.query<any[]>(
      `SELECT wallet_delta, pool_delta, provider_id
       FROM power_ledger
       WHERE user_id = ? AND task_id = ? AND event_type = 'pre_deduct'`,
      [userId, taskId]
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
        'SELECT user_id FROM power_accounts WHERE user_id = ? FOR UPDATE',
        [userId]
      );

      const poolRefund = Math.min(refundAmount, preDeductedPool);
      const walletRefund = refundAmount - poolRefund;

      await conn.query(
        `UPDATE power_accounts
         SET wallet_balance = wallet_balance + ?,
             pool_balance = pool_balance + ?
         WHERE user_id = ?`,
        [walletRefund, poolRefund, userId]
      );

      await conn.query(
        `INSERT INTO power_ledger
          (user_id, event_type, wallet_delta, pool_delta, task_id, provider_id, provider_credit_cost, power_cost, note)
         VALUES (?, 'confirm_deduct', ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
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
        'SELECT wallet_balance, pool_balance FROM power_accounts WHERE user_id = ? FOR UPDATE',
        [userId]
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

        if (shortfallAmount > 0) {
          console.warn(
            `[PowerManager] confirmDeduct: 余额不足以完成追加扣减 (userId=${userId}, providerId=${providerId}, taskId=${taskId}, diff=${diff}, shortfall=${shortfallAmount})`
          );
        }

        if (totalExtra > 0) {
          await conn.query(
            `UPDATE power_accounts
             SET pool_balance = pool_balance - ?,
                 wallet_balance = wallet_balance - ?
             WHERE user_id = ?`,
            [poolExtra, walletExtra, userId]
          );
        }
      } else {
        shortfallAmount = diff;
        console.warn(
          `[PowerManager] confirmDeduct: 未找到用户账户，无法完成追加扣减 (userId=${userId}, providerId=${providerId}, taskId=${taskId}, shortfall=${shortfallAmount})`
        );
      }

      const noteParts = [`actual=${actualAmount}`, `pre=${preDeducted}`, `extra=${diff}`];
      if (shortfallAmount > 0) {
        noteParts.push(`shortfall=${shortfallAmount}`);
      }

      await conn.query(
        `INSERT INTO power_ledger
          (user_id, event_type, wallet_delta, pool_delta, task_id, provider_id, provider_credit_cost, power_cost, note)
         VALUES (?, 'confirm_deduct', ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
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
        `INSERT INTO power_ledger
          (user_id, event_type, wallet_delta, pool_delta, task_id, provider_id, provider_credit_cost, power_cost, note)
         VALUES (?, 'confirm_deduct', ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
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

  async recharge(userId: number, params: RechargeParams): Promise<void> {
    const { wallet_amount, pool_amount, total_duration, cycle_duration } = params;

    if (wallet_amount <= 0 || pool_amount < 0) {
      throw { code: 'INVALID_AMOUNT', message: 'wallet_amount 必须大于 0，pool_amount 必须大于或等于 0' };
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
        'SELECT user_id FROM power_accounts WHERE user_id = ? FOR UPDATE',
        [userId]
      );

      await conn.query(
        `INSERT INTO power_accounts
          (user_id, wallet_balance, pool_balance, pool_baseline,
           wallet_injection_per_cycle, cycles_remaining,
           cycle_duration, total_duration, cycle_started_at, next_cycle_at)
         VALUES (?, 0.00, ?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE))
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
          userId,
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

      const note = `wallet_amount=${wallet_amount}, wallet_injection_per_cycle=${walletInjectionPerCycle}, cycles_remaining=${cyclesRemaining}`;
      await conn.query(
        `INSERT INTO power_ledger
          (user_id, event_type, wallet_delta, pool_delta, note)
         VALUES (?, 'recharge', ?, ?, ?)`,
        [userId, wallet_amount, pool_amount, note]
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async preDeduct(userId: number, providerId: string, amount: number, taskId: string): Promise<DeductResult> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query<any[]>(
        'SELECT wallet_balance, pool_balance FROM power_accounts WHERE user_id = ? FOR UPDATE',
        [userId]
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
        `UPDATE power_accounts
         SET wallet_balance = wallet_balance - ?,
             pool_balance = pool_balance - ?
         WHERE user_id = ?
           AND wallet_balance >= ?
           AND pool_balance >= ?`,
        [walletDeducted, poolDeducted, userId, walletDeducted, poolDeducted]
      );

      if (updateResult.affectedRows === 0) {
        await conn.rollback();
        return { success: false, errorCode: 'CONCURRENT_CONFLICT' };
      }

      await conn.query(
        `INSERT INTO power_ledger
          (user_id, event_type, wallet_delta, pool_delta, task_id, provider_id, power_cost)
         VALUES (?, 'pre_deduct', ?, ?, ?, ?, ?)`,
        [userId, -walletDeducted, -poolDeducted, taskId, providerId, amount]
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

  async refund(userId: number, providerId: string, taskId: string): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [ledgerRows] = await conn.query<any[]>(
        `SELECT wallet_delta, pool_delta, provider_id
         FROM power_ledger
         WHERE user_id = ? AND task_id = ? AND event_type = 'pre_deduct'
         LIMIT 1`,
        [userId, taskId]
      );

      if (!ledgerRows || ledgerRows.length === 0) {
        console.warn(`[PowerManager] refund: 未找到 pre_deduct 记录 (userId=${userId}, providerId=${providerId}, taskId=${taskId})，跳过退款`);
        await conn.rollback();
        return;
      }

      const walletRefund = Math.abs(toNumber(ledgerRows[0].wallet_delta));
      const poolRefund = Math.abs(toNumber(ledgerRows[0].pool_delta));
      const persistedProviderId = ledgerRows[0].provider_id ?? providerId;

      await conn.query(
        `UPDATE power_accounts
         SET wallet_balance = wallet_balance + ?,
             pool_balance = pool_balance + ?
         WHERE user_id = ?`,
        [walletRefund, poolRefund, userId]
      );

      await conn.query(
        `INSERT INTO power_ledger
          (user_id, event_type, wallet_delta, pool_delta, task_id, provider_id, power_cost)
         VALUES (?, 'refund', ?, ?, ?, ?, ?)`,
        [userId, walletRefund, poolRefund, taskId, persistedProviderId, walletRefund + poolRefund]
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
    userId: number,
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
        userId,
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
    userId: number,
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
        userId,
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

  async injectWallet(userId: number, cycleKey: string): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.query<any[]>(
        "SELECT id FROM power_ledger WHERE idempotency_key = ? AND event_type = 'inject' LIMIT 1",
        [cycleKey]
      );
      if (existingRows && existingRows.length > 0) {
        await conn.commit();
        return;
      }

      const [rows] = await conn.query<any[]>(
        'SELECT wallet_injection_per_cycle, cycles_remaining FROM power_accounts WHERE user_id = ? FOR UPDATE',
        [userId]
      );

      if (!rows || rows.length === 0 || toNumber(rows[0].cycles_remaining) === 0) {
        await conn.rollback();
        return;
      }

      const injectionAmount = toNumber(rows[0].wallet_injection_per_cycle);

      await conn.query(
        `UPDATE power_accounts
         SET wallet_balance = wallet_balance + ?,
             cycles_remaining = cycles_remaining - 1
         WHERE user_id = ?`,
        [injectionAmount, userId]
      );

      await conn.query(
        `INSERT INTO power_ledger
          (user_id, event_type, wallet_delta, pool_delta, idempotency_key)
         VALUES (?, 'inject', ?, 0, ?)`,
        [userId, injectionAmount, cycleKey]
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async settleWallet(userId: number, cycleKey: string): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.query<any[]>(
        "SELECT id FROM power_ledger WHERE idempotency_key = ? AND event_type = 'settle' LIMIT 1",
        [cycleKey]
      );
      if (existingRows && existingRows.length > 0) {
        await conn.commit();
        return;
      }

      const [rows] = await conn.query<any[]>(
        'SELECT wallet_balance FROM power_accounts WHERE user_id = ? FOR UPDATE',
        [userId]
      );

      if (!rows || rows.length === 0) {
        await conn.rollback();
        return;
      }

      const walletBalance = toNumber(rows[0].wallet_balance);

      await conn.query(
        `UPDATE power_accounts
         SET pool_balance = pool_balance + wallet_balance,
             wallet_balance = 0
         WHERE user_id = ?`,
        [userId]
      );

      await conn.query(
        `INSERT INTO power_ledger
          (user_id, event_type, wallet_delta, pool_delta, idempotency_key)
         VALUES (?, 'settle', ?, ?, ?)`,
        [userId, -walletBalance, walletBalance, cycleKey]
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async getAccountStatus(userId: number): Promise<PowerAccountStatus | null> {
    const [rows] = await pool.query<any[]>(
      `SELECT wallet_balance, pool_balance, pool_baseline,
              cycles_remaining, cycle_duration, total_duration,
              cycle_started_at, next_cycle_at
       FROM power_accounts
       WHERE user_id = ?`,
      [userId]
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      wallet_balance: toNumber(row.wallet_balance),
      pool_balance: toNumber(row.pool_balance),
      pool_baseline: toNumber(row.pool_baseline),
      cycles_remaining: toNumber(row.cycles_remaining),
      cycle_duration: toNumber(row.cycle_duration),
      total_duration: toNumber(row.total_duration),
      cycle_started_at: row.cycle_started_at ?? null,
      next_cycle_at: row.next_cycle_at ?? null,
    };
  }
}

export const powerManager = new PowerManager();
