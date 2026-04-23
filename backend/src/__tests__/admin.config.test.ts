import express from 'express';
import request from 'supertest';
import { adminRouter } from '../controllers/admin';

const mockQuery = jest.fn();
const mockEncrypt = jest.fn();
const mockVerifyApiKey = jest.fn();
const mockValidateApiKeyFormat = jest.fn();
const mockGetEnabledIds = jest.fn(() => ['tripo3d']);

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/crypto', () => ({
  encrypt: (...args: unknown[]) => mockEncrypt(...args),
  decrypt: jest.fn(),
}));

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    get: jest.fn(() => ({
      getBalance: jest.fn(),
      validateApiKeyFormat: (...args: unknown[]) => mockValidateApiKeyFormat(...args),
      verifyApiKey: (...args: unknown[]) => mockVerifyApiKey(...args),
    })),
    getEnabledIds: () => mockGetEnabledIds(),
    isEnabled: jest.fn((providerId: string) => mockGetEnabledIds().includes(providerId)),
    getDefaultId: jest.fn(() => mockGetEnabledIds()[0] ?? null),
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
}

describe('admin controller config persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEnabledIds.mockReturnValue(['tripo3d']);
    mockValidateApiKeyFormat.mockReturnValue(true);
    mockVerifyApiKey.mockResolvedValue(undefined);
    mockEncrypt.mockReturnValue('encrypted:trimmed-key');
    mockQuery.mockResolvedValue({ affectedRows: 1 });
  });

  it('trims API keys before verification and persistence in PUT /admin/config', async () => {
    const app = createApp();

    const response = await request(app)
      .put('/admin/config')
      .send({ provider_id: 'tripo3d', apiKey: '  trimmed-key \n' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mockValidateApiKeyFormat).toHaveBeenCalledWith('trimmed-key');
    expect(mockVerifyApiKey).toHaveBeenCalledWith('trimmed-key');
    expect(mockEncrypt).toHaveBeenCalledWith('trimmed-key');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO system_config'),
      ['tripo3d_api_key', 'encrypted:trimmed-key']
    );
  });
});
