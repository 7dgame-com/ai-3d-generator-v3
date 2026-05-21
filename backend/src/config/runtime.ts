export interface RuntimeConfigValidation {
  ok: boolean;
  errors: string[];
}

export class RuntimeConfigError extends Error {
  code = 'SERVER_CONFIG_INVALID';
  status = 503;
  details: string[];

  constructor(errors: string[]) {
    super(`服务端配置不完整: ${errors.join('; ')}`);
    this.name = 'RuntimeConfigError';
    this.details = errors;
  }
}

export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfigValidation {
  const errors: string[] = [];
  const cryptoKey = env.CRYPTO_KEY ?? '';
  const prepareTokenSecret = env.PREPARE_TOKEN_SECRET ?? '';

  if (!cryptoKey) {
    errors.push('CRYPTO_KEY 未配置');
  } else if (cryptoKey.length !== 64) {
    errors.push('CRYPTO_KEY 必须是 64 位 hex 字符串');
  } else if (!/^[0-9a-fA-F]{64}$/.test(cryptoKey)) {
    errors.push('CRYPTO_KEY 必须是合法 hex 字符串');
  }

  if (!prepareTokenSecret) {
    errors.push('PREPARE_TOKEN_SECRET 未配置');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  const validation = validateRuntimeConfig(env);
  if (!validation.ok) {
    throw new RuntimeConfigError(validation.errors);
  }
}

export function isRuntimeConfigError(error: unknown): error is RuntimeConfigError {
  return error instanceof RuntimeConfigError
    || (typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: string }).code === 'SERVER_CONFIG_INVALID');
}
