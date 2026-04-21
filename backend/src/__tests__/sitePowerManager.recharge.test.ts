const mockQuery = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockRelease = jest.fn();
const mockBeginTransaction = jest.fn();
const mockPoolQuery = jest.fn();

jest.mock('../db/connection', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
    getConnection: jest.fn().mockImplementation(() =>
      Promise.resolve({
        query: mockQuery,
        beginTransaction: mockBeginTransaction,
        commit: mockCommit,
        rollback: mockRollback,
        release: mockRelease,
      })
    ),
  },
}));

describe('sitePowerManager.recharge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPoolQuery.mockResolvedValue([[]]);
    mockQuery.mockResolvedValue([{ id: 1 }]);
    mockBeginTransaction.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(undefined);
    mockRollback.mockResolvedValue(undefined);
    mockRelease.mockReturnValue(undefined);
  });

  it('returns a zeroed site status when no site account exists', async () => {
    const { sitePowerManager } = await import('../services/sitePowerManager');

    const status = await sitePowerManager.getAccountStatus();

    expect(status).toEqual({
      wallet_balance: 0,
      pool_balance: 0,
      pool_baseline: 0,
      cycles_remaining: 0,
      cycle_duration: 0,
      total_duration: 0,
      cycle_started_at: null,
      next_cycle_at: null,
    });
  });

  it('recharges the site account from compatibility console values', async () => {
    const { sitePowerManager } = await import('../services/sitePowerManager');

    await sitePowerManager.recharge({
      total_power: 1200,
      wallet_percent: 40,
      pool_percent: 60,
      wallet_amount: 480,
      pool_amount: 720,
      total_duration: 10080,
      cycle_duration: 1440,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO site_power_accounts'),
      [
        720,
        720,
        68.57142857142857,
        7,
        1440,
        10080,
        1440,
        1440,
      ]
    );
  });
});

export {};
