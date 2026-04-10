export const KNOWN_PROVIDERS = ['tripo3d', 'hyper3d'] as const;
export type KnownProvider = typeof KNOWN_PROVIDERS[number];

export const PROVIDER_BILLING = {
  tripo3d: {
    creditsPerPower: 30,
    estimatedCreditCost: 30,
  },
  hyper3d: {
    creditsPerPower: 0.5,
    estimatedCreditCost: 0.5,
  },
} as const satisfies Record<KnownProvider, {
  creditsPerPower: number;
  estimatedCreditCost: number;
}>;

export const CREDITS_PER_POWER: Record<KnownProvider, number> = {
  tripo3d: PROVIDER_BILLING.tripo3d.creditsPerPower,
  hyper3d: PROVIDER_BILLING.hyper3d.creditsPerPower,
};

/** Convert provider credits → power. Formula: power = credits / creditsPerPower */
export function creditToPower(providerId: string, creditAmount: number): number {
  const ratio = CREDITS_PER_POWER[providerId as KnownProvider];
  if (ratio === undefined) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return Math.round((creditAmount / ratio) * 100) / 100;
}

/** Convert power → provider credits. Formula: credits = power * creditsPerPower */
export function powerToCredit(providerId: string, powerAmount: number): number {
  const ratio = CREDITS_PER_POWER[providerId as KnownProvider];
  if (ratio === undefined) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return powerAmount * ratio;
}

export function getEstimatedCreditCost(providerId: string): number {
  const billing = PROVIDER_BILLING[providerId as KnownProvider];
  if (!billing) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return billing.estimatedCreditCost;
}

export function parseEnabledProviders(): string[] {
  const raw = process.env.ENABLED_PROVIDERS ?? '';
  if (!raw.trim()) {
    console.error('FATAL: ENABLED_PROVIDERS must specify at least one valid provider');
    process.exit(1);
  }
  const parsed = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const valid = [...new Set(parsed.filter(p => KNOWN_PROVIDERS.includes(p as KnownProvider)))];
  if (valid.length === 0) {
    console.error('FATAL: No valid providers found in ENABLED_PROVIDERS');
    process.exit(1);
  }
  return valid;
}
