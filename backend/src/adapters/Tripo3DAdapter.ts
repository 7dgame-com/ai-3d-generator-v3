import axios from 'axios';
import FormData from 'form-data';
import {
  IProviderAdapter,
  CreateTaskInput,
  CreateTaskOutput,
  TaskStatusOutput,
  ProviderBalance,
} from './IProviderAdapter';
import { REGION_ENDPOINTS, type TripoRegion } from '../services/regionProbe';

const TRIPO_MODEL_VERSION = process.env.TRIPO_MODEL_VERSION || 'P1-20260311';
const TRIPO_IMAGE_FILE_TYPE = 'image';

export type RegionResolver = () => Promise<TripoRegion>;

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

export { TRIPO_MODEL_VERSION, TRIPO_IMAGE_FILE_TYPE };

export class Tripo3DAdapter implements IProviderAdapter {
  readonly providerId = 'tripo3d';
  private readonly regionResolver: RegionResolver;

  constructor(regionOrResolver: TripoRegion | RegionResolver = 'com') {
    this.regionResolver = typeof regionOrResolver === 'function'
      ? regionOrResolver
      : async () => regionOrResolver;
  }

  private async getBaseUrl(): Promise<string> {
    const region = await this.regionResolver();
    return REGION_ENDPOINTS[region];
  }

  validateApiKeyFormat(apiKey: string): boolean {
    return typeof apiKey === 'string' && apiKey.length > 0;
  }

  async verifyApiKey(apiKey: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    try {
      await axios.get(`${baseUrl}/user/balance`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000,
      });
    } catch (err) {
      const detail = describeRequestError(err);
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
    const baseUrl = await this.getBaseUrl();

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
        `${baseUrl}/upload`,
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

    const resp = await axios.post(`${baseUrl}/task`, requestBody, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    if (resp.data?.code !== 0) {
      throw new Error(resp.data?.message ?? 'Tripo3D API 返回错误');
    }

    const taskId: string = resp.data.data.task_id;
    return { taskId, estimatedCost: 30 };
  }

  async getTaskStatus(apiKey: string, taskId: string, _pollingKey?: string): Promise<TaskStatusOutput> {
    const baseUrl = await this.getBaseUrl();
    const responseData = await fetch(`${baseUrl}/task/${taskId}`, {
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
    }>(response));

    const taskData = responseData.data;
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
    const baseUrl = await this.getBaseUrl();
    const resp = await axios.get(`${baseUrl}/user/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });

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
