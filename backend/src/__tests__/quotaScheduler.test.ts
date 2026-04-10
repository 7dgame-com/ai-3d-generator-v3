/**
 * Unit tests for the unified global quota scheduler.
 */

const mockPoolQuery = jest.fn();
const mockSettleWallet = jest.fn();
const mockInjectWallet = jest.fn();

jest.mock('../db/connection', () => ({
  pool: {
    query: mockPoolQuery,
  },
}));

jest.mock('../services/powerManager', () => ({
  powerManager: {
    settleWallet: mockSettleWallet,
    injectWallet: mockInjectWallet,
  },
}));

import { scheduleNextCycle, startScheduler, stopScheduler } from '../services/quotaScheduler';

async function flushPromises() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

describe('QuotaScheduler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    mockSettleWallet.mockResolvedValue(undefined);
    mockInjectWallet.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopScheduler();
    jest.useRealTimers();
  });

  it('handles startup with no scheduled global accounts gracefully', async () => {
    mockPoolQuery.mockResolvedValueOnce([[]]);

    await expect(startScheduler()).resolves.toBeUndefined();
    expect(mockSettleWallet).not.toHaveBeenCalled();
    expect(mockInjectWallet).not.toHaveBeenCalled();
  });

  it('runs settle then inject for a due power account using a user-global cycle key', async () => {
    const callOrder: string[] = [];
    const dueAt = new Date(Date.now() - 1000);

    mockSettleWallet.mockImplementation(async () => {
      callOrder.push('settle');
    });
    mockInjectWallet.mockImplementation(async () => {
      callOrder.push('inject');
    });

    mockPoolQuery
      .mockResolvedValueOnce([[{ user_id: 7, cycle_duration: 60, next_cycle_at: dueAt }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);

    await startScheduler();
    jest.advanceTimersByTime(0);
    await flushPromises();

    expect(callOrder).toEqual(['settle', 'inject']);
    const cycleKey = `7:${dueAt.toISOString()}`;
    expect(mockSettleWallet).toHaveBeenCalledWith(7, `settle:${cycleKey}`);
    expect(mockInjectWallet).toHaveBeenCalledWith(7, `inject:${cycleKey}`);

    const insertCall = mockPoolQuery.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO power_jobs')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[1]).toEqual([7, cycleKey]);
  });

  it('skips duplicate power_jobs cycle keys silently', async () => {
    const dueAt = new Date(Date.now() - 1000);
    const duplicateError = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });

    mockPoolQuery
      .mockResolvedValueOnce([[{ user_id: 3, cycle_duration: 60, next_cycle_at: dueAt }]])
      .mockRejectedValueOnce(duplicateError);

    await startScheduler();
    jest.advanceTimersByTime(0);
    await flushPromises();

    expect(mockSettleWallet).not.toHaveBeenCalled();
    expect(mockInjectWallet).not.toHaveBeenCalled();
  });

  it('stopScheduler prevents a pending timer from firing', async () => {
    const futureDate = new Date(Date.now() + 10_000);
    mockPoolQuery.mockResolvedValueOnce([[{ user_id: 1, cycle_duration: 60, next_cycle_at: futureDate }]]);

    await startScheduler();
    stopScheduler();

    jest.advanceTimersByTime(15_000);
    await flushPromises();

    expect(mockSettleWallet).not.toHaveBeenCalled();
    expect(mockInjectWallet).not.toHaveBeenCalled();
  });

  it('marks power_jobs as failed and reschedules when a cycle run throws', async () => {
    const dueAt = new Date(Date.now() - 1000);
    mockSettleWallet.mockRejectedValueOnce(new Error('settle error'));

    mockPoolQuery
      .mockResolvedValueOnce([[{ user_id: 9, cycle_duration: 60, next_cycle_at: dueAt }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);

    await startScheduler();
    jest.advanceTimersByTime(0);
    await flushPromises();

    const failedUpdate = mockPoolQuery.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes("UPDATE power_jobs SET status = 'failed'")
    );
    expect(failedUpdate).toBeDefined();
    expect(mockInjectWallet).not.toHaveBeenCalled();
  });

  it('registers a user-global timer when scheduleNextCycle is called directly', async () => {
    const nextCycleAt = new Date(Date.now() + 5000);

    await scheduleNextCycle(15, 60, nextCycleAt);
    jest.advanceTimersByTime(5000);
    await flushPromises();

    expect(mockSettleWallet).toHaveBeenCalledTimes(1);
    expect(mockInjectWallet).toHaveBeenCalledTimes(1);
  });
});
