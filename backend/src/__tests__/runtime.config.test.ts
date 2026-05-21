import { assertRuntimeConfig, validateRuntimeConfig } from '../config/runtime';

describe('runtime config validation', () => {
  const validCryptoKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('accepts a valid crypto key and prepare token secret', () => {
    const result = validateRuntimeConfig({
      CRYPTO_KEY: validCryptoKey,
      PREPARE_TOKEN_SECRET: 'prepare-token-secret',
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('rejects missing secrets before the server is marked healthy', () => {
    const result = validateRuntimeConfig({});

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining(['CRYPTO_KEY 未配置', 'PREPARE_TOKEN_SECRET 未配置'])
    );
    expect(() => assertRuntimeConfig({})).toThrow(
      expect.objectContaining({
        code: 'SERVER_CONFIG_INVALID',
        status: 503,
      })
    );
  });

  it('rejects malformed crypto keys', () => {
    const result = validateRuntimeConfig({
      CRYPTO_KEY: 'not-hex',
      PREPARE_TOKEN_SECRET: 'prepare-token-secret',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('CRYPTO_KEY 必须是 64 位 hex 字符串');
  });
});
