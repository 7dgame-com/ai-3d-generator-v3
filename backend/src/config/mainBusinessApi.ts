import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

const DEFAULT_APP_API_URL = 'http://localhost:8081';
const DEFAULT_MAIN_API_TIMEOUT_MS = 5000;
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

export type MainBusinessApiRoutingMode = 'app-api';

export type MainBusinessApiUpstream = {
  url: string;
  weight: number;
  envKey: string;
  weightEnvKey?: string;
};

export type MainBusinessApiConfig = {
  mode: MainBusinessApiRoutingMode;
  timeoutMs: number;
  upstreams: MainBusinessApiUpstream[];
};

export type MainBusinessApiRequestResult<T = unknown> = {
  response: AxiosResponse<T>;
  target: string;
};

type MainBusinessApiError = Error & {
  response?: {
    status?: number;
  };
  target?: string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function parsePositiveInteger(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function collectAppApiUpstreams(env: NodeJS.ProcessEnv): MainBusinessApiUpstream[] {
  const upstreams: MainBusinessApiUpstream[] = [];

  for (let index = 1; ; index += 1) {
    const envKey = `APP_API_${index}_URL`;
    const rawUrl = env[envKey];

    if (!rawUrl) {
      break;
    }

    const weightEnvKey = `APP_API_${index}_WEIGHT`;
    upstreams.push({
      url: trimTrailingSlash(rawUrl.trim()),
      weight: parsePositiveInteger(env[weightEnvKey], 1),
      envKey,
      weightEnvKey,
    });
  }

  return upstreams;
}

export function resolveMainBusinessApiConfig(env: NodeJS.ProcessEnv = process.env): MainBusinessApiConfig {
  const appApiUpstreams = collectAppApiUpstreams(env);

  if (appApiUpstreams.length > 0) {
    return {
      mode: 'app-api',
      timeoutMs: parsePositiveInteger(env.MAIN_API_TIMEOUT_MS, DEFAULT_MAIN_API_TIMEOUT_MS),
      upstreams: appApiUpstreams,
    };
  }

  return {
    mode: 'app-api',
    timeoutMs: parsePositiveInteger(env.MAIN_API_TIMEOUT_MS, DEFAULT_MAIN_API_TIMEOUT_MS),
    upstreams: [{
      url: DEFAULT_APP_API_URL,
      weight: 1,
      envKey: 'APP_API_1_URL',
    }],
  };
}

export function getMainBusinessApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return resolveMainBusinessApiConfig(env).upstreams[0].url;
}

export function buildMainBusinessApiUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const baseUrl = getMainBusinessApiBaseUrl(env);
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function hashString(input: string): number {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash * 31) + input.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getMainBusinessApiAttemptOrder(
  key: string,
  upstreams: MainBusinessApiUpstream[],
): MainBusinessApiUpstream[] {
  if (upstreams.length <= 1) {
    return upstreams;
  }

  const totalWeight = upstreams.reduce((sum, upstream) => sum + upstream.weight, 0);
  const bucket = hashString(key) % totalWeight;

  let cumulativeWeight = 0;
  let startIndex = upstreams.length - 1;

  for (let index = 0; index < upstreams.length; index += 1) {
    cumulativeWeight += upstreams[index].weight;
    if (bucket < cumulativeWeight) {
      startIndex = index;
      break;
    }
  }

  return upstreams.map((_, offset) => upstreams[(startIndex + offset) % upstreams.length]);
}

function shouldRetryMainBusinessApiError(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null && 'response' in error
    ? (error as { response?: { status?: number } }).response?.status
    : undefined;

  if (status === undefined) {
    return true;
  }

  return RETRYABLE_STATUS_CODES.has(status);
}

function attachTargetToError(error: unknown, target: string): MainBusinessApiError {
  if (typeof error === 'object' && error !== null) {
    return Object.assign(error, { target }) as MainBusinessApiError;
  }

  return Object.assign(new Error('Main business API request failed'), {
    cause: error,
    target,
  }) as MainBusinessApiError;
}

export async function requestMainBusinessApiGet<T = unknown>(
  path: string,
  options: {
    key: string;
    headers?: AxiosRequestConfig['headers'];
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<MainBusinessApiRequestResult<T>> {
  const config = resolveMainBusinessApiConfig(options.env);
  const candidates = getMainBusinessApiAttemptOrder(options.key, config.upstreams);
  let lastError: MainBusinessApiError | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const target = `${candidates[index].url}${path.startsWith('/') ? path : `/${path}`}`;

    try {
      const response = await axios.get<T>(target, {
        headers: options.headers,
        timeout: options.timeoutMs ?? config.timeoutMs,
      });

      return { response, target };
    } catch (error) {
      lastError = attachTargetToError(error, target);

      const isLastAttempt = index === candidates.length - 1;
      if (isLastAttempt || !shouldRetryMainBusinessApiError(error)) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error('No main business API upstream available');
}
