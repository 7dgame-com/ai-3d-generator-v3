import * as fc from 'fast-check';
import { parseEnabledProviders, ProviderConfigError } from '../config/providers';

describe('parseEnabledProviders()', () => {
  const originalEnv = process.env.ENABLED_PROVIDERS;

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.ENABLED_PROVIDERS = originalEnv;
  });

  // --- Unit tests ---

  it('empty string → throws ProviderConfigError', () => {
    process.env.ENABLED_PROVIDERS = '';
    expect(() => parseEnabledProviders()).toThrow(ProviderConfigError);
    expect(() => parseEnabledProviders()).toThrow('ENABLED_PROVIDERS must specify at least one valid provider');
  });

  it('whitespace only → throws ProviderConfigError', () => {
    process.env.ENABLED_PROVIDERS = '   ';
    expect(() => parseEnabledProviders()).toThrow(ProviderConfigError);
  });

  it('all invalid values → throws ProviderConfigError', () => {
    process.env.ENABLED_PROVIDERS = 'foo,bar';
    expect(() => parseEnabledProviders()).toThrow(ProviderConfigError);
    expect(() => parseEnabledProviders()).toThrow('No valid providers found in ENABLED_PROVIDERS');
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
});
