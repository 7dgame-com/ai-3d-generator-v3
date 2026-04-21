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

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    getEnabledIds: () => ['tripo3d'],
  },
}));

const NOW_MS = Date.parse('2026-04-09T00:00:00.000Z');
const LEGACY_SUCCESS_VISIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000;

type TaskStatus = 'queued' | 'processing' | 'success' | 'failed' | 'timeout';

interface MockTaskRow {
  task_id: string;
  provider_id: string;
  provider_status_key: string | null;
  type: 'text_to_model';
  prompt: string | null;
  status: TaskStatus;
  progress: number;
  credit_cost: number;
  power_cost: number;
  file_size: number | null;
  output_url: string | null;
  thumbnail_url: string | null;
  resource_id: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

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

function buildTaskRow(sample: {
  createdAtMs: number;
  status: TaskStatus;
  expiresKind: 'past' | 'future' | 'none';
}): MockTaskRow {
  const createdAt = new Date(sample.createdAtMs).toISOString();
  const completedAt = sample.status === 'queued' || sample.status === 'processing'
    ? null
    : new Date(sample.createdAtMs + 60_000).toISOString();

  let expiresAt: string | null = null;
  if (sample.expiresKind === 'past') {
    expiresAt = new Date(NOW_MS - 60_000).toISOString();
  } else if (sample.expiresKind === 'future') {
    expiresAt = new Date(NOW_MS + 60_000).toISOString();
  }

  return {
    task_id: `task-${sample.createdAtMs}`,
    provider_id: 'tripo3d',
    provider_status_key: null,
    type: 'text_to_model',
    prompt: 'prompt',
    status: sample.status,
    progress: sample.status === 'success' ? 100 : 50,
    credit_cost: 30,
    power_cost: 1.43,
    file_size: null,
    output_url: sample.status === 'success' ? 'https://cdn.example.com/model.glb' : null,
    thumbnail_url: null,
    resource_id: null,
    error_message: null,
    created_at: createdAt,
    completed_at: completedAt,
    expires_at: expiresAt,
  };
}

function shouldIncludeTask(row: MockTaskRow): boolean {
  if (row.status !== 'success') {
    return true;
  }

  if (row.expires_at !== null) {
    return Date.parse(row.expires_at) > NOW_MS;
  }

  if (row.completed_at === null) {
    return true;
  }

  return Date.parse(row.completed_at) > NOW_MS - LEGACY_SUCCESS_VISIBILITY_WINDOW_MS;
}

function sortByCreatedAtDesc(rows: MockTaskRow[]): MockTaskRow[] {
  return [...rows].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

const taskRowsArb = fc
  .uniqueArray(
    fc.record({
      createdAtMs: fc.integer({
        min: Date.parse('2025-01-01T00:00:00.000Z'),
        max: Date.parse('2030-12-31T23:59:59.000Z'),
      }),
      status: fc.constantFrom<TaskStatus>('queued', 'processing', 'success', 'failed', 'timeout'),
      expiresKind: fc.constantFrom<'past' | 'future' | 'none'>('past', 'future', 'none'),
    }),
    { minLength: 1, maxLength: 20, selector: (item) => item.createdAtMs }
  )
  .map((items) => items.map(buildTaskRow));

describe('Feature: task-expiry-pagination, Property 2: 列表过期过滤正确性', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsDownloadExpired.mockReset();
    mockIsDownloadExpired.mockReturnValue(false);
  });

  it('returns exactly the visible tasks under the success-expiry rule', async () => {
    await fc.assert(
      fc.asyncProperty(taskRowsArb, async (rows) => {
        const visibleRows = sortByCreatedAtDesc(rows.filter(shouldIncludeTask));

        mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
          if (sql.includes("status = 'success'") && sql.includes('expires_at IS NULL') && sql.includes('output_url')) {
            return [];
          }

          if (sql.includes('SELECT task_id')) {
            expect(sql).toContain("status != 'success'");
            expect(sql).toContain('expires_at > NOW()');
            expect(sql).toContain("completed_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)");
            expect(sql).toContain('ORDER BY created_at DESC');

            const pageSize = params[params.length - 2] as number;
            const offset = params[params.length - 1] as number;
            return visibleRows.slice(offset, offset + pageSize);
          }

          if (sql.includes('COUNT(*) AS total')) {
            expect(sql).toContain("status != 'success'");
            expect(sql).toContain('expires_at > NOW()');
            expect(sql).toContain("completed_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)");
            return [{ total: visibleRows.length }];
          }

          return [];
        });

        const req = {
          query: { page: '1', pageSize: '50' },
          user: { userId: 1 },
        } as unknown as Parameters<typeof listTasks>[0];
        const { res, payload } = createResponse();

        await listTasks(req, res);

        expect((payload.body as { data: Array<{ taskId: string }> }).data.map((task) => task.taskId)).toEqual(
          visibleRows.map((row) => row.task_id)
        );
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: task-expiry-pagination, Property 6: 列表排序正确性', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsDownloadExpired.mockReset();
    mockIsDownloadExpired.mockReturnValue(false);
  });

  it('preserves the descending createdAt order from the SQL-ordered result set', async () => {
    await fc.assert(
      fc.asyncProperty(taskRowsArb, async (rows) => {
        const visibleRows = sortByCreatedAtDesc(rows.filter(shouldIncludeTask));

        mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
          if (sql.includes("status = 'success'") && sql.includes('expires_at IS NULL') && sql.includes('output_url')) {
            return [];
          }

          if (sql.includes('SELECT task_id')) {
            expect(sql).toContain('ORDER BY created_at DESC');
            const pageSize = params[params.length - 2] as number;
            const offset = params[params.length - 1] as number;
            return visibleRows.slice(offset, offset + pageSize);
          }

          if (sql.includes('COUNT(*) AS total')) {
            return [{ total: visibleRows.length }];
          }

          return [];
        });

        const req = {
          query: { page: '1', pageSize: '50' },
          user: { userId: 1 },
        } as unknown as Parameters<typeof listTasks>[0];
        const { res, payload } = createResponse();

        await listTasks(req, res);

        const createdAtValues = (payload.body as { data: Array<{ createdAt: string }> }).data.map((task) =>
          Date.parse(task.createdAt)
        );
        const expectedValues = visibleRows.map((row) => Date.parse(row.created_at));

        expect(createdAtValues).toEqual(expectedValues);
      }),
      { numRuns: 100 }
    );
  });
});
