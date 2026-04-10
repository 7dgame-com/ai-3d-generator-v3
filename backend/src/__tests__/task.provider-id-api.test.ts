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

describe('Feature: hyper3d-gen2-upgrade, task controller providerId fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDownloadExpired.mockReturnValue(false);
  });

  it('returns providerId from GET /tasks', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          task_id: 'task-001',
          provider_id: 'hyper3d',
          provider_status_key: null,
          type: 'text_to_model',
          prompt: 'chair',
          status: 'success',
          progress: 100,
          credit_cost: 30,
          power_cost: 1,
          file_size: null,
          output_url: 'https://cdn.example.com/model.glb',
          thumbnail_url: null,
          resource_id: null,
          error_message: null,
          created_at: '2026-04-08T00:00:00.000Z',
          completed_at: '2026-04-08T00:01:00.000Z',
          expires_at: '2026-04-10T00:01:00.000Z',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const req = {
      query: {},
      user: { userId: 1 },
    } as unknown as Parameters<typeof listTasks>[0];
    const { res, payload } = createResponse();

    await listTasks(req, res);

    expect(mockQuery.mock.calls[1]?.[0]).toContain('provider_id');
    expect(payload.body).toEqual({
      data: [
        expect.objectContaining({
          taskId: 'task-001',
          providerId: 'hyper3d',
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('returns providerId from GET /tasks/:taskId', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        task_id: 'task-002',
        provider_id: 'tripo3d',
        provider_status_key: null,
        type: 'image_to_model',
        prompt: null,
        status: 'processing',
        progress: 50,
        credit_cost: 30,
        power_cost: 1,
        file_size: null,
        output_url: null,
        thumbnail_url: null,
        resource_id: null,
        error_message: null,
        created_at: '2026-04-08T00:00:00.000Z',
        completed_at: null,
        expires_at: null,
      },
    ]);

    const req = {
      params: { taskId: 'task-002' },
      user: { userId: 1 },
    } as unknown as Parameters<typeof getTask>[0];
    const { res, payload } = createResponse();

    await getTask(req, res);

    expect(mockQuery.mock.calls[0]?.[0]).toContain('provider_id');
    expect(payload.body).toEqual(
      expect.objectContaining({
        taskId: 'task-002',
        providerId: 'tripo3d',
      })
    );
  });
});
