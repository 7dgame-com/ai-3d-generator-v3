import * as fc from 'fast-check';
import { parseEnabledProviders, resolveEnabledProviders } from '../config/providers';
import { requestMainBusinessApiGet } from '../config/mainBusinessApi';

jest.mock('../config/mainBusinessApi', () => ({
  requestMainBusinessApiGet: jest.fn(),
}));

const mockedRequestMainBusinessApiGet = requestMainBusinessApiGet as jest.MockedFunction<typeof requestMainBusinessApiGet>;

describe('parseEnabledProviders()', () => {
  let mockExit: jest.SpyInstance;
  const envNames = [
    'ENABLED_PROVIDERS',
    'DEPLOYMENT_MODE',
    'ENABLE_AI_3D_GENERATOR',
    'APP_API_1_URL',
  ] as const;
  const originalEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]])
  ) as Record<typeof envNames[number], string | undefined>;

  beforeEach(() => {
    mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
    mockedRequestMainBusinessApiGet.mockReset();
    for (const name of envNames) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const name of envNames) {
      const value = originalEnv[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  // --- Unit tests ---

  it('empty string → calls process.exit(1)', () => {
    process.env.ENABLED_PROVIDERS = '';
    expect(() => parseEnabledProviders()).toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('whitespace only → calls process.exit(1)', () => {
    process.env.ENABLED_PROVIDERS = '   ';
    expect(() => parseEnabledProviders()).toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('all invalid values → calls process.exit(1)', () => {
    process.env.ENABLED_PROVIDERS = 'foo,bar';
    expect(() => parseEnabledProviders()).toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('valid single value "tripo3d" → returns [\'tripo3d\']', () => {
    process.env.ENABLED_PROVIDERS = 'tripo3d';
    expect(parseEnabledProviders()).toEqual(['tripo3d']);
  });

  it('valid single value "hyper3d" → returns [\'hyper3d\']', () => {
    process.env.ENABLED_PROVIDERS = 'hyper3d';
    expect(parseEnabledProviders()).toEqual(['hyper3d']);
  });

  it('both valid values → returns both', () => {
    process.env.ENABLED_PROVIDERS = 'tripo3d,hyper3d';
    const result = parseEnabledProviders();
    expect(result).toContain('tripo3d');
    expect(result).toContain('hyper3d');
    expect(result).toHaveLength(2);
  });

  it('mixed case "TRIPO3D,Hyper3D" → returns [\'tripo3d\', \'hyper3d\']', () => {
    process.env.ENABLED_PROVIDERS = 'TRIPO3D,Hyper3D';
    const result = parseEnabledProviders();
    expect(result).toContain('tripo3d');
    expect(result).toContain('hyper3d');
    expect(result).toHaveLength(2);
  });

  it('values with spaces " tripo3d , hyper3d " → returns [\'tripo3d\', \'hyper3d\']', () => {
    process.env.ENABLED_PROVIDERS = ' tripo3d , hyper3d ';
    const result = parseEnabledProviders();
    expect(result).toContain('tripo3d');
    expect(result).toContain('hyper3d');
    expect(result).toHaveLength(2);
  });

  it('mix of valid and invalid "tripo3d,foo,bar" → returns [\'tripo3d\'] (filters invalid)', () => {
    process.env.ENABLED_PROVIDERS = 'tripo3d,foo,bar';
    expect(parseEnabledProviders()).toEqual(['tripo3d']);
  });

  // --- Property-based test ---

  /**
   * Validates: Requirements 9.1
   *
   * Feature: multi-provider-credits, Property 11: ENABLED_PROVIDERS 解析正确性
   * For any comma-separated string containing at least one valid provider identifier
   * (allowing spaces, mixed case), parseEnabledProviders() should return a deduplicated,
   * lowercase array containing only valid identifiers.
   */
  it('Property 11: parseEnabledProviders returns deduplicated lowercase valid identifiers', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom('tripo3d', 'hyper3d', 'TRIPO3D', 'Hyper3D', ' tripo3d ', ' hyper3d '),
          { minLength: 1 }
        ),
        (tokens) => {
          process.env.ENABLED_PROVIDERS = tokens.join(',');
          const result = parseEnabledProviders();

          // All returned values are lowercase
          result.forEach(v => expect(v).toBe(v.toLowerCase()));

          // All returned values are known valid providers
          const validSet = new Set(['tripo3d', 'hyper3d']);
          result.forEach(v => expect(validSet.has(v)).toBe(true));

          // Result is deduplicated
          expect(result.length).toBe(new Set(result).size);

          // Result is non-empty (since input has at least one valid provider)
          expect(result.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  describe('resolveEnabledProviders()', () => {
    it('main deployment local with empty providers → disables providers without exiting', async () => {
      process.env.ENABLED_PROVIDERS = '';
      mockedRequestMainBusinessApiGet.mockResolvedValue({
        response: {
          data: {
            deploymentMode: 'local',
            storageDriver: 'local',
            features: { ai3dGenerator: false },
          },
        },
        target: 'http://api/v1/system/deployment',
      } as never);

      await expect(resolveEnabledProviders()).resolves.toEqual([]);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('main deployment local → disables providers even when ENABLED_PROVIDERS is configured', async () => {
      process.env.ENABLED_PROVIDERS = 'tripo3d,hyper3d';
      mockedRequestMainBusinessApiGet.mockResolvedValue({
        response: {
          data: {
            deploymentMode: 'local',
            storageDriver: 'local',
            features: { ai3dGenerator: false },
          },
        },
        target: 'http://api/v1/system/deployment',
      } as never);

      await expect(resolveEnabledProviders()).resolves.toEqual([]);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('main deployment cloud with empty providers → keeps existing fatal validation', async () => {
      process.env.ENABLED_PROVIDERS = '';
      mockedRequestMainBusinessApiGet.mockResolvedValue({
        response: {
          data: {
            deploymentMode: 'cloud',
            storageDriver: 'cos',
            features: { ai3dGenerator: true },
          },
        },
        target: 'http://api/v1/system/deployment',
      } as never);

      await expect(resolveEnabledProviders()).rejects.toThrow('process.exit(1)');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('main deployment config failure with local env → disables providers', async () => {
      process.env.ENABLED_PROVIDERS = '';
      process.env.DEPLOYMENT_MODE = 'local';
      mockedRequestMainBusinessApiGet.mockRejectedValue(new Error('main api unavailable'));

      await expect(resolveEnabledProviders()).resolves.toEqual([]);
      expect(mockExit).not.toHaveBeenCalled();
    });
  });
});
