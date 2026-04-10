import {
  GUARDIAN_INTERVAL_MS,
  PREPARE_TIMEOUT_MS,
  runTimeoutGuardianOnce,
  shouldRefundPreDeduct,
  startTimeoutGuardian,
  stopTimeoutGuardian,
} from '../services/timeoutGuardian';

const mockQuery = jest.fn();
const mockRefund = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/creditManager', () => ({
  creditManager: {
    refund: (...args: unknown[]) => mockRefund(...args),
  },
}));

describe('timeoutGuardian service', () => {
  let setIntervalSpy: jest.SpyInstance;
  let clearIntervalSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    setIntervalSpy = jest.spyOn(global, 'setInterval');
    clearIntervalSpy = jest.spyOn(global, 'clearInterval');
  });

  afterEach(() => {
    stopTimeoutGuardian();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    jest.useRealTimers();
  });

  it('refunds timed-out pre-deduct entries and marks tasks as timeout', async () => {
    mockQuery.mockResolvedValueOnce([
      { user_id: 1, provider_id: 'tripo3d', task_id: 'task-001' },
      { user_id: 2, provider_id: 'hyper3d', task_id: 'task-002' },
    ]);
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 });
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 });
    mockRefund.mockResolvedValue(undefined);

    const result = await runTimeoutGuardianOnce(new Date('2026-04-09T09:00:00.000Z'));

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("event_type = 'pre_deduct'"),
      [Math.floor(PREPARE_TIMEOUT_MS / 1000)]
    );
    expect(mockRefund).toHaveBeenNthCalledWith(1, 1, 'tripo3d', 'task-001');
    expect(mockRefund).toHaveBeenNthCalledWith(2, 2, 'hyper3d', 'task-002');
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE tasks SET status = 'timeout'"),
      ['task-001']
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("UPDATE tasks SET status = 'timeout'"),
      ['task-002']
    );
    expect(result).toEqual({ scanned: 2, refunded: 2, failed: 0 });
  });

  it('returns zeros when no timed-out entries are found', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await runTimeoutGuardianOnce(new Date('2026-04-09T09:00:00.000Z'));

    expect(mockRefund).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 0, refunded: 0, failed: 0 });
  });

  it('continues processing even if one refund operation fails', async () => {
    mockQuery.mockResolvedValueOnce([
      { user_id: 1, provider_id: 'tripo3d', task_id: 'task-001' },
      { user_id: 2, provider_id: 'tripo3d', task_id: 'task-002' },
    ]);
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 });
    mockRefund
      .mockRejectedValueOnce(new Error('refund failed'))
      .mockResolvedValueOnce(undefined);

    const result = await runTimeoutGuardianOnce(new Date('2026-04-09T09:00:00.000Z'));

    expect(mockRefund).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scanned: 2, refunded: 1, failed: 1 });
  });

  it('schedules and clears guardian interval timers', () => {
    startTimeoutGuardian();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), GUARDIAN_INTERVAL_MS);

    stopTimeoutGuardian();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('matches timeout/refund eligibility helper behavior', () => {
    const now = Date.parse('2026-04-09T09:00:00.000Z');
    expect(shouldRefundPreDeduct(now - PREPARE_TIMEOUT_MS - 1, now, PREPARE_TIMEOUT_MS, false)).toBe(true);
    expect(shouldRefundPreDeduct(now - PREPARE_TIMEOUT_MS + 1, now, PREPARE_TIMEOUT_MS, false)).toBe(false);
    expect(shouldRefundPreDeduct(now - PREPARE_TIMEOUT_MS - 1, now, PREPARE_TIMEOUT_MS, true)).toBe(false);
  });
});
