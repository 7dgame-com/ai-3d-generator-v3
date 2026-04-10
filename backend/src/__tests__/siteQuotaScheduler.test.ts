const mockPoolQuery = jest.fn();
const mockSettleWallet = jest.fn();
const mockInjectWallet = jest.fn();

jest.mock('../db/connection', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
}));

jest.mock('../services/sitePowerManager', () => ({
  sitePowerManager: {
    settleWallet: (...args: unknown[]) => mockSettleWallet(...args),
    injectWallet: (...args: unknown[]) => mockInjectWallet(...args),
  },
}));

import {
  scheduleNextSiteCycle,
  startSiteScheduler,
  stopSiteScheduler,
} from '../services/siteQuotaScheduler';

async function flushPromises() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

describe('site quota scheduler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    mockSettleWallet.mockResolvedValue(undefined);
    mockInjectWallet.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopSiteScheduler();
    jest.useRealTimers();
  });

  it('starts from site_power_accounts.next_cycle_at', async () => {
    const dueAt = new Date('2026-04-10T00:00:00.000Z');
    mockPoolQuery.mockResolvedValueOnce([[{ id: 1, cycle_duration: 1440, next_cycle_at: dueAt }]]);

    await startSiteScheduler();

    expect(mockPoolQuery).toHaveBeenCalledWith(
      'SELECT id, cycle_duration, next_cycle_at FROM site_power_accounts WHERE next_cycle_at IS NOT NULL'
    );
  });

  it('writes site_power_jobs cycle rows and reschedules the site timer', async () => {
    const dueAt = new Date(Date.now() - 1000);

    mockPoolQuery
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);

    await scheduleNextSiteCycle(1440, dueAt);
    jest.advanceTimersByTime(0);
    await flushPromises();

    const cycleKey = `site:${dueAt.toISOString()}`;
    expect(mockPoolQuery).toHaveBeenCalledWith(
      "INSERT INTO site_power_jobs (job_type, cycle_key, status) VALUES ('inject', ?, 'pending')",
      [cycleKey]
    );
    expect(mockSettleWallet).toHaveBeenCalledWith(`settle:${cycleKey}`);
    expect(mockInjectWallet).toHaveBeenCalledWith(`inject:${cycleKey}`);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      "UPDATE site_power_jobs SET status = 'done', executed_at = NOW() WHERE cycle_key = ?",
      [cycleKey]
    );
  });
});
