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

export type ProviderCreditStatus = PowerAccountStatus;
export type CreditStatus = ProviderCreditStatus[];

export { computeThrottleDelay, sleep };
export type { ConfirmDeductResult, DeductResult, RechargeParams };

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

  async getStatus(userId: number, _providerId?: string): Promise<ProviderCreditStatus[]> {
    const status = await super.getAccountStatus(userId);
    return status ? [status] : [];
  }
}

export const creditManager = new CreditManager();
export const compatPowerManager = powerManager;
