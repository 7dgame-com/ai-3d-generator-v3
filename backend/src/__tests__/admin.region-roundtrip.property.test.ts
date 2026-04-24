import express from 'express';
import request from 'supertest';
import * as fc from 'fast-check';
import { adminRouter } from '../controllers/admin';

/* ------------------------------------------------------------------ */
/*  Validates: Requirement 1.5                                        */
/* ------------------------------------------------------------------ */

/**
 * In-memory Map that simulates the system_config table.
 * key → value (both strings, mirroring the DB schema).
 */
let configStore: Map<string, string>;

const mockQuery = jest.fn();
const mockEncrypt = jest.fn();
const mockDecrypt = jest.fn();
const mockValidateApiKeyFormat = jest.fn();
const mockGetEnabledIds = jest.fn(() => ['tripo3d']);
const mockProbeRegion = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../services/crypto', () => ({
  encrypt: (...args: unknown[]) => mockEncrypt(...args),
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Simple reversible "encryption": prefix with ENC: */
const ENCRYPT_PREFIX = 'ENC:';

function setupMocks(region: 'ai' | 'com') {
  configStore = new Map();

  mockGetEnabledIds.mockReturnValue(['tripo3d']);
  mockValidateApiKeyFormat.mockReturnValue(true);
  mockProbeRegion.mockResolvedValue(region);

  // Reversible encrypt / decrypt
  mockEncrypt.mockImplementation((plain: string) => `${ENCRYPT_PREFIX}${plain}`);
  mockDecrypt.mockImplementation((cipher: string) => {
    if (typeof cipher === 'string' && cipher.startsWith(ENCRYPT_PREFIX)) {
      return cipher.slice(ENCRYPT_PREFIX.length);
    }
    throw new Error('decrypt failed');
  });

  // Mock query: UPSERT writes to configStore, SELECT reads from it
  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    const sqlUpper = sql.toUpperCase();

    if (sqlUpper.includes('INSERT INTO')) {
      // UPSERT — params: [key, value]
      const [key, value] = params as [string, string];
      configStore.set(key, value);
      return Promise.resolve({ affectedRows: 1 });
    }

    if (sqlUpper.includes('SELECT')) {
      // SELECT — params: [key]
      const [key] = params as [string];
      const value = configStore.get(key);
      if (value !== undefined) {
        return Promise.resolve([{ value }]);
      }
      return Promise.resolve([]);
    }

    return Promise.resolve([]);
  });
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
}

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/**
 * Random API Key — at least 9 characters (after trimming) so the
 * masked version (first 8 chars + "****") is distinguishable.
 * Uses printable ASCII without leading/trailing whitespace to avoid
 * trim-related ambiguity — the controller trims before saving.
 */
const apiKeyArb = fc
  .string({ minLength: 9, maxLength: 64 })
  .map((s: string) => s.trim())
  .filter((s: string) => s.length >= 9);

/** Random region. */
const regionArb: fc.Arbitrary<'ai' | 'com'> = fc.constantFrom('ai', 'com');

/* ------------------------------------------------------------------ */
/*  Property test                                                     */
/* ------------------------------------------------------------------ */

describe('Feature: tripo3d-dual-region, Property 2: 配置保存/读取往返一致性', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it(
    'after PUT /config saves an API Key with a probed region, ' +
      'GET /config returns the same masked key and same region',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          apiKeyArb,
          regionArb,
          async (apiKey: string, region: 'ai' | 'com') => {
            // Arrange — fresh in-memory DB per iteration
            setupMocks(region);
            const app = createApp();

            // Act 1 — save config via PUT
            const putRes = await request(app)
              .put('/admin/config')
              .send({ provider_id: 'tripo3d', apiKey });

            expect(putRes.status).toBe(200);
            expect(putRes.body).toMatchObject({ success: true, region });

            // Act 2 — read config via GET
            const getRes = await request(app)
              .get('/admin/config')
              .query({ provider_id: 'tripo3d' });

            expect(getRes.status).toBe(200);

            // Assert — roundtrip consistency
            const expectedMasked = apiKey.slice(0, 8) + '****';
            expect(getRes.body.configured).toBe(true);
            expect(getRes.body.apiKeyMasked).toBe(expectedMasked);
            expect(getRes.body.region).toBe(region);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
