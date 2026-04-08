const mockQuery = jest.fn();
const mockDecrypt = jest.fn();
const mockFinalizeTaskSuccess = jest.fn();
const mockGetTaskStatus = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

jest.mock('../services/creditManager', () => ({
  creditManager: {
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

describe('task poller thumbnail persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
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
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes thumbnailUrl through when finalizing a successful task', async () => {
    const { addTaskToPoller } = await import('../services/taskPoller');

    addTaskToPoller('task-003');
    await jest.advanceTimersByTimeAsync(3000);

    expect(mockFinalizeTaskSuccess).toHaveBeenCalledWith(
      1,
      'tripo3d',
      'task-003',
      'https://cdn.example.com/model.glb',
      30,
      'https://cdn.example.com/preview.webp'
    );
  });
});
