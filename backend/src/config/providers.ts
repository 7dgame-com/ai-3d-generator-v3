import { requestMainBusinessApiGet } from './mainBusinessApi';

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

interface MainDeploymentConfig {
  deploymentMode?: string;
  storageDriver?: string;
  features?: {
    ai3dGenerator?: boolean;
  };
}

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

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function deploymentDisablesProviders(config: MainDeploymentConfig): boolean {
  const mode = normalize(config.deploymentMode);
  const driver = normalize(config.storageDriver);
  return (
    mode === 'local' ||
    mode === 'private' ||
    driver === 'local' ||
    config.features?.ai3dGenerator === false
  );
}

function envDisablesProviders(env: NodeJS.ProcessEnv): boolean {
  const mode = normalize(env.DEPLOYMENT_MODE);
  const ai3dEnabled = normalize(env.ENABLE_AI_3D_GENERATOR);
  return mode === 'local' || mode === 'private' || ai3dEnabled === 'false' || ai3dEnabled === '0';
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEnabledProvidersFromEnv(env: NodeJS.ProcessEnv): string[] {
  const raw = env.ENABLED_PROVIDERS ?? '';
  if (!raw.trim()) {
    if (envDisablesProviders(env)) {
      console.warn('[Providers] ENABLED_PROVIDERS is empty; provider-backed AI generation is disabled.');
      return [];
    }
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

export function parseEnabledProviders(): string[] {
  return parseEnabledProvidersFromEnv(process.env);
}

async function fetchMainDeploymentConfig(env: NodeJS.ProcessEnv): Promise<MainDeploymentConfig | null> {
  const attempts = parsePositiveInteger(env.MAIN_DEPLOYMENT_CONFIG_RETRIES, 2);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { response } = await requestMainBusinessApiGet<MainDeploymentConfig>('/v1/system/deployment', {
        key: 'ai-3d-generator-v3-deployment-config',
        env,
      });
      return response.data;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  console.warn(`[Providers] Could not load main deployment config: ${message}`);
  return null;
}

export async function resolveEnabledProviders(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const deploymentConfig = await fetchMainDeploymentConfig(env);

  if (deploymentConfig && deploymentDisablesProviders(deploymentConfig)) {
    console.warn('[Providers] Main deployment config disables provider-backed AI generation.');
    return [];
  }

  if (!deploymentConfig && envDisablesProviders(env)) {
    console.warn('[Providers] Local deployment env disables provider-backed AI generation.');
    return [];
  }

  return parseEnabledProvidersFromEnv(env);
}
