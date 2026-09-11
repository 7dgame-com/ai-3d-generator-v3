import express from 'express';
import request from 'supertest';
import { adminRouter } from '../controllers/admin';

const mockQuery = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/crypto', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));
jest.mock('../services/providerQueue', () => ({
  wakeProviderDispatcher: jest.fn(),
  getProviderDispatcherHealth: jest.fn(() => ({
    running: true, dispatchEnabled: true, workerId: 'test-worker', scanMs: 2000, lastScanAt: new Date().toISOString(), lastScanError: null,
  })),
}));
jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    get: jest.fn(), getEnabledIds: jest.fn(() => ['tripo3d']),
    getDefaultId: jest.fn(() => 'tripo3d'), isEnabled: jest.fn(() => true),
  },
}));

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/admin', adminRouter);
  return instance;
}

describe('P1 admin queue and diagnostics API', () => {
  beforeEach(() => mockQuery.mockReset());

  it('lists queue work without returning prompts or request payloads', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        task_id: 'local-task-1', provider_task_id: 'provider-1', user_id: 9, provider_id: 'tripo3d',
        credential_scope: 'default', status: 'waiting_provider', progress: 0, queue_entered_at: '2026-07-14T00:00:00Z',
        next_attempt_at: null, attempt_count: 0, priority: 0, provider_slot_acquired_at: null,
        provider_slot_released_at: null, provider_error_category: null, provider_error_code: null,
        provider_trace_id: null, error_message: null, quota_epoch: 2, created_at: '2026-07-14T00:00:00Z', completed_at: null,
        prompt: 'must not leak', request_payload: '{"imageBase64":"must not leak"}',
      }])
      .mockResolvedValueOnce([{ total: 1 }]);

    const response = await request(app()).get('/admin/provider-queue').query({ provider_id: 'tripo3d' });

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ taskId: 'local-task-1', providerTaskId: 'provider-1', quotaEpoch: 2 });
    expect(JSON.stringify(response.body)).not.toContain('must not leak');
  });

  it('redacts sensitive event detail in task diagnostics', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        task_id: 'local-task-2', provider_task_id: 'provider-2', user_id: 9, provider_id: 'tripo3d', credential_scope: 'default',
        status: 'provider_state_unknown', progress: 20, attempt_count: 1, quota_epoch: 2, provider_error_category: 'SUBMISSION_UNKNOWN',
        provider_error_code: 'ETIMEDOUT', provider_trace_id: 'trace-1', error_message: 'checking', queue_entered_at: null,
        next_attempt_at: null, lease_owner: null, lease_expires_at: null, provider_slot_acquired_at: null,
        provider_slot_released_at: null, created_at: '2026-07-14T00:00:00Z', completed_at: null,
      }])
      .mockResolvedValueOnce([{
        event_type: 'submission_unknown', from_status: 'submitting', to_status: 'provider_state_unknown', attempt_count: 1,
        trace_id: 'trace-1', detail_json: JSON.stringify({ apiKey: 'secret', message: 'safe' }), created_at: '2026-07-14T00:01:00Z',
      }]);

    const response = await request(app()).get('/admin/tasks/local-task-2/diagnostics');

    expect(response.status).toBe(200);
    expect(response.body.events[0].detail).toEqual({ apiKey: '[REDACTED]', message: 'safe' });
  });

  it('enforces the Tripo P1 concurrency ceiling and optimistic config version', async () => {
    const invalid = await request(app()).put('/admin/provider-runtime/tripo3d').send({ maxConcurrency: 6 });
    expect(invalid.status).toBe(422);
    expect(invalid.body.code).toBe('INVALID_CONCURRENCY');

    mockQuery
      .mockResolvedValueOnce([{ max_concurrency: 4, paused: 0, pause_reason: null, poll_interval_seconds: 3, retry_limit: 6, config_version: 9 }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });
    const valid = await request(app())
      .put('/admin/provider-runtime/tripo3d')
      .send({ maxConcurrency: 5, paused: false, pollIntervalSeconds: 3, retryLimit: 6, configVersion: 9 });

    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ success: true, configVersion: 10 });
    expect(mockQuery.mock.calls[1][0]).toContain('config_version = config_version + 1');
  });

  it('exposes pause and queue-age alerts without making them task errors', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        provider_id: 'tripo3d', credential_scope: 'default', paused: 1, pause_reason: 'NO_BALANCE: low balance',
        queue_depth: 4, active_count: 1, state_unknown_count: 3, oldest_wait: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        dispatch_success_count: 2, dispatch_failed_count: 0, throttle_count: 6,
      }])
      .mockResolvedValueOnce([
        { provider_id: 'tripo3d', credential_scope: 'default', wait_seconds: 2 },
        { provider_id: 'tripo3d', credential_scope: 'default', wait_seconds: 8 },
        { provider_id: 'tripo3d', credential_scope: 'default', wait_seconds: 14 },
      ]);
    const response = await request(app()).get('/admin/observability');

    expect(response.status).toBe(200);
    expect(response.body.data[0].alerts.map((alert: { code: string }) => alert.code)).toEqual(
      expect.arrayContaining(['PROVIDER_PAUSED', 'PROVIDER_BALANCE_LOW', 'STATE_UNKNOWN_BACKLOG', 'SUSTAINED_THROTTLING', 'QUEUE_WAIT_EXCEEDED'])
    );
    expect(response.body.data[0]).toMatchObject({
      dispatchSuccessRate: 1,
      throttleRate: 0.75,
      waitP50Seconds: 8,
      waitP95Seconds: 14,
    });
  });
});
