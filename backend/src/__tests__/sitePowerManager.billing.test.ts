import { SitePowerManager } from '../services/sitePowerManager';

const PROVIDER_ID = 'tripo3d';

const mockQuery = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockRelease = jest.fn();
const mockBeginTransaction = jest.fn();

jest.mock('../db/connection', () => ({
  pool: {
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

describe('SitePowerManager billing lifecycle', () => {
  let manager: SitePowerManager;

  beforeEach(() => {
    manager = new SitePowerManager();
    jest.clearAllMocks();
    mockBeginTransaction.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(undefined);
    mockRollback.mockResolvedValue(undefined);
    mockRelease.mockReturnValue(undefined);
  });

  it('pre-deducts from the site account and records a site ledger row', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_balance: '30.00', pool_balance: '100.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    const result = await manager.preDeduct(PROVIDER_ID, 80, 'task-001');

    expect(result).toEqual({
      success: true,
      walletDeducted: 30,
      poolDeducted: 50,
    });

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE site_power_accounts');
    expect(updateCall[1]).toEqual([30, 50, 1, 30, 50]);

    const ledgerCall = mockQuery.mock.calls[2];
    expect(ledgerCall[0]).toContain('INSERT INTO site_power_ledger');
    expect(ledgerCall[1]).toEqual([-30, -50, 'task-001', PROVIDER_ID, 80]);
  });

  it('refunds the site account using the pre_deduct ledger row', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-20.00', pool_delta: '-40.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await manager.refund(PROVIDER_ID, 'task-002');

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE site_power_accounts');
    expect(updateCall[1]).toEqual([20, 40, 1]);

    const ledgerCall = mockQuery.mock.calls[2];
    expect(ledgerCall[0]).toContain('INSERT INTO site_power_ledger');
    expect(ledgerCall[1]).toEqual([20, 40, 'task-002', PROVIDER_ID, 60]);
  });

  it('finalizes task success by updating the task row after confirming billing', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ status: 'processing', error_message: null }]])
      .mockResolvedValueOnce([[{ wallet_delta: '-1.00', pool_delta: '0.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await manager.finalizeTaskSuccess(
      PROVIDER_ID,
      'task-003',
      'https://example.com/model.glb',
      1,
      30
    );

    expect(result).toEqual({
      billingStatus: 'settled',
      billingMessage: null,
      shortfallAmount: 0,
    });

    const taskUpdateCall = mockQuery.mock.calls.find((call: unknown[]) =>
      typeof call[0] === 'string' && call[0].includes('UPDATE tasks')
    );
    expect(taskUpdateCall).toBeDefined();
    expect(taskUpdateCall?.[1]).toEqual([
      'https://example.com/model.glb',
      null,
      30,
      1,
      null,
      'task-003',
    ]);
  });
});
