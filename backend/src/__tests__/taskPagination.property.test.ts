import * as fc from 'fast-check';
import type { Response } from 'express';
import { listTasks } from '../controllers/task';

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

const visibleRows = Array.from({ length: 80 }, (_, index) => ({
  task_id: `task-${index}`,
  provider_id: 'tripo3d',
  provider_status_key: null,
  type: 'text_to_model',
  prompt: `prompt-${index}`,
  status: 'success',
  progress: 100,
  credit_cost: 30,
  power_cost: 1.43,
  file_size: null,
  output_url: 'https://cdn.example.com/model.glb',
  thumbnail_url: null,
  resource_id: null,
  error_message: null,
  created_at: new Date(Date.parse('2026-04-09T00:00:00.000Z') - index * 60_000).toISOString(),
  completed_at: new Date(Date.parse('2026-04-09T00:01:00.000Z') - index * 60_000).toISOString(),
  expires_at: new Date(Date.parse('2026-04-10T00:00:00.000Z') + index * 60_000).toISOString(),
}));

describe('Feature: task-expiry-pagination, Property 4: 分页参数规范化', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsDownloadExpired.mockReset();
    mockIsDownloadExpired.mockReturnValue(false);
  });

  it('normalizes page/pageSize and keeps the response bounded by the effective page size', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -200, max: 200 }),
        fc.integer({ min: -200, max: 200 }),
        async (pageInput, pageSizeInput) => {
          const expectedPage = Math.max(1, pageInput);
          const expectedPageSize = Math.min(50, Math.max(1, pageSizeInput));
          const expectedOffset = (expectedPage - 1) * expectedPageSize;

          mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
            if (sql.includes("status = 'success'") && sql.includes('expires_at IS NULL') && sql.includes('output_url')) {
              expect(params[0]).toBe(1);
              return [];
            }

            if (sql.includes('SELECT task_id')) {
              expect(params[1]).toBe(expectedPageSize);
              expect(params[2]).toBe(expectedOffset);
              return visibleRows.slice(expectedOffset, expectedOffset + expectedPageSize);
            }

            if (sql.includes('COUNT(*) AS total')) {
              return [{ total: visibleRows.length }];
            }

            return [];
          });

          const req = {
            query: { page: String(pageInput), pageSize: String(pageSizeInput) },
            user: { userId: 1 },
          } as unknown as Parameters<typeof listTasks>[0];
          const { res, payload } = createResponse();

          await listTasks(req, res);

          const body = payload.body as { data: unknown[]; total: number; page: number; pageSize: number };
          expect(body.page).toBe(expectedPage);
          expect(body.pageSize).toBe(expectedPageSize);
          expect(body.total).toBe(visibleRows.length);
          expect(body.data.length).toBeLessThanOrEqual(expectedPageSize);
        }
      ),
      { numRuns: 100 }
    );
  });
});
