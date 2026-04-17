import type { Response } from 'express';
import { createTask, getTask, listTasks } from '../controllers/task';
import { creditToPower } from '../config/providers';

const mockQuery = jest.fn();
const mockPoolGetConnection = jest.fn();
const mockDecrypt = jest.fn();
const mockAddTaskToPoller = jest.fn();
const mockPreDeduct = jest.fn();
const mockSleep = jest.fn();
const mockComputeThrottleDelay = jest.fn();
const mockProviderCreateTask = jest.fn();
const mockIsDownloadExpired = jest.fn();
const mockGetEnabledIds = jest.fn(() => ['tripo3d', 'hyper3d']);

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  pool: {
    getConnection: (...args: unknown[]) => mockPoolGetConnection(...args),
  },
}));

jest.mock('../services/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

jest.mock('../services/taskPoller', () => ({
  addTaskToPoller: (...args: unknown[]) => mockAddTaskToPoller(...args),
}));

jest.mock('../services/creditManager', () => ({
  computeThrottleDelay: (...args: unknown[]) => mockComputeThrottleDelay(...args),
  sleep: (...args: unknown[]) => mockSleep(...args),
}));

jest.mock('../services/sitePowerManager', () => ({
  sitePowerManager: {
    preDeduct: (...args: unknown[]) => mockPreDeduct(...args),
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

function createLockedAccountConnection(row: Record<string, unknown>) {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    query: jest.fn().mockResolvedValue([[row]]),
  };
}

describe('task controller power fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEnabledIds.mockReturnValue(['tripo3d', 'hyper3d']);
    mockDecrypt.mockReturnValue('real-api-key');
    mockComputeThrottleDelay.mockReturnValue(0);
    mockSleep.mockResolvedValue(undefined);
    mockPreDeduct.mockResolvedValue({ success: true, walletDeducted: 1, poolDeducted: 0 });
    mockProviderCreateTask.mockResolvedValue({ taskId: 'provider-task-001', pollingKey: 'provider-task-001' });
    mockIsDownloadExpired.mockReturnValue(false);
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
    const lockedConn = createLockedAccountConnection({
      wallet_balance: '2.00',
      pool_balance: '0.00',
      pool_baseline: '0.00',
      next_cycle_at: null,
    });
    mockPoolGetConnection.mockResolvedValue(lockedConn);
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-key' }])
      .mockResolvedValueOnce([{ value: '30000' }])
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

    expect(mockPreDeduct).toHaveBeenCalledWith(
      'hyper3d',
      creditToPower('hyper3d', 0.5),
      expect.stringMatching(/^temp:1:/)
    );
    expect(lockedConn.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM site_power_accounts'),
      []
    );
  });

  it('falls back to the first enabled provider when createTask omits provider_id', async () => {
    mockGetEnabledIds.mockReturnValue(['hyper3d']);
    const lockedConn = createLockedAccountConnection({
      wallet_balance: '2.00',
      pool_balance: '0.00',
      pool_baseline: '0.00',
      next_cycle_at: null,
    });
    mockPoolGetConnection.mockResolvedValue(lockedConn);
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-key' }])
      .mockResolvedValueOnce([{ value: '30000' }])
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

    expect(mockPreDeduct).toHaveBeenCalledWith(
      'hyper3d',
      creditToPower('hyper3d', 0.5),
      expect.stringMatching(/^temp:1:/)
    );
  });
});
