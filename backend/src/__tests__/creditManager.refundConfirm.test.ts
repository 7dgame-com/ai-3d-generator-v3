/**
 * Unit tests for the unified power-account refund and confirm flow
 * Validates: Requirements 3.4, 8.1
 */

import { CreditManager } from '../services/creditManager';

const PROVIDER_ID = 'tripo3d';

// ─── Mock mysql2/promise pool ─────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CreditManager.refund', () => {
  let manager: CreditManager;

  beforeEach(() => {
    manager = new CreditManager();
    jest.clearAllMocks();
    mockBeginTransaction.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(undefined);
    mockRollback.mockResolvedValue(undefined);
    mockRelease.mockReturnValue(undefined);
  });

  it('restores wallet and pool balances based on pre_deduct ledger record', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-30.00', pool_delta: '-50.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await manager.refund(1, 'tripo3d', 'task-001');

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE power_accounts');
    expect(updateCall[1]).toEqual([30, 50, 1]);

    const ledgerCall = mockQuery.mock.calls[2];
    expect(ledgerCall[0]).toContain('power_ledger');
    expect(ledgerCall[0]).toContain('refund');
    expect(ledgerCall[1]).toEqual([1, 30, 50, 'task-001', 'tripo3d', 80]);

    expect(mockCommit).toHaveBeenCalled();
  });

  it('restores only wallet when pool_delta was 0', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-80.00', pool_delta: '0.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await manager.refund(1, 'tripo3d', 'task-002');

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[1]).toEqual([80, 0, 1]);

    const ledgerCall = mockQuery.mock.calls[2];
    expect(ledgerCall[1]).toEqual([1, 80, 0, 'task-002', 'tripo3d', 80]);
  });

  it('rolls back and returns silently when no pre_deduct record found', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // empty ledger rows

    await manager.refund(1, 'tripo3d', 'task-nonexistent');

    expect(mockRollback).toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('rolls back transaction on unexpected DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));

    await expect(manager.refund(1, 'tripo3d', 'task-003')).rejects.toThrow('DB error');
    expect(mockRollback).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });

  it('always releases the connection', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-20.00', pool_delta: '-30.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await manager.refund(1, 'tripo3d', 'task-004');
    expect(mockRelease).toHaveBeenCalled();
  });
});

describe('CreditManager.confirmDeduct', () => {
  let manager: CreditManager;

  beforeEach(() => {
    manager = new CreditManager();
    jest.clearAllMocks();
    mockBeginTransaction.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(undefined);
    mockRollback.mockResolvedValue(undefined);
    mockRelease.mockReturnValue(undefined);
  });

  it('queries pre_deduct ledger records for the given taskId', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-30.00', pool_delta: '-20.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([{}]);

    const result = await manager.confirmDeduct(1, PROVIDER_ID, 'task-001', 50);

    const selectCall = mockQuery.mock.calls[0];
    expect(selectCall[0]).toContain('pre_deduct');
    expect(selectCall[1]).toEqual([1, 'task-001']);

    const ledgerCall = mockQuery.mock.calls[1];
    expect(ledgerCall[1]).toEqual([1, -30, -20, 'task-001', 'tripo3d', 0, 50, 'actual=50']);

    expect(mockCommit).toHaveBeenCalled();
    expect(result).toEqual({
      billingStatus: 'settled',
      billingMessage: null,
      shortfallAmount: 0,
    });
  });

  it('refunds diff to pool (priority) then wallet when actual < preDeducted', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-20.00', pool_delta: '-30.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([[{ user_id: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await manager.confirmDeduct(1, PROVIDER_ID, 'task-002', 40);

    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE power_accounts');
    expect(updateCall[1]).toEqual([0, 10, 1]);

    expect(mockCommit).toHaveBeenCalled();
  });

  it('refunds to wallet when refund amount exceeds preDeductedPool', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-40.00', pool_delta: '-5.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([[{ user_id: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await manager.confirmDeduct(1, PROVIDER_ID, 'task-003', 30);

    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[1]).toEqual([10, 5, 1]);
    expect(mockCommit).toHaveBeenCalled();
  });

  it('extra deducts from pool (priority) then wallet when actual > preDeducted', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-20.00', pool_delta: '-20.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([[{ wallet_balance: '50.00', pool_balance: '100.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    const result = await manager.confirmDeduct(1, PROVIDER_ID, 'task-004', 50);

    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE power_accounts');
    expect(updateCall[1]).toEqual([10, 0, 1]);
    expect(mockCommit).toHaveBeenCalled();
    expect(result.billingStatus).toBe('settled');
  });

  it('extra deducts from wallet when pool is insufficient', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-20.00', pool_delta: '-20.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([[{ wallet_balance: '50.00', pool_balance: '5.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await manager.confirmDeduct(1, PROVIDER_ID, 'task-005', 50);

    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[1]).toEqual([5, 5, 1]);
    expect(mockCommit).toHaveBeenCalled();
  });

  it('returns undercharged result when balance is insufficient for extra deduct', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-10.00', pool_delta: '-10.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([[{ wallet_balance: '5.00', pool_balance: '5.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    const result = await manager.confirmDeduct(1, PROVIDER_ID, 'task-006', 50);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('余额不足以完成追加扣减'));
    expect(result).toEqual({
      billingStatus: 'undercharged',
      billingMessage: '计费待补扣：shortfall=20, actual=50',
      shortfallAmount: 20,
    });
    const ledgerCall = mockQuery.mock.calls[3];
    expect(ledgerCall[1]).toEqual([
      1,
      -5,
      -5,
      'task-006',
      'tripo3d',
      0,
      50,
      'actual=50,pre=20,extra=30,shortfall=20',
    ]);
    expect(mockCommit).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not write legacy credit_usage records during confirmDeduct', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-30.00', pool_delta: '-20.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([{}]);

    await manager.confirmDeduct(1, PROVIDER_ID, 'task-007', 50);

    const creditUsageCall = mockQuery.mock.calls.find((c: any[]) => c[0] && c[0].includes('credit_usage'));
    expect(creditUsageCall).toBeUndefined();
    expect(mockCommit).toHaveBeenCalled();
  });

  it('rolls back transaction on unexpected DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB write error'));

    await expect(manager.confirmDeduct(1, PROVIDER_ID, 'task-008', 20)).rejects.toThrow('DB write error');
    expect(mockRollback).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });

  it('always releases the connection', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ wallet_delta: '-10.00', pool_delta: '-10.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([{}]);

    await manager.confirmDeduct(1, PROVIDER_ID, 'task-009', 20);
    expect(mockRelease).toHaveBeenCalled();
  });
});

describe('CreditManager.finalizeTaskSuccess', () => {
  let manager: CreditManager;

  beforeEach(() => {
    manager = new CreditManager();
    jest.clearAllMocks();
    mockBeginTransaction.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(undefined);
    mockRollback.mockResolvedValue(undefined);
    mockRelease.mockReturnValue(undefined);
  });

  it('updates task state in the same transaction after successful billing confirmation', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ status: 'processing', error_message: null }]])
      .mockResolvedValueOnce([[{ wallet_delta: '-1.00', pool_delta: '0.00', provider_id: PROVIDER_ID }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await manager.finalizeTaskSuccess(
      1,
      PROVIDER_ID,
      'task-010',
      'https://example.com/model.glb',
      1,
      30
    );

    expect(result.billingStatus).toBe('settled');
    const taskUpdateCall = mockQuery.mock.calls.find((call: any[]) => call[0].includes('UPDATE tasks'));
    expect(taskUpdateCall[0]).toContain("SET status = 'success'");
    expect(taskUpdateCall[1]).toEqual([
      'https://example.com/model.glb',
      null,
      30,
      1,
      null,
      'task-010',
    ]);
    expect(mockCommit).toHaveBeenCalled();
  });

  it('stores both credit_cost and power_cost on the task row', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ status: 'processing', error_message: null }]])
      .mockResolvedValueOnce([[{ wallet_delta: '-1.00', pool_delta: '0.00' }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await manager.finalizeTaskSuccess(
      1,
      PROVIDER_ID,
      'task-010b',
      'https://example.com/model.glb',
      1,
      30
    );

    const taskUpdateCall = mockQuery.mock.calls.find((call: any[]) => call[0].includes('UPDATE tasks'));
    expect(taskUpdateCall[0]).toContain('credit_cost = ?');
    expect(taskUpdateCall[0]).toContain('power_cost = ?');
  });

  it('stores undercharged billing message on the task when extra deduction is incomplete', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockQuery
      .mockResolvedValueOnce([[{ status: 'processing', error_message: null }]])
      .mockResolvedValueOnce([[{ wallet_delta: '-1.00', pool_delta: '0.00' }]])
      .mockResolvedValueOnce([[{ wallet_balance: '0.10', pool_balance: '0.10' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await manager.finalizeTaskSuccess(
      1,
      PROVIDER_ID,
      'task-011',
      'https://example.com/model.glb',
      1.67,
      50
    );

    expect(result.billingStatus).toBe('undercharged');
    expect(result.billingMessage).toContain('shortfall=');
    expect(result.billingMessage).toContain('actual=1.67');
    expect(result.shortfallAmount).toBeCloseTo(0.47, 2);
    const taskUpdateCall = mockQuery.mock.calls.find((call: any[]) => call[0].includes('UPDATE tasks'));
    expect(taskUpdateCall[1]).toEqual([
      'https://example.com/model.glb',
      null,
      50,
      1.67,
      result.billingMessage,
      'task-011',
    ]);
    warnSpy.mockRestore();
  });

  it('persists thumbnail_url together with output_url when finalizing success', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ status: 'processing', error_message: null }]])
      .mockResolvedValueOnce([[{ wallet_delta: '-1.00', pool_delta: '0.00' }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await (manager.finalizeTaskSuccess as any)(
      1,
      PROVIDER_ID,
      'task-012',
      'https://example.com/model.glb',
      1,
      30,
      'https://example.com/preview.webp'
    );

    const taskUpdateCall = mockQuery.mock.calls.find((call: any[]) => call[0].includes('UPDATE tasks'));
    expect(taskUpdateCall[0]).toContain('thumbnail_url = ?');
    expect(taskUpdateCall[1]).toEqual([
      'https://example.com/model.glb',
      'https://example.com/preview.webp',
      30,
      1,
      null,
      'task-012',
    ]);
  });
});
