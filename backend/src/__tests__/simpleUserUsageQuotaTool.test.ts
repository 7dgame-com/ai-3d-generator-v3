const mockPoolQuery = jest.fn();
const mockConnQuery = jest.fn();
const mockBeginTransaction = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockRelease = jest.fn();
const originalAdmissionRetries = process.env.AI3D_QUEUE_ADMISSION_MAX_RETRIES;

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
    // A queue admission retry installs default mock responses; reset query
    // implementations as well as call history so each transaction fixture is
    // isolated from the preceding test.
    mockPoolQuery.mockReset();
    mockConnQuery.mockReset();
    jest.clearAllMocks();
    delete process.env.AI3D_QUEUE_ADMISSION_MAX_RETRIES;
    mockBeginTransaction.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(undefined);
    mockRollback.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (originalAdmissionRetries === undefined) delete process.env.AI3D_QUEUE_ADMISSION_MAX_RETRIES;
    else process.env.AI3D_QUEUE_ADMISSION_MAX_RETRIES = originalAdmissionRetries;
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
      quota_epoch: 1,
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
      quotaEpoch: 1,
    });
    expect(mockConnQuery).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO quota_user_usage (user_id, quota_epoch, used_power, user_snapshot) VALUES (?, ?, ?, ?)',
      [
        7,
        1,
        30,
        expect.stringContaining('"username":"alice"'),
      ]
    );
    expect(String(mockConnQuery.mock.calls[2][0])).toContain('INSERT INTO quota_usage_ledger');
    expect(mockConnQuery.mock.calls[2][1]).toEqual([
      7,
      1,
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

  it('atomically writes the local queue task and Power reservation', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ value: '100' }]]);
    mockConnQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValue({ affectedRows: 1 });

    const result = await tool.enqueueWithReservation({
      taskId: 'local-task-1',
      userId: 7,
      providerId: 'tripo3d',
      type: 'text_to_model',
      prompt: 'cat',
      requestPayload: JSON.stringify({ type: 'text_to_model', prompt: 'cat' }),
      reservedPower: 1.43,
      outstandingLimit: 1,
      userSnapshot: { user_id: 7, username: 'alice' },
    });

    expect(result).toMatchObject({ success: true, quotaEpoch: 1, usedPowerAfter: 1.43 });
    expect(mockBeginTransaction).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockConnQuery.mock.calls.some((call) => String(call[0]).includes('INSERT INTO tasks'))).toBe(true);
    expect(mockConnQuery.mock.calls.some((call) => String(call[0]).includes("'task_enqueued'"))).toBe(true);
    expect(mockConnQuery.mock.calls.some((call) => String(call[0]).includes('INSERT INTO quota_usage_ledger'))).toBe(true);
  });

  it('retries a deadlocked queue admission without creating a second reservation', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([[{ value: '100' }]])
      .mockResolvedValueOnce([[{ value: '100' }]]);
    const deadlock = Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });
    mockConnQuery
      .mockRejectedValueOnce(deadlock)
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValue({ affectedRows: 1 });

    const result = await tool.enqueueWithReservation({
      taskId: 'local-task-deadlock-retry',
      userId: 71,
      providerId: 'tripo3d',
      type: 'text_to_model',
      prompt: 'retry safely',
      requestPayload: JSON.stringify({ type: 'text_to_model', prompt: 'retry safely' }),
      reservedPower: 1,
      outstandingLimit: 1,
      userSnapshot: { user_id: 71, username: 'retry-user', roles: ['user'] },
    });

    expect(result).toMatchObject({ success: true, quotaEpoch: 1, usedPowerAfter: 1 });
    expect(mockBeginTransaction).toHaveBeenCalledTimes(2);
    expect(mockRollback).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockConnQuery.mock.calls.filter((call) => String(call[0]).includes('INSERT INTO quota_usage_ledger'))).toHaveLength(1);
  });

  it('does not mutate the current quota cycle when an old task settles late', async () => {
    mockConnQuery
      .mockResolvedValueOnce([[{ status: 'processing', error_message: null, quota_epoch: 1 }]])
      .mockResolvedValueOnce([[{ amount: '1.00' }]])
      .mockResolvedValueOnce([[{ user_id: 7, quota_epoch: 2, used_power: '0.00' }]])
      .mockResolvedValue({ affectedRows: 1 });

    await tool.finalizeTaskSuccess(
      7,
      'tripo3d',
      'old-task',
      'https://cdn.example.com/model.glb',
      2,
      40
    );

    expect(mockConnQuery.mock.calls.some((call) =>
      String(call[0]).startsWith('UPDATE quota_user_usage SET used_power')
    )).toBe(false);
    const ledgerCall = mockConnQuery.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO quota_usage_ledger')
    );
    expect(ledgerCall?.[1]?.[1]).toBe(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
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
    const resetLedgerCall = mockConnQuery.mock.calls.find((call) => String(call[0]).includes("'admin_reset', -used_power"));
    const resetUsageCall = mockConnQuery.mock.calls.find((call) => String(call[0]).includes('quota_epoch = quota_epoch + 1'));
    expect(resetLedgerCall?.[1]).toEqual(['manual reset']);
    expect(resetUsageCall?.[0]).toContain('UPDATE quota_user_usage');
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
    const resetLedgerCall = mockConnQuery.mock.calls.find((call) => String(call[0]).includes("'admin_reset', -used_power"));
    const resetUsageCall = mockConnQuery.mock.calls.find((call) => String(call[0]).includes('quota_epoch = quota_epoch + 1'));
    expect(String(resetLedgerCall?.[0])).toContain('WHERE user_id IN (?)');
    expect(resetLedgerCall?.[1]).toEqual(['org reset', 7]);
    expect(resetUsageCall?.[1]).toEqual([7]);
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
    const resetLedgerCall = mockConnQuery.mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('admin_reset'));
    expect(String(resetLedgerCall?.[0])).toContain('INSERT INTO quota_usage_ledger');
    expect(resetLedgerCall?.[1]).toEqual([
      9,
      1,
      'admin_reset',
      -12.5,
      0,
      null,
      null,
      0,
      0,
      'single reset',
    ]);
    const resetUsageCall = mockConnQuery.mock.calls.find((call) => String(call[0]).includes('quota_epoch = quota_epoch + 1'));
    expect(resetUsageCall).toEqual([
      'UPDATE quota_user_usage SET used_power = 0, quota_epoch = quota_epoch + 1 WHERE user_id = ?',
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
