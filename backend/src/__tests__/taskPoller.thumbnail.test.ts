import { creditToPower } from '../config/providers';

const mockQuery = jest.fn();
const mockDecrypt = jest.fn();
const mockFinalizeTaskSuccess = jest.fn();
const mockGetTaskStatus = jest.fn();
const mockFetch = jest.fn();
const mockComputeExpiresAt = jest.fn();
const mockReleaseProviderSlot = jest.fn();
const originalFetch = global.fetch;

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

jest.mock('../services/quotaToolRegistry', () => ({
  activeQuotaTool: {
    finalizeTaskSuccess: (...args: unknown[]) => mockFinalizeTaskSuccess(...args),
    refund: jest.fn(),
  },
}));

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    get: jest.fn(() => ({
      getTaskStatus: (...args: unknown[]) => mockGetTaskStatus(...args),
    })),
  },
}));

jest.mock('../utils/urlExpiry', () => ({
  computeExpiresAt: (...args: unknown[]) => mockComputeExpiresAt(...args),
}));

jest.mock('../services/providerQueue', () => ({
  releaseProviderSlot: (...args: unknown[]) => mockReleaseProviderSlot(...args),
}));

describe('task poller thumbnail persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockResolvedValue({
      headers: { get: () => null },
    });
    mockDecrypt.mockReturnValue('real-api-key');
    mockQuery
      .mockResolvedValueOnce([
        {
          user_id: 1,
          provider_id: 'tripo3d',
          provider_status_key: null,
          provider_task_id: 'provider-task-003',
          status: 'queued',
          poll_interval_seconds: 3,
        },
      ])
      .mockResolvedValueOnce([{ value: 'encrypted:key' }]);
    mockGetTaskStatus.mockResolvedValue({
      status: 'success',
      progress: 100,
      outputUrl: 'https://cdn.example.com/model.glb',
      thumbnailUrl: 'https://cdn.example.com/preview.webp',
      creditCost: 30,
    });
    mockFinalizeTaskSuccess.mockResolvedValue({
      billingStatus: 'settled',
      billingMessage: null,
      shortfallAmount: 0,
    });
    mockComputeExpiresAt.mockReturnValue(new Date('2026-04-10T10:00:00.000Z'));
    mockReleaseProviderSlot.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('passes thumbnailUrl through when finalizing a successful task', async () => {
    const { addTaskToPoller } = await import('../services/taskPoller');

    addTaskToPoller('task-003');
    await jest.advanceTimersByTimeAsync(3000);

    const finalizerArgs = mockFinalizeTaskSuccess.mock.calls[0];
    expect(finalizerArgs?.slice(0, 7)).toEqual([
      1, 'tripo3d', 'task-003', 'https://cdn.example.com/model.glb',
      creditToPower('tripo3d', 30), 30, 'https://cdn.example.com/preview.webp',
    ]);
    expect(mockComputeExpiresAt.mock.calls[0]?.slice(0, 2)).toEqual([
      'https://cdn.example.com/model.glb', 'https://cdn.example.com/preview.webp',
    ]);
    expect(mockQuery.mock.calls).toContainEqual([
      'UPDATE tasks SET expires_at = ? WHERE task_id = ?',
      ['2026-04-10 10:00:00', 'task-003'],
    ]);
  });

  it('releases the Hyper3D generation slot when work is done even while packaging continues', async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce([
        {
          user_id: 1,
          provider_id: 'hyper3d',
          provider_status_key: null,
          provider_task_id: 'provider-task-hyper-1',
          status: 'queued',
          credential_scope: 'default',
          quota_epoch: 1,
          poll_interval_seconds: 3,
        },
      ])
      .mockResolvedValueOnce([{ value: 'encrypted:key' }])
      .mockResolvedValue({ affectedRows: 1 });
    mockGetTaskStatus.mockResolvedValue({
      status: 'packaging',
      progress: 95,
      providerWorkFinished: true,
    });

    const { addTaskToPoller } = await import('../services/taskPoller');
    addTaskToPoller('task-hyper-packaging');
    await jest.advanceTimersByTimeAsync(3000);

    expect(mockReleaseProviderSlot).toHaveBeenCalledWith('task-hyper-packaging');
    expect(mockFinalizeTaskSuccess).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls).toContainEqual([
      "UPDATE tasks SET status = 'packaging' WHERE task_id = ? AND status IN ('queued', 'processing', 'packaging')",
      ['task-hyper-packaging'],
    ]);
  });
});
