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

describe('Feature: task-expiry-pagination, task controller', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsDownloadExpired.mockReset();
    mockIsDownloadExpired.mockReturnValue(false);
  });

  it('filters expired success tasks in SQL and returns expiresAt in paginated task lists', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
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
          created_at: '2026-04-09T09:00:00.000Z',
          completed_at: '2026-04-09T09:01:00.000Z',
          expires_at: '2026-04-10T09:01:00.000Z',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const req = {
      query: { page: '0', pageSize: '999' },
      user: { userId: 7 },
    } as unknown as Parameters<typeof listTasks>[0];
    const { res, payload } = createResponse();

    await listTasks(req, res);

    expect(mockQuery.mock.calls[0]?.[0]).toContain("status = 'success'");
    expect(mockQuery.mock.calls[0]?.[0]).toContain('expires_at IS NULL');
    expect(mockQuery.mock.calls[1]?.[0]).toContain('expires_at');
    expect(mockQuery.mock.calls[1]?.[0]).toContain("status != 'success'");
    expect(mockQuery.mock.calls[2]?.[0]).toContain('COUNT(*) AS total');
    expect(mockQuery.mock.calls[2]?.[0]).toContain("status != 'success'");
    expect(payload.body).toEqual({
      data: [
        expect.objectContaining({
          taskId: 'task-001',
          expiresAt: '2026-04-10T09:01:00.000Z',
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
  });

  it('hides legacy success tasks when expires_at is missing and completed_at is older than 24 hours', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);

    const req = {
      query: { page: '1', pageSize: '20' },
      user: { userId: 7 },
    } as unknown as Parameters<typeof listTasks>[0];
    const { res, payload } = createResponse();

    await listTasks(req, res);

    expect(mockQuery.mock.calls[1]?.[0]).toContain("completed_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)");
    expect(mockQuery.mock.calls[2]?.[0]).toContain("completed_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)");
    expect(payload.body).toEqual({
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it('backfills expires_at from the signed URL before filtering legacy success tasks', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          task_id: 'task-url-expired',
          output_url: 'https://cdn.example.com/model.glb?X-Amz-Date=20260409T180100Z&X-Amz-Expires=3600',
          thumbnail_url: null,
          completed_at: '2026-04-09T18:01:00.000Z',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);

    const req = {
      query: { page: '1', pageSize: '20' },
      user: { userId: 7 },
    } as unknown as Parameters<typeof listTasks>[0];
    const { res, payload } = createResponse();

    await listTasks(req, res);

    expect(mockQuery.mock.calls[0]?.[0]).toContain("status = 'success'");
    expect(mockQuery.mock.calls[0]?.[0]).toContain('expires_at IS NULL');
    expect(mockQuery.mock.calls[1]).toEqual([
      'UPDATE tasks SET expires_at = ? WHERE task_id = ? AND user_id = ? AND expires_at IS NULL',
      ['2026-04-09 19:01:00', 'task-url-expired', 7],
    ]);
    expect(payload.body).toEqual({
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it('returns expiresAt from GET /tasks/:taskId', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        task_id: 'task-002',
        provider_id: 'tripo3d',
        provider_status_key: null,
        type: 'image_to_model',
        prompt: null,
        status: 'success',
        progress: 100,
        credit_cost: 30,
        power_cost: 1.43,
        file_size: null,
        output_url: 'https://cdn.example.com/model.glb',
        thumbnail_url: null,
        resource_id: null,
        error_message: null,
        created_at: '2026-04-09T09:00:00.000Z',
        completed_at: '2026-04-09T09:01:00.000Z',
        expires_at: '2026-04-10T09:01:00.000Z',
      },
    ]);

    const req = {
      params: { taskId: 'task-002' },
      user: { userId: 7 },
    } as unknown as Parameters<typeof getTask>[0];
    const { res, payload } = createResponse();

    await getTask(req, res);

    expect(mockQuery.mock.calls[0]?.[0]).toContain('expires_at');
    expect(payload.body).toEqual(
      expect.objectContaining({
        taskId: 'task-002',
        expiresAt: '2026-04-10T09:01:00.000Z',
      })
    );
  });
});
