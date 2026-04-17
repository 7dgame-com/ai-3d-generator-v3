import express from 'express';
import request from 'supertest';
import { adminRouter } from '../controllers/admin';
import { creditToPower } from '../config/providers';

const mockQuery = jest.fn();
const mockDecrypt = jest.fn();
const mockGetBalance = jest.fn();
const mockGetEnabledIds = jest.fn(() => ['tripo3d', 'hyper3d']);

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/crypto', () => ({
  encrypt: jest.fn(),
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    get: jest.fn(() => ({
      getBalance: (...args: unknown[]) => mockGetBalance(...args),
      validateApiKeyFormat: jest.fn(),
      verifyApiKey: jest.fn(),
    })),
    getEnabledIds: () => mockGetEnabledIds(),
    isEnabled: jest.fn((providerId: string) => mockGetEnabledIds().includes(providerId)),
    getDefaultId: jest.fn(() => mockGetEnabledIds()[0] ?? null),
  },
}));

describe('admin controller power fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEnabledIds.mockReturnValue(['tripo3d', 'hyper3d']);
  });

  it('returns availablePower from GET /admin/balance', async () => {
    const app = express();
    app.use('/admin', adminRouter);

    mockQuery.mockResolvedValueOnce([{ value: 'encrypted:key' }]);
    mockDecrypt.mockReturnValue('real-api-key');
    mockGetBalance.mockResolvedValue({ available: 30, frozen: 0 });

    const response = await request(app).get('/admin/balance').query({ provider_id: 'tripo3d' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      configured: true,
      available: 30,
      availablePower: creditToPower('tripo3d', 30),
      frozen: 0,
    });
  });

  it('falls back to the first enabled provider in GET /admin/balance when provider_id is omitted', async () => {
    const app = express();
    app.use('/admin', adminRouter);

    mockGetEnabledIds.mockReturnValue(['hyper3d']);
    mockQuery.mockResolvedValueOnce([{ value: 'encrypted:key' }]);
    mockDecrypt.mockReturnValue('real-api-key');
    mockGetBalance.mockResolvedValue({ available: 0.5, frozen: 0 });

    const response = await request(app).get('/admin/balance');

    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
      ['hyper3d_api_key']
    );
    expect(response.body).toEqual({
      configured: true,
      available: 0.5,
      availablePower: creditToPower('hyper3d', 0.5),
      frozen: 0,
    });
  });

  it('returns totalPower from GET /admin/usage', async () => {
    const app = express();
    app.use('/admin', adminRouter);

    mockQuery.mockResolvedValueOnce([
      {
        user_id: 7,
        provider_id: 'tripo3d',
        credit_cost: 0,
        power_cost: 0,
        created_at: '2026-04-08T00:00:00.000Z',
      },
      {
        user_id: 8,
        provider_id: 'hyper3d',
        credit_cost: 0.5,
        power_cost: 0,
        created_at: '2026-04-08T01:00:00.000Z',
      },
    ]);

    const response = await request(app).get('/admin/usage');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalCredits: 30.5,
      totalPower: 2,
      userRanking: [
        {
          userId: 7,
          username: 'User 7',
          credits: 30,
          power: 1,
        },
        {
          userId: 8,
          username: 'User 8',
          credits: 0.5,
          power: 1,
        },
      ],
      dailyTrend: [
        {
          date: '2026-04-08',
          credits: 30.5,
          power: 2,
        },
      ],
    });
  });

  it('filters disabled providers out of GET /admin/usage', async () => {
    const app = express();
    app.use('/admin', adminRouter);

    mockGetEnabledIds.mockReturnValue(['tripo3d']);
    mockQuery.mockResolvedValueOnce([
      {
        user_id: 7,
        provider_id: 'tripo3d',
        credit_cost: 0,
        power_cost: 0,
        created_at: '2026-04-08T00:00:00.000Z',
      },
      {
        user_id: 8,
        provider_id: 'hyper3d',
        credit_cost: 0.5,
        power_cost: 0,
        created_at: '2026-04-08T01:00:00.000Z',
      },
    ]);

    const response = await request(app).get('/admin/usage');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalCredits: 30,
      totalPower: 1,
      userRanking: [
        {
          userId: 7,
          username: 'User 7',
          credits: 30,
          power: 1,
        },
      ],
      dailyTrend: [
        {
          date: '2026-04-08',
          credits: 30,
          power: 1,
        },
      ],
    });
  });
});
