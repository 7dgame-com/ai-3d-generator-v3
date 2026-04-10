import type { Response } from 'express';
import {
  getAdminSitePowerStatusHandler,
  getStatusHandler,
  rechargeSitePowerHandler,
} from '../controllers/sitePower';

const mockGetAccountStatus = jest.fn();
const mockRecharge = jest.fn();
const mockScheduleNextSiteCycle = jest.fn();

jest.mock('../services/sitePowerManager', () => ({
  sitePowerManager: {
    getAccountStatus: (...args: unknown[]) => mockGetAccountStatus(...args),
    recharge: (...args: unknown[]) => mockRecharge(...args),
  },
}));

jest.mock('../services/siteQuotaScheduler', () => ({
  scheduleNextSiteCycle: (...args: unknown[]) => mockScheduleNextSiteCycle(...args),
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

describe('site power controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the site power status for the shared /credits/status endpoint', async () => {
    mockGetAccountStatus.mockResolvedValue({
      wallet_balance: 120,
      pool_balance: 480,
      pool_baseline: 480,
      cycles_remaining: 6,
      cycle_duration: 1440,
      total_duration: 10080,
      cycle_started_at: null,
      next_cycle_at: null,
    });

    const req = {} as Parameters<typeof getStatusHandler>[0];
    const { res, payload } = createResponse();

    await getStatusHandler(req, res);

    expect(payload.body).toEqual({
      data: {
        wallet_balance: 120,
        pool_balance: 480,
        pool_baseline: 480,
        cycles_remaining: 6,
        cycle_duration: 1440,
        total_duration: 10080,
        cycle_started_at: null,
        next_cycle_at: null,
      },
    });
  });

  it('returns site status from GET /admin/site-power-status', async () => {
    mockGetAccountStatus.mockResolvedValue({
      wallet_balance: 120,
      pool_balance: 480,
      pool_baseline: 480,
      cycles_remaining: 6,
      cycle_duration: 1440,
      total_duration: 10080,
      cycle_started_at: null,
      next_cycle_at: null,
    });

    const req = {} as Parameters<typeof getAdminSitePowerStatusHandler>[0];
    const { res, payload } = createResponse();

    await getAdminSitePowerStatusHandler(req, res);

    expect(payload.body).toEqual({
      data: expect.objectContaining({ wallet_balance: 120, pool_balance: 480 }),
    });
  });

  it('posts compatibility recharge without requiring userId and schedules the next site cycle', async () => {
    mockRecharge.mockResolvedValue(undefined);
    mockGetAccountStatus.mockResolvedValue({
      wallet_balance: 0,
      pool_balance: 720,
      pool_baseline: 720,
      cycles_remaining: 7,
      cycle_duration: 1440,
      total_duration: 10080,
      cycle_started_at: '2026-04-10T00:00:00.000Z',
      next_cycle_at: '2026-04-11T00:00:00.000Z',
    });

    const req = {
      body: {
        total_power: 1200,
        wallet_percent: 40,
        pool_percent: 60,
        wallet_amount: 480,
        pool_amount: 720,
        total_duration: 10080,
        cycle_duration: 1440,
      },
    } as unknown as Parameters<typeof rechargeSitePowerHandler>[0];
    const { res, payload } = createResponse();

    await rechargeSitePowerHandler(req, res);

    expect(mockRecharge).toHaveBeenCalledWith({
      total_power: 1200,
      wallet_percent: 40,
      pool_percent: 60,
      wallet_amount: 480,
      pool_amount: 720,
      total_duration: 10080,
      cycle_duration: 1440,
    });
    expect(mockScheduleNextSiteCycle).toHaveBeenCalledWith(
      1440,
      new Date('2026-04-11T00:00:00.000Z')
    );
    expect(payload.body).toEqual({
      success: true,
      data: expect.objectContaining({ pool_balance: 720 }),
    });
  });
});
