const mockQuery = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

describe('taskPoller api_mode compatibility', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('loads all pending tasks when api_mode is direct so browser refresh does not interrupt direct tasks', async () => {
    mockQuery.mockResolvedValueOnce([{ task_id: 'legacy-task-1' }]);

    const { startPoller, stopPoller } = await import('../services/taskPoller');
    await startPoller();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT task_id FROM tasks WHERE provider_task_id IS NOT NULL AND status IN ('queued', 'processing', 'packaging', 'provider_state_unknown')"
    );
    stopPoller();
  });

  it('loads all pending tasks when api_mode is proxy', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const { startPoller, stopPoller } = await import('../services/taskPoller');
    await startPoller();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT task_id FROM tasks WHERE provider_task_id IS NOT NULL AND status IN ('queued', 'processing', 'packaging', 'provider_state_unknown')"
    );
    stopPoller();
  });
});

export {};
