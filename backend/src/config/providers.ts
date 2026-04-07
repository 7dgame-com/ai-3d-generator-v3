export const KNOWN_PROVIDERS = ['tripo3d', 'hyper3d'] as const;
export type KnownProvider = typeof KNOWN_PROVIDERS[number];

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export function parseEnabledProviders(): string[] {
  const raw = process.env.ENABLED_PROVIDERS ?? '';
  if (!raw.trim()) {
    throw new ProviderConfigError('ENABLED_PROVIDERS must specify at least one valid provider');
  }
  const parsed = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const valid = [...new Set(parsed.filter(p => KNOWN_PROVIDERS.includes(p as KnownProvider)))];
  if (valid.length === 0) {
    throw new ProviderConfigError('No valid providers found in ENABLED_PROVIDERS');
  }
  return valid;
}
