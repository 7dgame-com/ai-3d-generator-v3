import express from 'express';
import request from 'supertest';
import { adminRouter } from '../controllers/admin';

const mockQuery = jest.fn();
const mockEncrypt = jest.fn();
const mockValidateApiKeyFormat = jest.fn();
const mockGetEnabledIds = jest.fn(() => ['tripo3d']);
const mockProbeRegion = jest.fn();
let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/crypto', () => ({
  encrypt: (...args: unknown[]) => mockEncrypt(...args),
  decrypt: jest.fn(),
}));

jest.mock('../services/regionProbe', () => ({
  probeRegion: (...args: unknown[]) => mockProbeRegion(...args),
}));

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    get: jest.fn(() => ({
      getBalance: jest.fn(),
      validateApiKeyFormat: (...args: unknown[]) => mockValidateApiKeyFormat(...args),
      verifyApiKey: jest.fn(),
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

/**
 * Integration tests for AdminController PUT /config — region probing logic.
 *
 * Validates: Requirements 1.1, 1.4, 1.5, 1.7
 */
describe('AdminController PUT /config region probing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetEnabledIds.mockReturnValue(['tripo3d']);
    mockValidateApiKeyFormat.mockReturnValue(true);
    mockEncrypt.mockReturnValue('encrypted:my-key');
    mockQuery.mockResolvedValue({ affectedRows: 1 });
    mockProbeRegion.mockResolvedValue('com');
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // Requirement 1.1, 1.5: probe success → saves Key + Region, returns { success: true, region }
  it('saves encrypted Key and region when probeRegion succeeds with "com"', async () => {
    mockProbeRegion.mockResolvedValue('com');
    const app = createApp();

    const response = await request(app)
      .put('/admin/config')
      .send({ provider_id: 'tripo3d', apiKey: 'tsk_valid_com_key' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, region: 'com' });

    // Key should be encrypted and saved
    expect(mockEncrypt).toHaveBeenCalledWith('tsk_valid_com_key');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO system_config'),
      ['tripo3d_api_key', 'encrypted:my-key']
    );

    // Region should be saved
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO system_config'),
      ['tripo3d_region', 'com']
    );
  });

  it('saves encrypted Key and region when probeRegion succeeds with "ai"', async () => {
    mockProbeRegion.mockResolvedValue('ai');
    const app = createApp();

    const response = await request(app)
      .put('/admin/config')
      .send({ provider_id: 'tripo3d', apiKey: 'tsk_valid_ai_key' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, region: 'ai' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO system_config'),
      ['tripo3d_region', 'ai']
    );
  });

  // Requirement 1.4: probe failure → returns 422, doesn't save
  it('returns 422 and does not save when probeRegion fails', async () => {
    mockProbeRegion.mockRejectedValue(new AggregateError([], 'All probes failed'));
    const app = createApp();

    const response = await request(app)
      .put('/admin/config')
      .send({ provider_id: 'tripo3d', apiKey: 'tsk_invalid_key' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 4001,
      message: 'API Key 无效或网络不可达，请检查 Key 是否正确',
    });

    // Neither Key nor Region should be saved
    expect(mockEncrypt).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // Requirement 1.7: empty Key → returns 422 (existing validation logic)
  it('returns 422 for empty API key without calling probeRegion', async () => {
    const app = createApp();

    const response = await request(app)
      .put('/admin/config')
      .send({ provider_id: 'tripo3d', apiKey: '   ' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 4001,
      message: '参数错误',
    });

    // probeRegion should not be called for empty keys
    expect(mockProbeRegion).not.toHaveBeenCalled();
    expect(mockEncrypt).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // Non-tripo3d provider → uses original logic (no probing)
  it('saves non-tripo3d provider without region probing', async () => {
    mockGetEnabledIds.mockReturnValue(['tripo3d', 'hyper3d']);
    const app = createApp();

    const response = await request(app)
      .put('/admin/config')
      .send({ provider_id: 'hyper3d', apiKey: 'hyper3d_key_123' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    // probeRegion should NOT be called for non-tripo3d providers
    expect(mockProbeRegion).not.toHaveBeenCalled();

    // Key should be saved with provider-specific key name
    expect(mockEncrypt).toHaveBeenCalledWith('hyper3d_key_123');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO system_config'),
      ['hyper3d_api_key', 'encrypted:my-key']
    );

    // No region should be saved
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['tripo3d_region'])
    );
  });
});
