import axios from 'axios';
import FormData from 'form-data';
import {
  IProviderAdapter,
  CreateTaskInput,
  CreateTaskOutput,
  TaskStatusOutput,
  ProviderBalance,
} from './IProviderAdapter';

const TRIPO_API_BASES = [
  'https://api.tripo3d.com/v2/openapi',
  'https://api.tripo3d.ai/v2/openapi',
] as const;
const TRIPO_MODEL_VERSION = process.env.TRIPO_MODEL_VERSION || 'P1-20260311';
const TRIPO_IMAGE_FILE_TYPE = 'image';
const TRIPO_POLLING_KEY_PREFIX = 'tripo-base:';

type FallbackAttempt = {
  baseUrl: string;
  detail: string;
};

type FallbackAwareError = Error & {
  status?: number;
  code?: string | number;
  detail?: string;
  fallbackAttempts?: FallbackAttempt[];
};

function getOrderedBaseUrls(preferredBaseUrl?: string): string[] {
  if (!preferredBaseUrl || !TRIPO_API_BASES.includes(preferredBaseUrl as (typeof TRIPO_API_BASES)[number])) {
    return [...TRIPO_API_BASES];
  }

  return [
    preferredBaseUrl,
    ...TRIPO_API_BASES.filter((baseUrl) => baseUrl !== preferredBaseUrl),
  ];
}

function extractPollingBaseUrl(pollingKey?: string): string | undefined {
  if (!pollingKey || !pollingKey.startsWith(TRIPO_POLLING_KEY_PREFIX)) {
    return undefined;
  }

  const baseUrl = pollingKey.slice(TRIPO_POLLING_KEY_PREFIX.length);
  return TRIPO_API_BASES.includes(baseUrl as (typeof TRIPO_API_BASES)[number]) ? baseUrl : undefined;
}

function createPollingKey(baseUrl: string): string {
  return `${TRIPO_POLLING_KEY_PREFIX}${baseUrl}`;
}

function summarizeBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function extractResponseMessage(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim();
  }

  if (typeof data === 'object' && data !== null) {
    const message = 'message' in data ? data.message : undefined;
    if (typeof message === 'string') {
      return message.trim();
    }
  }

  return '';
}

function joinErrorParts(parts: Array<string | undefined>): string {
  return [...new Set(parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)))].join(' ');
}

function describeRequestError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return joinErrorParts([
      typeof error.response?.status === 'number' ? `HTTP ${error.response.status}` : undefined,
      extractResponseMessage(error.response?.data),
      typeof error.code === 'string' ? error.code : undefined,
      error.message,
    ]) || 'Unknown Axios error';
  }

  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: number }).status)
    : NaN;

  if (Number.isFinite(status)) {
    const typedError = error as { message?: string };
    return joinErrorParts([`HTTP ${status}`, typedError.message]) || `HTTP ${status}`;
  }

  if (error instanceof Error) {
    return error.message.trim() || error.name || 'Unknown error';
  }

  if (typeof error === 'string') {
    return error.trim() || 'Unknown error';
  }

  return 'Unknown error';
}

function formatFallbackAttempts(attempts: FallbackAttempt[]): string {
  return attempts
    .map(({ baseUrl, detail }) => `${summarizeBaseUrl(baseUrl)} -> ${detail}`)
    .join(' | ');
}

function enrichErrorWithFallbackAttempts(error: unknown, attempts: FallbackAttempt[]): FallbackAwareError {
  const detail = formatFallbackAttempts(attempts) || describeRequestError(error);

  if (error instanceof Error) {
    const typedError = error as FallbackAwareError;
    typedError.detail = detail;
    typedError.fallbackAttempts = attempts;
    return typedError;
  }

  return Object.assign(new Error(detail), {
    detail,
    fallbackAttempts: attempts,
  });
}

function shouldRetryOnAlternateBase(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    // Tripo has served valid keys on the .ai base while the .com base rejects
    // the same credential during endpoint migration. Retry auth failures once
    // on the alternate base before treating the key as invalid.
    if (status === 422) {
      return false;
    }

    if (typeof status === 'number') {
      return status === 401 || status === 403 || status >= 500 || status === 404;
    }

    return true;
  }

  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: number }).status)
    : NaN;

  if (Number.isFinite(status)) {
    return status === 401 || status === 403 || status >= 500 || status === 404;
  }

  return error instanceof Error;
}

async function withBaseFallback<T>(
  request: (baseUrl: string) => Promise<T>,
  preferredBaseUrl?: string,
  operationName = 'request'
): Promise<{ result: T; baseUrl: string }> {
  const baseUrls = getOrderedBaseUrls(preferredBaseUrl);
  let lastError: unknown;
  const attempts: FallbackAttempt[] = [];

  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseUrl = baseUrls[index];

    try {
      return {
        result: await request(baseUrl),
        baseUrl,
      };
    } catch (error) {
      lastError = error;
      const isLastBase = index === baseUrls.length - 1;
      const detail = describeRequestError(error);
      const shouldRetry = !isLastBase && shouldRetryOnAlternateBase(error);
      attempts.push({ baseUrl, detail });

      console.warn(`[Tripo3DAdapter] ${operationName} failed on ${summarizeBaseUrl(baseUrl)}`, {
        retryingAlternateBase: shouldRetry,
        detail,
      });

      if (!shouldRetry) {
        const enrichedError = enrichErrorWithFallbackAttempts(error, attempts);
        console.error(`[Tripo3DAdapter] ${operationName} exhausted Tripo base fallback`, {
          attempts,
        });
        throw enrichedError;
      }
    }
  }

  throw enrichErrorWithFallbackAttempts(lastError, attempts);
}

async function parseFetchJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

function getUploadFilename(mimeType?: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'upload.jpg';
    case 'image/webp':
      return 'upload.webp';
    case 'image/png':
      return 'upload.png';
    default:
      return 'upload-image';
  }
}

export class Tripo3DAdapter implements IProviderAdapter {
  readonly providerId = 'tripo3d';

  validateApiKeyFormat(apiKey: string): boolean {
    return typeof apiKey === 'string' && apiKey.length > 0;
  }

  async verifyApiKey(apiKey: string): Promise<void> {
    try {
      await withBaseFallback((baseUrl) =>
        axios.get(`${baseUrl}/user/balance`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        })
      , undefined, 'verifyApiKey');
    } catch (err) {
      const detail = (err as FallbackAwareError).detail || describeRequestError(err);
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 401 || status === 403) {
          throw Object.assign(new Error('API Key 无效或无权限'), { code: 4001, status: 422 });
        }
        throw Object.assign(new Error('AI 服务暂时不可用'), { code: 3002, status: 502, detail });
      }
      throw Object.assign(new Error('AI 服务暂时不可用'), { code: 3002, status: 502, detail });
    }
  }

  async createTask(apiKey: string, input: CreateTaskInput): Promise<CreateTaskOutput> {
    const { type, prompt, imageBase64, mimeType } = input;

    const { result, baseUrl } = await withBaseFallback(async (activeBaseUrl) => {
      let requestBody: Record<string, unknown>;

      if (type === 'text_to_model') {
        requestBody = { type: 'text_to_model', model_version: TRIPO_MODEL_VERSION, prompt };
      } else {
        // image_to_model: upload image first to get a file token
        const uploadFormData = new FormData();
        uploadFormData.append('file', Buffer.from(imageBase64 ?? '', 'base64'), {
          filename: getUploadFilename(mimeType),
          contentType: mimeType,
        });
        const uploadResp = await axios.post(
          `${activeBaseUrl}/upload`,
          uploadFormData,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              ...uploadFormData.getHeaders(),
            },
            timeout: 30000,
          }
        );
        const imageToken: string = uploadResp.data?.data?.image_token;
        requestBody = {
          type: 'image_to_model',
          model_version: TRIPO_MODEL_VERSION,
          file: { type: TRIPO_IMAGE_FILE_TYPE, file_token: imageToken },
        };
      }

      const resp = await axios.post(`${activeBaseUrl}/task`, requestBody, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      if (resp.data?.code !== 0) {
        throw new Error(resp.data?.message ?? 'Tripo3D API 返回错误');
      }

      return resp.data;
    }, undefined, 'createTask');

    const taskId: string = result.data.task_id;
    return { taskId, pollingKey: createPollingKey(baseUrl), estimatedCost: 30 };
  }

  async getTaskStatus(apiKey: string, taskId: string, pollingKey?: string): Promise<TaskStatusOutput> {
    const preferredBaseUrl = extractPollingBaseUrl(pollingKey);
    const { result: responseData } = await withBaseFallback((baseUrl) =>
      fetch(`${baseUrl}/task/${taskId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }).then((response) => parseFetchJson<{
        code: number;
        data?: {
          task_id: string;
          status: string;
          progress?: number;
          thumbnail?: string;
          output?: {
            model?: string;
            pbr_model?: string;
            rendered_image?: string | { url?: string };
          };
          result?: {
            credit_cost?: number;
            pbr_model?: { url?: string; type?: string };
            rendered_image?: { url?: string; type?: string };
          };
        };
      }>(response))
    , preferredBaseUrl, 'getTaskStatus');

    const typedResponseData = responseData as {
      code: number;
      data?: {
        task_id: string;
        status: string;
        progress?: number;
        thumbnail?: string;
        output?: {
          model?: string;
          pbr_model?: string;
          rendered_image?: string | { url?: string };
        };
        result?: {
          credit_cost?: number;
          pbr_model?: { url?: string; type?: string };
          rendered_image?: { url?: string; type?: string };
        };
      };
    };

    const taskData = typedResponseData.data;
    if (!taskData) {
      throw new Error('Tripo3D API 返回数据为空');
    }

    const rawStatus = taskData.status;
    let status: TaskStatusOutput['status'];
    if (rawStatus === 'success') {
      status = 'success';
    } else if (rawStatus === 'failed') {
      status = 'failed';
    } else if (rawStatus === 'processing' || rawStatus === 'running') {
      status = 'processing';
    } else {
      status = 'queued';
    }

    const outputUrl =
      taskData.result?.pbr_model?.url ??
      taskData.output?.pbr_model ??
      taskData.output?.model;
    const thumbnailUrl =
      taskData.thumbnail ??
      taskData.result?.rendered_image?.url ??
      (typeof taskData.output?.rendered_image === 'string'
        ? taskData.output.rendered_image
        : taskData.output?.rendered_image?.url);

    return {
      status,
      progress: taskData.progress ?? 0,
      creditCost: taskData.result?.credit_cost,
      outputUrl,
      thumbnailUrl,
      errorMessage: status === 'failed' ? '任务生成失败' : undefined,
    };
  }

  async getBalance(apiKey: string): Promise<ProviderBalance> {
    const { result: resp } = await withBaseFallback((baseUrl) =>
      axios.get(`${baseUrl}/user/balance`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000,
      })
    , undefined, 'getBalance');

    const data = resp.data?.data ?? resp.data;
    const balancePayload =
      typeof data?.balance === 'object' && data?.balance !== null
        ? data.balance
        : data;
    const available =
      typeof data?.balance === 'number'
        ? data.balance
        : Number(balancePayload?.available ?? balancePayload?.balance ?? 0);
    const frozen =
      typeof data?.frozen === 'number'
        ? data.frozen
        : Number(balancePayload?.frozen ?? 0);

    return {
      available,
      frozen,
    };
  }
}

export const tripo3dAdapter = new Tripo3DAdapter();
