import type { Response } from 'express';
import { cancelTask, createTask, getTask, listTasks } from '../controllers/task';
import { creditToPower } from '../config/providers';

const mockQuery = jest.fn();
const mockDecrypt = jest.fn();
const mockAddTaskToPoller = jest.fn();
const mockReserve = jest.fn();
const mockRefund = jest.fn();
const mockProviderCreateTask = jest.fn();
const mockIsDownloadExpired = jest.fn();
const mockGetEnabledIds = jest.fn(() => ['tripo3d', 'hyper3d']);
const originalQueueEnabled = process.env.UNIFIED_PROVIDER_QUEUE_ENABLED;
const originalQueueDispatchEnabled = process.env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED;
const originalQueueUserIds = process.env.UNIFIED_PROVIDER_QUEUE_USER_IDS;

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

jest.mock('../services/taskPoller', () => ({
  addTaskToPoller: (...args: unknown[]) => mockAddTaskToPoller(...args),
}));

jest.mock('../services/providerQueue', () => ({
  getQueuePosition: jest.fn().mockResolvedValue(null),
  wakeProviderDispatcher: jest.fn(),
}));

jest.mock('../services/quotaToolRegistry', () => ({
  activeQuotaTool: {
    reserve: (...args: unknown[]) => mockReserve(...args),
    enqueueWithReservation: (...args: unknown[]) => mockReserve(...args),
    refund: (...args: unknown[]) => mockRefund(...args),
  },
}));

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    isEnabled: jest.fn((providerId: string) => mockGetEnabledIds().includes(providerId)),
    getEnabledIds: () => mockGetEnabledIds(),
    getDefaultId: jest.fn(() => mockGetEnabledIds()[0] ?? null),
    get: jest.fn(() => ({
      createTask: (...args: unknown[]) => mockProviderCreateTask(...args),
    })),
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

describe('task controller power fields', () => {
  afterAll(() => {
    if (originalQueueEnabled === undefined) delete process.env.UNIFIED_PROVIDER_QUEUE_ENABLED;
    else process.env.UNIFIED_PROVIDER_QUEUE_ENABLED = originalQueueEnabled;
    if (originalQueueDispatchEnabled === undefined) delete process.env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED;
    else process.env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED = originalQueueDispatchEnabled;
    if (originalQueueUserIds === undefined) delete process.env.UNIFIED_PROVIDER_QUEUE_USER_IDS;
    else process.env.UNIFIED_PROVIDER_QUEUE_USER_IDS = originalQueueUserIds;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    mockGetEnabledIds.mockReturnValue(['tripo3d', 'hyper3d']);
    mockDecrypt.mockReturnValue('real-api-key');
    mockReserve.mockResolvedValue({ success: true, usedPowerAfter: 1, remainingPower: 99 });
    mockRefund.mockResolvedValue(undefined);
    mockProviderCreateTask.mockResolvedValue({ taskId: 'provider-task-001', pollingKey: 'provider-task-001' });
    mockIsDownloadExpired.mockReturnValue(false);
    delete process.env.UNIFIED_PROVIDER_QUEUE_ENABLED;
    delete process.env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED;
    delete process.env.UNIFIED_PROVIDER_QUEUE_USER_IDS;
  });

  it('rejects queue creation before a reservation when a user is outside the rollout', async () => {
    process.env.UNIFIED_PROVIDER_QUEUE_ENABLED = 'canary';
    process.env.UNIFIED_PROVIDER_QUEUE_USER_IDS = '7';
    const req = {
      body: { type: 'text_to_model', prompt: 'chair', provider_id: 'tripo3d' },
      user: { userId: 8 },
    } as unknown as Parameters<typeof createTask>[0];
    const { res, payload } = createResponse();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(payload.body).toEqual(expect.objectContaining({ code: 'UNIFIED_QUEUE_NOT_ENABLED_FOR_USER' }));
    expect(mockReserve).not.toHaveBeenCalled();
  });

  it('rejects new queue creation while rollback pauses dispatch', async () => {
    process.env.UNIFIED_PROVIDER_QUEUE_ENABLED = 'true';
    process.env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED = 'false';
    const req = {
      body: { type: 'text_to_model', prompt: 'chair', provider_id: 'tripo3d' },
      user: { userId: 7 },
    } as unknown as Parameters<typeof createTask>[0];
    const { res, payload } = createResponse();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(payload.body).toEqual(expect.objectContaining({ code: 'UNIFIED_QUEUE_DISPATCH_PAUSED' }));
    expect(mockReserve).not.toHaveBeenCalled();
  });

  it('returns powerCost from GET /tasks', async () => {
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
          credit_cost: 0.5,
          power_cost: 1,
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

    expect(mockQuery.mock.calls[1]?.[0]).toContain('power_cost');
    expect(payload.body).toEqual({
      data: [
        expect.objectContaining({
          taskId: 'task-001',
          creditCost: 0.5,
          powerCost: 1,
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('returns powerCost from GET /tasks/:taskId', async () => {
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

    expect(mockQuery.mock.calls[0]?.[0]).toContain('power_cost');
    expect(payload.body).toEqual(
      expect.objectContaining({
        taskId: 'task-002',
        creditCost: 30,
        powerCost: 1,
      })
    );
  });

  it('converts estimated provider credits to power before pre-deducting', async () => {
    process.env.UNIFIED_PROVIDER_QUEUE_ENABLED = 'true';
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-key' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const req = {
      body: {
        type: 'image_to_model',
        imageBase64: 'data:image/png;base64,AAA',
        mimeType: 'image/png',
        provider_id: 'hyper3d',
      },
      user: { userId: 1 },
    } as unknown as Parameters<typeof createTask>[0];
    const { res } = createResponse();

    await createTask(req, res);

    expect(mockReserve).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      providerId: 'hyper3d',
      reservedPower: creditToPower('hyper3d', 0.5),
      taskId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      userSnapshot: expect.objectContaining({ user_id: 1 }),
    }));
  });

  it('falls back to the first enabled provider when createTask omits provider_id', async () => {
    process.env.UNIFIED_PROVIDER_QUEUE_ENABLED = 'true';
    mockGetEnabledIds.mockReturnValue(['hyper3d']);
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-key' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const req = {
      body: {
        type: 'image_to_model',
        imageBase64: 'data:image/png;base64,AAA',
        mimeType: 'image/png',
      },
      user: { userId: 1 },
    } as unknown as Parameters<typeof createTask>[0];
    const { res } = createResponse();

    await createTask(req, res);

    expect(mockReserve).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      providerId: 'hyper3d',
      reservedPower: creditToPower('hyper3d', 0.5),
      taskId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      userSnapshot: expect.objectContaining({ user_id: 1 }),
    }));
  });

  it('cancels a waiting task idempotently and refunds only once', async () => {
    mockQuery
      .mockResolvedValueOnce([{ provider_id: 'tripo3d', status: 'waiting_provider' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ provider_id: 'tripo3d', status: 'cancelled' }]);

    const req = {
      params: { taskId: 'task-cancel-001' },
      user: { userId: 1 },
    } as unknown as Parameters<typeof cancelTask>[0];
    const first = createResponse();
    const second = createResponse();

    await cancelTask(req, first.res);
    await cancelTask(req, second.res);

    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(first.payload.body).toEqual({ success: true, taskId: 'task-cancel-001', status: 'cancelled' });
    expect(second.payload.body).toEqual({
      success: true,
      taskId: 'task-cancel-001',
      status: 'cancelled',
      alreadyCancelled: true,
    });
  });
});
