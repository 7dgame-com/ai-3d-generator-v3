import type { Response } from 'express';
import {
  getAdminStatusHandler,
  getStatusHandler,
  rechargeHandler,
} from '../controllers/credits';

const mockGetAccountStatus = jest.fn();
const mockRecharge = jest.fn();
const mockScheduleNextCycle = jest.fn();

jest.mock('../services/powerManager', () => ({
  powerManager: {
    getAccountStatus: (...args: unknown[]) => mockGetAccountStatus(...args),
    recharge: (...args: unknown[]) => mockRecharge(...args),
  },
}));

jest.mock('../services/quotaScheduler', () => ({
  scheduleNextCycle: (...args: unknown[]) => mockScheduleNextCycle(...args),
}));

function createResponse() {
  const payload: { body?: unknown } = {};
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn((body: unknown) => {
      payload.body = body;
      return res;
    }),
  } as unknown as Response;

  return { res, payload };
}

describe('credits controller global account endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a single global account status for the current user', async () => {
    mockGetAccountStatus.mockResolvedValue({
      wallet_balance: 300,
      pool_balance: 120,
      pool_baseline: 120,
      cycles_remaining: 6,
      cycle_duration: 1440,
      total_duration: 10080,
      cycle_started_at: '2026-04-10T00:00:00.000Z',
      next_cycle_at: '2026-04-11T00:00:00.000Z',
    });

    const req = {
      user: { userId: 7 },
      query: { provider_id: 'tripo3d' },
    } as unknown as Parameters<typeof getStatusHandler>[0];
    const { res, payload } = createResponse();

    await getStatusHandler(req, res);

    expect(mockGetAccountStatus).toHaveBeenCalledWith(7);
    expect(payload.body).toEqual({
      data: {
        wallet_balance: 300,
        pool_balance: 120,
        pool_baseline: 120,
        cycles_remaining: 6,
        cycle_duration: 1440,
        total_duration: 10080,
        cycle_started_at: '2026-04-10T00:00:00.000Z',
        next_cycle_at: '2026-04-11T00:00:00.000Z',
      },
    });
  });

  it('recharges the global account without provider_id and schedules the next cycle', async () => {
    mockRecharge.mockResolvedValue(undefined);
    mockGetAccountStatus.mockResolvedValue({
      wallet_balance: 300,
      pool_balance: 100,
      pool_baseline: 100,
      cycles_remaining: 5,
      cycle_duration: 1440,
      total_duration: 7200,
      cycle_started_at: '2026-04-10T00:00:00.000Z',
      next_cycle_at: '2026-04-11T00:00:00.000Z',
    });

    const req = {
      body: {
        userId: 8,
        wallet_amount: 300,
        pool_amount: 100,
        total_duration: 7200,
        cycle_duration: 1440,
      },
    } as unknown as Parameters<typeof rechargeHandler>[0];
    const { res, payload } = createResponse();

    await rechargeHandler(req, res);

    expect(mockRecharge).toHaveBeenCalledWith(8, {
      wallet_amount: 300,
      pool_amount: 100,
      total_duration: 7200,
      cycle_duration: 1440,
    });
    expect(mockGetAccountStatus).toHaveBeenCalledWith(8);
    expect(mockScheduleNextCycle).toHaveBeenCalledWith(8, 1440, new Date('2026-04-11T00:00:00.000Z'));
    expect(payload.body).toEqual({ success: true });
  });

  it('returns a single global account status for admin lookup', async () => {
    mockGetAccountStatus.mockResolvedValue({
      wallet_balance: 90,
      pool_balance: 40,
      pool_baseline: 50,
      cycles_remaining: 2,
      cycle_duration: 720,
      total_duration: 1440,
      cycle_started_at: null,
      next_cycle_at: null,
    });

    const req = {
      params: { userId: '12' },
    } as unknown as Parameters<typeof getAdminStatusHandler>[0];
    const { res, payload } = createResponse();

    await getAdminStatusHandler(req, res);

    expect(mockGetAccountStatus).toHaveBeenCalledWith(12);
    expect(payload.body).toEqual({
      data: {
        wallet_balance: 90,
        pool_balance: 40,
        pool_baseline: 50,
        cycles_remaining: 2,
        cycle_duration: 720,
        total_duration: 1440,
        cycle_started_at: null,
        next_cycle_at: null,
      },
    });
  });
});
