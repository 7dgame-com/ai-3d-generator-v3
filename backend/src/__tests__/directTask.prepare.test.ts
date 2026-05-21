import type { Response } from 'express';
import { prepareTask } from '../controllers/directTask';

const mockQuery = jest.fn();
const mockDecrypt = jest.fn();
const mockReserve = jest.fn();
const mockSignPrepareToken = jest.fn();

const mockProviderIsEnabled = jest.fn();
const mockGetEnabledIds = jest.fn(() => ['tripo3d']);

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

jest.mock('../services/quotaToolRegistry', () => ({
  activeQuotaTool: {
    reserve: (...args: unknown[]) => mockReserve(...args),
  },
}));

jest.mock('../services/prepareToken', () => ({
  signPrepareToken: (...args: unknown[]) => mockSignPrepareToken(...args),
}));

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    isEnabled: (...args: unknown[]) => mockProviderIsEnabled(...args),
    getEnabledIds: () => mockGetEnabledIds(),
    getDefaultId: jest.fn(() => mockGetEnabledIds()[0] ?? null),
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

describe('directTask.prepareTask', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEnabledIds.mockReturnValue(['tripo3d']);
    mockProviderIsEnabled.mockReturnValue(true);
    mockDecrypt.mockReturnValue('real-provider-api-key');
    mockReserve.mockResolvedValue({ success: true, usedPowerAfter: 1.43, remainingPower: 98.57 });
    mockSignPrepareToken.mockReturnValue('prepare-token-001');
  });

  it('returns api credentials, prepare token and no-store headers after pre-deduct succeeds', async () => {
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
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
    expect(mockReserve).toHaveBeenCalledWith(
      7,
      'tripo3d',
      expect.any(Number),
      expect.stringMatching(/^temp:7:/),
      expect.objectContaining({ user_id: 7 })
    );
  });

  it('returns the hyper reverse proxy base in direct mode', async () => {
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
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

  it('falls back to the first enabled provider when prepareTask omits provider_id', async () => {
    mockGetEnabledIds.mockReturnValue(['hyper3d']);
    mockProviderIsEnabled.mockImplementation((providerId: string) => providerId === 'hyper3d');
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
      .mockResolvedValueOnce([{ value: 'direct' }]);

    const req = {
      body: { type: 'image_to_model' },
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

  it('returns INSUFFICIENT_CREDITS when the quota tool rejects the reservation', async () => {
    mockReserve.mockResolvedValue({
      success: false,
      errorCode: 'INSUFFICIENT_CREDITS',
      usedPowerAfter: 100,
      remainingPower: 0,
    });
    mockQuery
      .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
      .mockResolvedValueOnce([{ value: 'direct' }]);

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
});
