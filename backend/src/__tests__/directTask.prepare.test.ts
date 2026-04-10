import type { Response } from 'express';
import { prepareTask } from '../controllers/directTask';

const mockQuery = jest.fn();
const mockPoolGetConnection = jest.fn();
const mockDecrypt = jest.fn();
const mockPreDeduct = jest.fn();
const mockComputeThrottleDelay = jest.fn();
const mockSleep = jest.fn();
const mockSignPrepareToken = jest.fn();

const mockProviderIsEnabled = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  pool: {
    getConnection: (...args: unknown[]) => mockPoolGetConnection(...args),
  },
}));

jest.mock('../services/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

jest.mock('../services/creditManager', () => ({
  creditManager: {
    preDeduct: (...args: unknown[]) => mockPreDeduct(...args),
  },
  computeThrottleDelay: (...args: unknown[]) => mockComputeThrottleDelay(...args),
  sleep: (...args: unknown[]) => mockSleep(...args),
}));

jest.mock('../services/prepareToken', () => ({
  signPrepareToken: (...args: unknown[]) => mockSignPrepareToken(...args),
}));

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    isEnabled: (...args: unknown[]) => mockProviderIsEnabled(...args),
  },
}));

function createResponse() {
  const payload: { body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    status: jest.fn().mockReturnThis(),
    set: jest.fn((key: string, value: string) => {
      payload.headers[key] = value;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      payload.body = body;
      return res;
    }),
  } as unknown as Response;

  return { res, payload };
}

function createLockedAccountConnection(row: Record<string, unknown> | null) {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    query: jest.fn().mockResolvedValue([row ? [row] : []]),
  };
}

describe('directTask.prepareTask', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProviderIsEnabled.mockReturnValue(true);
    mockDecrypt.mockReturnValue('real-provider-api-key');
    mockComputeThrottleDelay.mockReturnValue(0);
    mockSleep.mockResolvedValue(undefined);
    mockPreDeduct.mockResolvedValue({ success: true, walletDeducted: 1.43, poolDeducted: 0 });
    mockSignPrepareToken.mockReturnValue('prepare-token-001');
  });

  it('returns api credentials, prepare token and no-store headers after pre-deduct succeeds', async () => {
    const lockedConn = createLockedAccountConnection({
      wallet_balance: '10.00',
      pool_balance: '5.00',
      pool_baseline: '5.00',
      next_cycle_at: null,
    });
    mockPoolGetConnection.mockResolvedValue(lockedConn);
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
      .mockResolvedValueOnce([{ value: '30000' }])
      .mockResolvedValueOnce([{ value: 'direct' }]);

    const req = {
      body: {
        type: 'text_to_model',
        provider_id: 'tripo3d',
      },
      user: { userId: 7 },
    } as unknown as Parameters<typeof prepareTask>[0];
    const { res, payload } = createResponse();

    await prepareTask(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.headers).toEqual({
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    });
    expect(mockSignPrepareToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        providerId: 'tripo3d',
        estimatedPower: expect.any(Number),
        tempTaskId: expect.stringMatching(/^temp:7:/),
      })
    );
    expect(payload.body).toEqual(
      expect.objectContaining({
        apiKey: 'real-provider-api-key',
        prepareToken: 'prepare-token-001',
        providerId: 'tripo3d',
        apiBaseUrl: '/tripo',
        modelVersion: expect.any(String),
        mode: 'direct',
      })
    );
    expect(lockedConn.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM power_accounts'),
      [7]
    );
  });

  it('returns the hyper reverse proxy base in direct mode', async () => {
    mockPoolGetConnection.mockResolvedValue(
      createLockedAccountConnection({
        wallet_balance: '10.00',
        pool_balance: '5.00',
        pool_baseline: '5.00',
        next_cycle_at: null,
      })
    );
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
      .mockResolvedValueOnce([{ value: '30000' }])
      .mockResolvedValueOnce([{ value: 'direct' }]);

    const req = {
      body: {
        type: 'image_to_model',
        provider_id: 'hyper3d',
      },
      user: { userId: 11 },
    } as unknown as Parameters<typeof prepareTask>[0];
    const { res, payload } = createResponse();

    await prepareTask(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.body).toEqual(
      expect.objectContaining({
        providerId: 'hyper3d',
        apiBaseUrl: '/hyper',
        mode: 'direct',
      })
    );
  });

  it('rejects an invalid provider id', async () => {
    mockProviderIsEnabled.mockReturnValue(false);

    const req = {
      body: {
        type: 'text_to_model',
        provider_id: 'unknown-provider',
      },
      user: { userId: 7 },
    } as unknown as Parameters<typeof prepareTask>[0];
    const { res, payload } = createResponse();

    await prepareTask(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(payload.body).toEqual({
      code: 'INVALID_PROVIDER',
      message: '无效或未启用的服务提供商',
    });
  });

  it('returns PROVIDER_NOT_CONFIGURED when the provider api key is missing', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const req = {
      body: {
        type: 'image_to_model',
        provider_id: 'hyper3d',
      },
      user: { userId: 5 },
    } as unknown as Parameters<typeof prepareTask>[0];
    const { res, payload } = createResponse();

    await prepareTask(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(payload.body).toEqual({
      code: 'PROVIDER_NOT_CONFIGURED',
      message: 'API Key 未配置',
    });
  });

  it('returns INSUFFICIENT_CREDITS when no locked account snapshot exists', async () => {
    mockPoolGetConnection.mockResolvedValue(createLockedAccountConnection(null));
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
      .mockResolvedValueOnce([{ value: '30000' }]);

    const req = {
      body: {
        type: 'text_to_model',
        provider_id: 'tripo3d',
      },
      user: { userId: 8 },
    } as unknown as Parameters<typeof prepareTask>[0];
    const { res, payload } = createResponse();

    await prepareTask(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(payload.body).toEqual({
      code: 'INSUFFICIENT_CREDITS',
      message: '额度不足',
    });
  });

  it('waits for the computed throttle delay before pre-deducting', async () => {
    mockPoolGetConnection.mockResolvedValue(
      createLockedAccountConnection({
        wallet_balance: '10.00',
        pool_balance: '2.00',
        pool_baseline: '5.00',
        next_cycle_at: null,
      })
    );
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
      .mockResolvedValueOnce([{ value: '30000' }])
      .mockResolvedValueOnce([{ value: 'direct' }]);
    mockComputeThrottleDelay.mockReturnValue(1200);

    const req = {
      body: {
        type: 'text_to_model',
        provider_id: 'tripo3d',
      },
      user: { userId: 12 },
    } as unknown as Parameters<typeof prepareTask>[0];
    const { res } = createResponse();

    await prepareTask(req, res);

    expect(mockSleep).toHaveBeenCalledWith(1200);
    expect(mockPreDeduct).toHaveBeenCalled();
  });
});
