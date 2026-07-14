const mockQuery = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

import { getQueueOperationalHealth, logQueueEvent, purgeExpiredDiagnostics } from '../services/observability';

describe('P1 observability', () => {
  beforeEach(() => mockQuery.mockReset());

  it('writes structured queue fields without request payloads', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    logQueueEvent({
      event: 'provider_submitted', localTaskId: 'local-1', providerTaskId: 'provider-1',
      providerId: 'tripo3d', credentialScope: 'default', quotaEpoch: 2, attemptCount: 1,
      internalTraceId: 'internal-trace-1', providerTraceId: 'trace-1', taskStatus: 'queued',
    });
    const payload = JSON.parse(String(info.mock.calls[0][0]));
    expect(payload).toMatchObject({ event: 'provider_submitted', localTaskId: 'local-1', providerId: 'tripo3d', quotaEpoch: 2, internalTraceId: 'internal-trace-1' });
    expect(payload).not.toHaveProperty('requestPayload');
    info.mockRestore();
  });

  it('retains diagnostics using bounded-time deletes', async () => {
    mockQuery.mockResolvedValue({ affectedRows: 0 });
    await purgeExpiredDiagnostics();
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM provider_task_events'), [90]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM admin_audit_logs'), [90]);
  });

  it('reports paused or over-age queues as operational warnings without changing process health', async () => {
    mockQuery.mockResolvedValueOnce([{
      provider_id: 'tripo3d', credential_scope: 'school-a', paused: 1, queue_depth: 2,
      oldest_wait: new Date(Date.now() - 20 * 60 * 1000).toISOString(), unknown_count: 3,
    }]);

    await expect(getQueueOperationalHealth()).resolves.toEqual({
      pausedScopes: ['tripo3d:school-a'],
      backloggedScopes: [expect.objectContaining({ providerId: 'tripo3d', credentialScope: 'school-a', queueDepth: 2 })],
      unknownTaskCount: 3,
    });
  });
});
