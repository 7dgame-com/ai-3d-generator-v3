import * as fc from 'fast-check';
import type { Response } from 'express';
import { getTask, listTasks } from '../controllers/task';

const mockQuery = jest.fn();
const mockIsDownloadExpired = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  pool: {
    getConnection: jest.fn(),
  },
}));

jest.mock('../utils/urlExpiry', () => {
  const actual = jest.requireActual('../utils/urlExpiry');
  return {
    ...actual,
    isDownloadExpired: (...args: unknown[]) => mockIsDownloadExpired(...args),
  };
});

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    getEnabledIds: () => ['tripo3d'],
  },
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

type DbDateValue = Date | string | null;
const validDateArb = fc
  .date({ min: new Date('2025-01-01T00:00:00.000Z'), max: new Date('2030-12-31T23:59:59.000Z') })
  .filter((date) => !Number.isNaN(date.getTime()));

function serializeExpected(value: DbDateValue): string | null {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

const expiresValueArb: fc.Arbitrary<DbDateValue> = fc.oneof(
  fc.constant(null),
  validDateArb,
  validDateArb.map((date) => date.toISOString())
);

describe('Feature: task-expiry-pagination, Property 3: 响应序列化完整性', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsDownloadExpired.mockReset();
    mockIsDownloadExpired.mockReturnValue(false);
  });

  it('serializes expiresAt as ISO 8601 strings or null in both list and detail responses', async () => {
    await fc.assert(
      fc.asyncProperty(expiresValueArb, async (expiresValue: DbDateValue) => {
        const row = {
          task_id: 'task-001',
          provider_id: 'tripo3d',
          provider_status_key: null,
          type: 'text_to_model',
          prompt: 'chair',
          status: 'success',
          progress: 100,
          credit_cost: 30,
          power_cost: 1.43,
          file_size: null,
          output_url: 'https://cdn.example.com/model.glb',
          thumbnail_url: null,
          resource_id: null,
          error_message: null,
          created_at: '2026-04-09T00:00:00.000Z',
          completed_at: '2026-04-09T00:01:00.000Z',
          expires_at: expiresValue,
        };

        mockQuery
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([row])
          .mockResolvedValueOnce([{ total: 1 }])
          .mockResolvedValueOnce([row]);

        const listReq = {
          query: { page: '1', pageSize: '20' },
          user: { userId: 1 },
        } as unknown as Parameters<typeof listTasks>[0];
        const detailReq = {
          params: { taskId: 'task-001' },
          user: { userId: 1 },
        } as unknown as Parameters<typeof getTask>[0];

        const listRes = createResponse();
        const detailRes = createResponse();
        const expectedExpiresAt = serializeExpected(expiresValue);

        await listTasks(listReq, listRes.res);
        await getTask(detailReq, detailRes.res);

        expect((listRes.payload.body as { data: Array<{ expiresAt: string | null }> }).data[0]?.expiresAt).toBe(
          expectedExpiresAt
        );
        expect((detailRes.payload.body as { expiresAt: string | null }).expiresAt).toBe(expectedExpiresAt);
      }),
      { numRuns: 100 }
    );
  });
});
