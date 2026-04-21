import { creditToPower } from '../config/providers';

const mockQuery = jest.fn();
const mockDecrypt = jest.fn();
const mockFinalizeTaskSuccess = jest.fn();
const mockGetTaskStatus = jest.fn();
const mockFetch = jest.fn();
const mockComputeExpiresAt = jest.fn();
const originalFetch = global.fetch;

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

jest.mock('../services/sitePowerManager', () => ({
  sitePowerManager: {
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
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('passes thumbnailUrl through when finalizing a successful task', async () => {
    const { addTaskToPoller } = await import('../services/taskPoller');

    addTaskToPoller('task-003');
    await jest.advanceTimersByTimeAsync(3000);

    expect(mockFinalizeTaskSuccess).toHaveBeenCalledWith(
      'tripo3d',
      'task-003',
      'https://cdn.example.com/model.glb',
      creditToPower('tripo3d', 30),
      30,
      'https://cdn.example.com/preview.webp'
    );
    expect(mockComputeExpiresAt).toHaveBeenCalledWith(
      'https://cdn.example.com/model.glb',
      'https://cdn.example.com/preview.webp',
      expect.any(Date)
    );
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE tasks SET expires_at = ? WHERE task_id = ?',
      ['2026-04-10 10:00:00', 'task-003']
    );
  });
});
