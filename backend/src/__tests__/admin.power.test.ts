import express from 'express';
import request from 'supertest';
import { adminRouter } from '../controllers/admin';
import { creditToPower } from '../config/providers';

const mockQuery = jest.fn();
const mockDecrypt = jest.fn();
const mockGetBalance = jest.fn();

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
    getEnabledIds: jest.fn(() => ['tripo3d', 'hyper3d']),
  },
}));

describe('admin controller power fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
