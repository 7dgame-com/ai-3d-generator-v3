import type { RowDataPacket } from 'mysql2/promise';
import {
  PowerManager,
  computeThrottleDelay,
  powerManager,
  sleep,
  type ConfirmDeductResult,
  type DeductResult,
  type PowerAccountStatus,
  type RechargeParams,
} from './powerManager';
import { pool } from '../db/connection';

export type ProviderCreditStatus = PowerAccountStatus & { provider_id: string };
export type CreditStatus = ProviderCreditStatus[];

interface ProviderCreditStatusRow extends RowDataPacket {
  provider_id: string;
  wallet_balance: string | number;
  pool_balance: string | number;
  pool_baseline: string | number;
  cycles_remaining: string | number;
  cycle_duration?: string | number | null;
  total_duration?: string | number | null;
  cycle_started_at: Date | null;
  next_cycle_at: Date | null;
}

export { computeThrottleDelay, sleep };
export type { ConfirmDeductResult, DeductResult, RechargeParams };

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function mapProviderStatus(row: ProviderCreditStatusRow): ProviderCreditStatus {
  return {
    provider_id: String(row.provider_id),
    wallet_balance: toNumber(row.wallet_balance),
    pool_balance: toNumber(row.pool_balance),
    pool_baseline: toNumber(row.pool_baseline),
    cycles_remaining: toNumber(row.cycles_remaining),
    cycle_duration: toNumber(row.cycle_duration),
    total_duration: toNumber(row.total_duration),
    cycle_started_at: (row.cycle_started_at as Date | null | undefined) ?? null,
    next_cycle_at: (row.next_cycle_at as Date | null | undefined) ?? null,
  };
}

function zeroProviderCreditStatus(providerId: string): ProviderCreditStatus {
  return {
    provider_id: providerId,
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

export class CreditManager extends PowerManager {
  async recharge(
    userId: number,
    providerIdOrParams: string | RechargeParams,
    maybeParams?: RechargeParams
  ): Promise<void> {
    const params = typeof providerIdOrParams === 'string' ? maybeParams : providerIdOrParams;
    if (!params) {
      throw new Error('Missing recharge params');
    }
    return super.recharge(userId, params);
  }

  async injectWallet(
    userId: number,
    providerIdOrCycleKey: string,
    maybeCycleKey?: string
  ): Promise<void> {
    return super.injectWallet(userId, maybeCycleKey ?? providerIdOrCycleKey);
  }

  async settleWallet(
    userId: number,
    providerIdOrCycleKey: string,
    maybeCycleKey?: string
  ): Promise<void> {
    return super.settleWallet(userId, maybeCycleKey ?? providerIdOrCycleKey);
  }

  async getStatus(userId: number, providerId?: string): Promise<ProviderCreditStatus[]> {
    const whereProvider = providerId ? ' AND provider_id = ?' : '';
    const params = providerId ? [userId, providerId] : [userId];
    const [rows] = await pool.query<ProviderCreditStatusRow[]>(
      `SELECT provider_id, wallet_balance, pool_balance, pool_baseline,
              cycles_remaining, cycle_duration, total_duration,
              cycle_started_at, next_cycle_at
       FROM user_accounts
       WHERE user_id = ?${whereProvider}`,
      params
    );

    if (!rows || rows.length === 0) {
      return providerId ? [zeroProviderCreditStatus(providerId)] : [];
    }

    return rows.map(mapProviderStatus);
  }
}

export const creditManager = new CreditManager();
export const compatPowerManager = powerManager;
