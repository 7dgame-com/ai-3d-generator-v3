import type { Response } from 'express';
import { completeTask, failTask, registerTask } from '../controllers/directTask';
import { creditToPower } from '../config/providers';

const mockQuery = jest.fn();
const mockDecrypt = jest.fn();
const mockVerifyPrepareToken = jest.fn();
const mockFinalizeTaskSuccess = jest.fn();
const mockRefund = jest.fn();
const mockComputeExpiresAt = jest.fn();
const mockAddTaskToPoller = jest.fn();
const mockProviderGetTaskStatus = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  pool: {
    getConnection: jest.fn(),
  },
}));

jest.mock('../services/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

jest.mock('../services/prepareToken', () => ({
  verifyPrepareToken: (...args: unknown[]) => mockVerifyPrepareToken(...args),
  signPrepareToken: jest.fn(),
}));

jest.mock('../services/sitePowerManager', () => ({
  sitePowerManager: {
    preDeduct: jest.fn(),
    finalizeTaskSuccess: (...args: unknown[]) => mockFinalizeTaskSuccess(...args),
    refund: (...args: unknown[]) => mockRefund(...args),
  },
}));

jest.mock('../utils/urlExpiry', () => ({
  computeExpiresAt: (...args: unknown[]) => mockComputeExpiresAt(...args),
}));

jest.mock('../services/taskPoller', () => ({
  addTaskToPoller: (...args: unknown[]) => mockAddTaskToPoller(...args),
}));

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    get: jest.fn(() => ({
      getTaskStatus: (...args: unknown[]) => mockProviderGetTaskStatus(...args),
    })),
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
    set: jest.fn().mockReturnThis(),
  } as unknown as Response;

  return { res, payload };
}

describe('directTask callbacks', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockDecrypt.mockReset();
    mockVerifyPrepareToken.mockReset();
    mockFinalizeTaskSuccess.mockReset();
    mockRefund.mockReset();
    mockComputeExpiresAt.mockReset();
    mockAddTaskToPoller.mockReset();
    mockProviderGetTaskStatus.mockReset();
    mockVerifyPrepareToken.mockReturnValue({
      userId: 5,
      providerId: 'tripo3d',
      tempTaskId: 'temp:5:1710000000000',
      estimatedPower: 1.43,
      iat: 1,
      exp: 2,
    });
    mockFinalizeTaskSuccess.mockResolvedValue({
      billingStatus: 'settled',
      billingMessage: null,
      shortfallAmount: 0,
    });
    mockDecrypt.mockReturnValue('real-api-key');
    mockRefund.mockResolvedValue(undefined);
    mockComputeExpiresAt.mockReturnValue(new Date('2026-04-10T10:00:00.000Z'));
  });

  it('registers the provider task and migrates the pre-deduct ledger task id', async () => {
    mockQuery
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const req = {
      body: {
        prepareToken: 'prepare-token',
        taskId: 'provider-task-001',
        type: 'text_to_model',
        prompt: 'a castle',
        pollingKey: 'poll-key-001',
      },
      user: { userId: 5 },
    } as unknown as Parameters<typeof registerTask>[0];
    const { res, payload } = createResponse();

    await registerTask(req, res);

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO tasks'),
      ['provider-task-001', 'direct:poll-key-001', 5, 'tripo3d', 'text_to_model', 'a castle']
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE site_power_ledger SET task_id = ?"),
      ['provider-task-001', 'temp:5:1710000000000', 'tripo3d']
    );
    expect(mockAddTaskToPoller).toHaveBeenCalledWith('provider-task-001');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.body).toEqual({ success: true });
  });

  it('rejects registerTask when prepare token verification fails', async () => {
    mockVerifyPrepareToken.mockImplementation(() => {
      throw Object.assign(new Error('prepareToken 无效'), {
        code: 'INVALID_PREPARE_TOKEN',
        status: 401,
      });
    });

    const req = {
      body: {
        prepareToken: 'bad-token',
        taskId: 'provider-task-001',
        type: 'text_to_model',
      },
      user: { userId: 5 },
    } as unknown as Parameters<typeof registerTask>[0];
    const { res, payload } = createResponse();

    await registerTask(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(payload.body).toEqual({
      code: 'INVALID_PREPARE_TOKEN',
      message: 'prepareToken 无效',
    });
  });

  it('rejects completeTask when the task does not exist', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const req = {
      params: { taskId: 'missing-task' },
      body: {
        prepareToken: 'prepare-token',
        outputUrl: 'https://cdn.example.com/model.glb',
        thumbnailUrl: 'https://cdn.example.com/thumb.png',
        creditCost: 30,
      },
      user: { userId: 5 },
    } as unknown as Parameters<typeof completeTask>[0];
    const { res, payload } = createResponse();

    await completeTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(payload.body).toEqual({
      code: 'TASK_NOT_FOUND',
      message: '任务不存在',
    });
  });

  it('rejects completeTask when the authenticated user does not own the task', async () => {
    mockQuery.mockResolvedValueOnce([
      { task_id: 'provider-task-001', user_id: 77, provider_id: 'tripo3d', status: 'queued', error_message: null },
    ]);

    const req = {
      params: { taskId: 'provider-task-001' },
      body: {
        prepareToken: 'prepare-token',
        outputUrl: 'https://cdn.example.com/model.glb',
        creditCost: 30,
      },
      user: { userId: 5 },
    } as unknown as Parameters<typeof completeTask>[0];
    const { res, payload } = createResponse();

    await completeTask(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(payload.body).toEqual({
      code: 'TASK_OWNER_MISMATCH',
      message: '没有权限操作该任务',
    });
  });

  it('returns idempotent success when completeTask is called on an already successful task', async () => {
    mockQuery.mockResolvedValueOnce([
      { task_id: 'provider-task-001', user_id: 5, provider_id: 'tripo3d', status: 'success', error_message: null },
    ]);

    const req = {
      params: { taskId: 'provider-task-001' },
      body: {
        prepareToken: 'prepare-token',
        outputUrl: 'https://cdn.example.com/model.glb',
        creditCost: 30,
      },
      user: { userId: 5 },
    } as unknown as Parameters<typeof completeTask>[0];
    const { res, payload } = createResponse();

    await completeTask(req, res);

    expect(mockFinalizeTaskSuccess).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.body).toEqual({
      success: true,
      billingStatus: 'settled',
    });
  });

  it('finalizes billing for completeTask using provider credit-to-power conversion', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          task_id: 'provider-task-001',
          user_id: 5,
          provider_id: 'tripo3d',
          provider_status_key: 'direct:poll-key-001',
          status: 'processing',
          error_message: null,
        },
      ])
      .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
      .mockResolvedValueOnce({ affectedRows: 1 });
    mockProviderGetTaskStatus.mockResolvedValue({
      status: 'success',
      progress: 100,
      creditCost: 30,
      outputUrl: 'https://provider.example.com/model.glb',
      thumbnailUrl: 'https://provider.example.com/thumb.png',
    });

    const req = {
      params: { taskId: 'provider-task-001' },
      body: {
        prepareToken: 'prepare-token',
        outputUrl: 'https://client.example.com/model.glb',
        thumbnailUrl: 'https://client.example.com/thumb.png',
        creditCost: 0,
      },
      user: { userId: 5 },
    } as unknown as Parameters<typeof completeTask>[0];
    const { res, payload } = createResponse();

    await completeTask(req, res);

    expect(mockFinalizeTaskSuccess).toHaveBeenCalledWith(
      'tripo3d',
      'provider-task-001',
      'https://provider.example.com/model.glb',
      creditToPower('tripo3d', 30),
      30,
      'https://provider.example.com/thumb.png'
    );
    expect(mockComputeExpiresAt).toHaveBeenCalledWith(
      'https://provider.example.com/model.glb',
      'https://provider.example.com/thumb.png',
      expect.any(Date)
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE tasks SET expires_at = ?'),
      ['2026-04-10 10:00:00', 'provider-task-001']
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.body).toEqual({
      success: true,
      billingStatus: 'settled',
      billingMessage: undefined,
    });
  });

  it('falls back to the provider default credit cost when provider verification omits cost', async () => {
    mockVerifyPrepareToken.mockReturnValue({
      userId: 5,
      providerId: 'hyper3d',
      tempTaskId: 'temp:5:1710000000000',
      estimatedPower: 0.96,
      iat: 1,
      exp: 2,
    });
    mockQuery
      .mockResolvedValueOnce([
        {
          task_id: 'provider-task-001',
          user_id: 5,
          provider_id: 'hyper3d',
          provider_status_key: 'direct:poll-key-002',
          status: 'processing',
          error_message: null,
        },
      ])
      .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
      .mockResolvedValueOnce({ affectedRows: 1 });
    mockProviderGetTaskStatus.mockResolvedValue({
      status: 'success',
      progress: 100,
      outputUrl: 'https://provider.example.com/model.glb',
    });

    const req = {
      params: { taskId: 'provider-task-001' },
      body: {
        prepareToken: 'prepare-token',
        outputUrl: 'https://client.example.com/model.glb',
        creditCost: 999,
      },
      user: { userId: 5 },
    } as unknown as Parameters<typeof completeTask>[0];
    const { res } = createResponse();

    await completeTask(req, res);

    expect(mockFinalizeTaskSuccess).toHaveBeenCalledWith(
      'hyper3d',
      'provider-task-001',
      'https://provider.example.com/model.glb',
      creditToPower('hyper3d', 0.5),
      0.5,
      undefined
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('refunds and marks the task failed when failTask succeeds', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { task_id: 'provider-task-001', user_id: 5, provider_id: 'tripo3d', status: 'processing', error_message: null },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const req = {
      params: { taskId: 'provider-task-001' },
      body: {
        prepareToken: 'prepare-token',
        errorMessage: 'provider failed',
      },
      user: { userId: 5 },
    } as unknown as Parameters<typeof failTask>[0];
    const { res, payload } = createResponse();

    await failTask(req, res);

    expect(mockRefund).toHaveBeenCalledWith('tripo3d', 'provider-task-001');
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE tasks SET status = 'failed'"),
      ['provider failed', 'provider-task-001']
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.body).toEqual({ success: true });
  });

  it('returns idempotent success when failTask is called on an already failed task', async () => {
    mockQuery.mockResolvedValueOnce([
      { task_id: 'provider-task-001', user_id: 5, provider_id: 'tripo3d', status: 'failed', error_message: 'provider failed' },
    ]);

    const req = {
      params: { taskId: 'provider-task-001' },
      body: {
        prepareToken: 'prepare-token',
        errorMessage: 'provider failed',
      },
      user: { userId: 5 },
    } as unknown as Parameters<typeof failTask>[0];
    const { res, payload } = createResponse();

    await failTask(req, res);

    expect(mockRefund).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.body).toEqual({ success: true });
  });
});
