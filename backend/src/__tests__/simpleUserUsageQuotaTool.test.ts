const mockPoolQuery = jest.fn();
const mockConnQuery = jest.fn();
const mockBeginTransaction = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockRelease = jest.fn();

jest.mock('../db/connection', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
    getConnection: jest.fn(async () => ({
      query: (...args: unknown[]) => mockConnQuery(...args),
      beginTransaction: mockBeginTransaction,
      commit: mockCommit,
      rollback: mockRollback,
      release: mockRelease,
    })),
  },
}));

import { SimpleUserUsageQuotaTool } from '../services/simpleUserUsageQuotaTool';

describe('SimpleUserUsageQuotaTool', () => {
  const tool = new SimpleUserUsageQuotaTool();

  beforeEach(() => {
    jest.clearAllMocks();
    mockBeginTransaction.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(undefined);
    mockRollback.mockResolvedValue(undefined);
  });

  it('treats users without usage rows as zero used power', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([[{ value: '100' }]])
      .mockResolvedValueOnce([[]]);

    const status = await tool.getUserStatus(7);

    expect(status).toEqual({
      tool: 'simple-user-usage-quota',
      user_id: 7,
      quota_limit: 100,
      used_power: 0,
      remaining_power: 100,
      has_record: false,
      updated_at: null,
      user_snapshot: null,
    });
  });

  it('rejects reservations that would exceed the default limit without creating a row', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ value: '10' }]]);
    mockConnQuery.mockResolvedValueOnce([[]]);

    const result = await tool.reserve(7, 'tripo3d', 20, 'temp:7:1');

    expect(result).toEqual({
      success: false,
      errorCode: 'INSUFFICIENT_CREDITS',
      usedPowerAfter: 0,
      remainingPower: 10,
    });
    expect(mockRollback).toHaveBeenCalledTimes(1);
    expect(mockConnQuery).toHaveBeenCalledTimes(1);
  });

  it('creates a user usage row only after a successful reservation', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ value: '100' }]]);
    mockConnQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const result = await tool.reserve(7, 'tripo3d', 30, 'temp:7:1', {
      user_id: 7,
      username: 'alice',
      email: 'alice@example.com',
      roles: ['user'],
    });

    expect(result).toEqual({
      success: true,
      usedPowerAfter: 30,
      remainingPower: 70,
    });
    expect(mockConnQuery).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO quota_user_usage (user_id, used_power, user_snapshot) VALUES (?, ?, ?)',
      [
        7,
        30,
        expect.stringContaining('"username":"alice"'),
      ]
    );
    expect(String(mockConnQuery.mock.calls[2][0])).toContain('INSERT INTO quota_usage_ledger');
    expect(mockConnQuery.mock.calls[2][1]).toEqual([
      7,
      'pre_deduct',
      30,
      30,
      'temp:7:1',
      'tripo3d',
      0,
      30,
      null,
    ]);
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('lists only users with usage records from the plugin quota table', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([[{ value: '100' }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[
        {
          user_id: 7,
          used_power: '30.00',
          updated_at: new Date('2026-05-21T00:00:00.000Z'),
          user_snapshot: JSON.stringify({ user_id: 7, username: 'alice', email: 'alice@example.com' }),
        },
      ]]);

    const result = await tool.listUsageStatuses({ page: 1, pageSize: 20, search: 'alice' });

    expect(String(mockPoolQuery.mock.calls[1][0])).toContain('FROM quota_user_usage');
    expect(String(mockPoolQuery.mock.calls[1][0])).toContain('JSON_EXTRACT');
    expect(result.pagination.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      user_id: 7,
      used_power: 30,
      has_record: true,
      user_snapshot: {
        username: 'alice',
        email: 'alice@example.com',
      },
    });
  });

  it('resets existing usage rows and writes admin reset ledger entries', async () => {
    mockConnQuery
      .mockResolvedValueOnce([[{ affected_users: 2, cleared_power: '45.50' }]])
      .mockResolvedValueOnce({ affectedRows: 2 })
      .mockResolvedValueOnce({ affectedRows: 2 });

    const result = await tool.resetAllUsage('manual reset');

    expect(result).toEqual({ affectedUsers: 2, clearedPower: 45.5 });
    expect(String(mockConnQuery.mock.calls[1][0])).toContain("SELECT user_id, 'admin_reset', -used_power");
    expect(mockConnQuery.mock.calls[1][1]).toEqual(['manual reset']);
    expect(mockConnQuery.mock.calls[2][0]).toBe('UPDATE quota_user_usage SET used_power = 0');
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });
});
