import type { Response } from 'express';
import { getUsageHistory, getUsageSummary } from '../controllers/usage';

const mockQuery = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
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

describe('usage controller power fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-10T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns totalPower and monthPower from GET /usage', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          provider_id: 'tripo3d',
          credit_cost: 0,
          power_cost: 0,
          created_at: '2026-04-08T00:00:00.000Z',
        },
        {
          provider_id: 'hyper3d',
          credit_cost: 0.5,
          power_cost: 0,
          created_at: '2026-04-08T10:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([{ task_count: 3 }]);

    const req = { user: { userId: 1 } } as Parameters<typeof getUsageSummary>[0];
    const { res, payload } = createResponse();

    await getUsageSummary(req, res);

    expect(payload.body).toEqual({
      totalCredits: 30.5,
      totalPower: 2,
      monthCredits: 30.5,
      monthPower: 2,
      taskCount: 3,
      dailyTrend: [{ date: '2026-04-08', credits: 30.5, power: 2 }],
    });
  });

  it('returns powerUsed from GET /usage/history', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        task_id: 'task-001',
        provider_id: 'tripo3d',
        type: 'text_to_model',
        prompt: 'chair',
        credit_cost: 0,
        power_cost: 0,
        created_at: '2026-04-08T00:00:00.000Z',
        status: 'success',
      },
    ]);

    const req = {
      user: { userId: 1 },
      query: {},
    } as Parameters<typeof getUsageHistory>[0];
    const { res, payload } = createResponse();

    await getUsageHistory(req, res);

    expect(payload.body).toEqual({
      data: [
        {
          taskId: 'task-001',
          type: 'text_to_model',
          prompt: 'chair',
          creditsUsed: 30,
          powerUsed: 1,
          createdAt: '2026-04-08T00:00:00.000Z',
          status: 'success',
        },
      ],
    });
  });
});
