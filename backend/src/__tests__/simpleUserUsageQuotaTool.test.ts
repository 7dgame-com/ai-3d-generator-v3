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
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ key: 'quota.default_limit_power', value: '100' }]]);

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
    mockPoolQuery.mockResolvedValueOnce([[{ key: 'quota.default_limit_power', value: '10' }]]);
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
    mockPoolQuery.mockResolvedValueOnce([[{ key: 'quota.default_limit_power', value: '100' }]]);
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

  it('stores default limits in the global quota config', async () => {
    await tool.setDefaultLimit(88.888);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO system_config'),
      ['quota.default_limit_power', '88.89']
    );
  });

  it('uses the global limit for organization summaries', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([[{ value: '100' }]])
      .mockResolvedValueOnce([[
        {
          user_id: 8,
          used_power: '10.00',
          updated_at: new Date('2026-05-22T00:00:00.000Z'),
          user_snapshot: JSON.stringify({
            user_id: 8,
            username: 'bob',
            roles: ['user'],
            organizations: [{ id: 7, name: 'school-a' }],
          }),
        },
      ]]);

    const summary = await tool.getSummary({ id: 7 });

    expect(summary).toMatchObject({
      quota_limit: 100,
      used_user_count: 1,
      total_used_power: 10,
      total_remaining_power: 90,
    });
  });

  it('applies the global limit when reserving user power with an organization snapshot', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ value: '10' }]]);
    mockConnQuery.mockResolvedValueOnce([[]]);

    const result = await tool.reserve(7, 'tripo3d', 20, 'temp:7:1', {
      user_id: 7,
      username: 'alice',
      roles: ['user'],
      organizations: [{ id: 7, name: 'school-a' }],
    });

    expect(result).toEqual({
      success: false,
      errorCode: 'INSUFFICIENT_CREDITS',
      usedPowerAfter: 0,
      remainingPower: 10,
    });
    expect(mockConnQuery).toHaveBeenCalledTimes(1);
    expect(mockRollback).toHaveBeenCalledTimes(1);
  });

  it('lists only users with usage records from the plugin quota table', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([[{ key: 'quota.default_limit_power', value: '100' }]])
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

  it('lists usage rows inside the requested organization scope', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([[{ key: 'quota.default_limit_power', value: '100' }]])
      .mockResolvedValueOnce([[
        {
          user_id: 7,
          used_power: '30.00',
          updated_at: new Date('2026-05-21T00:00:00.000Z'),
          user_snapshot: JSON.stringify({
            user_id: 7,
            username: 'alice',
            roles: ['user'],
            organizations: [{ id: 12, name: 'other' }],
          }),
        },
        {
          user_id: 8,
          used_power: '45.00',
          updated_at: new Date('2026-05-22T00:00:00.000Z'),
          user_snapshot: JSON.stringify({
            user_id: 8,
            username: 'bob',
            roles: ['manager'],
            organizations: [{ id: 7, name: 'school-a' }],
          }),
        },
      ]]);

    const result = await tool.listUsageStatuses({
      page: 1,
      pageSize: 20,
      organization: { id: 7 },
    });

    expect(result.pagination.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      user_id: 8,
      used_power: 45,
      user_snapshot: {
        username: 'bob',
        organizations: [{ id: 7, name: 'school-a' }],
      },
    });
  });

  it('resets only users in the requested organization scope', async () => {
    mockConnQuery
      .mockResolvedValueOnce([[
        {
          user_id: 7,
          used_power: '30.00',
          updated_at: new Date('2026-05-21T00:00:00.000Z'),
          user_snapshot: JSON.stringify({
            user_id: 7,
            roles: ['root'],
            organizations: [{ id: 7, name: 'school-a' }],
          }),
        },
        {
          user_id: 8,
          used_power: '45.00',
          updated_at: new Date('2026-05-22T00:00:00.000Z'),
          user_snapshot: JSON.stringify({
            user_id: 8,
            roles: ['user'],
            organizations: [{ id: 12, name: 'other' }],
          }),
        },
      ]])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const result = await tool.resetAllUsage('org reset', { id: 7 });

    expect(result).toEqual({ affectedUsers: 1, clearedPower: 30 });
    expect(String(mockConnQuery.mock.calls[1][0])).toContain('WHERE user_id IN (?)');
    expect(mockConnQuery.mock.calls[1][1]).toEqual(['org reset', 7]);
    expect(mockConnQuery.mock.calls[2][1]).toEqual([7]);
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('resets a single learner usage row inside organization scope', async () => {
    mockConnQuery
      .mockResolvedValueOnce([[
        {
          user_id: 9,
          used_power: '12.50',
          updated_at: new Date('2026-05-22T00:00:00.000Z'),
          user_snapshot: JSON.stringify({
            user_id: 9,
            roles: ['user'],
            organizations: [{ id: 7, name: 'school-a' }],
          }),
        },
      ]])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const result = await tool.resetUserUsage(9, 'single reset', {
      organization: { id: 7 },
      requireLearnerRole: true,
    });

    expect(result).toEqual({ affectedUsers: 1, clearedPower: 12.5 });
    expect(String(mockConnQuery.mock.calls[1][0])).toContain('INSERT INTO quota_usage_ledger');
    expect(mockConnQuery.mock.calls[1][1]).toEqual([
      9,
      'admin_reset',
      -12.5,
      0,
      null,
      null,
      0,
      0,
      'single reset',
    ]);
    expect(mockConnQuery.mock.calls[2]).toEqual([
      'UPDATE quota_user_usage SET used_power = 0 WHERE user_id = ?',
      [9],
    ]);
  });

  it('rejects single user resets for protected roles in organization scope', async () => {
    mockConnQuery.mockResolvedValueOnce([[
      {
        user_id: 10,
        used_power: '12.50',
        updated_at: new Date('2026-05-22T00:00:00.000Z'),
        user_snapshot: JSON.stringify({
          user_id: 10,
          roles: ['admin'],
          organizations: [{ id: 7, name: 'school-a' }],
        }),
      },
    ]]);

    await expect(tool.resetUserUsage(10, 'single reset', {
      organization: { id: 7 },
      requireLearnerRole: true,
    })).rejects.toMatchObject({ code: 'QUOTA_TARGET_ROLE_NOT_ALLOWED' });
    expect(mockRollback).toHaveBeenCalledTimes(1);
  });
});
