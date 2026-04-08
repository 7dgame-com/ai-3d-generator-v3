import axios from 'axios';
import FormData from 'form-data';
import {
  IProviderAdapter,
  CreateTaskInput,
  CreateTaskOutput,
  TaskStatusOutput,
  ProviderBalance,
} from './IProviderAdapter';

const HYPER3D_API_BASE = process.env.HYPER3D_API_BASE || 'https://api.hyper3d.com/api/v2';
const MAX_RENDER_WAIT_POLLS = 10;
const renderWaitCounts = new Map<string, number>();

interface HyperTaskPair {
  uuid: string;
  status: string;
}

interface HyperCreateResponse {
  uuid?: string;
  jobs?: { subscription_key?: string } | Array<{ subscription_key?: string }>;
  error?: string;
}

interface HyperStatusResponse {
  jobs?: HyperTaskPair[];
  error?: string;
}

interface HyperDownloadResponse {
  list?: Array<{ url?: string; type?: string; filename?: string; name?: string }>;
  error?: string;
}

interface HyperBalanceResponse {
  balance?: number;
  remaining_balance?: number;
  error?: string;
}

export class Hyper3DAdapter implements IProviderAdapter {
  readonly providerId = 'hyper3d';

  validateApiKeyFormat(apiKey: string): boolean {
    return typeof apiKey === 'string' && apiKey.trim().length > 0;
  }

  async verifyApiKey(apiKey: string): Promise<void> {
    try {
      await this.getBalance(apiKey);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          throw Object.assign(new Error('API Key 无效或无权限'), { code: 4001, status: 422 });
        }
      }
      throw error;
    }
  }

  async createTask(apiKey: string, input: CreateTaskInput): Promise<CreateTaskOutput> {
    const form = new FormData();
    form.append('tier', 'Gen-2');
    form.append('geometry_file_format', 'glb');
    form.append('material', 'PBR');
    form.append('quality', 'high');
    form.append('mesh_mode', 'Quad');
    form.append('preview_render', 'true');

    if (input.prompt) {
      form.append('prompt', input.prompt);
    }

    if (input.type === 'image_to_model' && input.imageBase64) {
      const buffer = Buffer.from(input.imageBase64, 'base64');
      form.append('images', buffer, {
        filename: 'reference',
        contentType: input.mimeType ?? 'image/png',
      });
    }

    const response = await axios.post<HyperCreateResponse>(`${HYPER3D_API_BASE}/rodin`, form, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      timeout: 60000,
    });

    if (response.data?.error) {
      throw new Error(response.data.error);
    }

    console.log('[Hyper3DAdapter] createTask response:', JSON.stringify(response.data));

    const taskId = response.data?.uuid;
    const pollingKey = Array.isArray(response.data?.jobs)
      ? response.data?.jobs?.[0]?.subscription_key
      : response.data?.jobs?.subscription_key;

    if (!taskId) {
      throw new Error('Hyper3D API 未返回任务 ID');
    }

    return { taskId, pollingKey: pollingKey ?? taskId, estimatedCost: 1 };
  }

  async getTaskStatus(apiKey: string, taskId: string, pollingKey?: string): Promise<TaskStatusOutput> {
    const response = await axios.post<HyperStatusResponse>(
      `${HYPER3D_API_BASE}/status`,
      { subscription_key: pollingKey ?? taskId },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        timeout: 15000,
      }
    );

    if (response.data?.error) {
      throw new Error(response.data.error);
    }

    const jobs = response.data?.jobs ?? [];
    if (jobs.length === 0) {
      return {
        status: 'queued',
        progress: 0,
      };
    }

    if (jobs.some((job) => job.status === 'Failed')) {
      renderWaitCounts.delete(taskId);
      return {
        status: 'failed',
        progress: 0,
        errorMessage: '任务生成失败',
      };
    }

    const doneCount = jobs.filter((job) => job.status === 'Done').length;
    const progress = Math.round((doneCount / jobs.length) * 100);

    if (doneCount === jobs.length) {
      const download = await axios.post<HyperDownloadResponse>(
        `${HYPER3D_API_BASE}/download`,
        { task_uuid: taskId },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
          timeout: 15000,
        }
      );

      const file =
        download.data?.list?.find(
          (item) => item.filename?.endsWith('.glb') || item.name?.endsWith('.glb') || item.type === 'glb'
        );

      // 记录 download 列表，便于调试缩略图匹配
      console.log('[Hyper3DAdapter] download list names:', download.data?.list?.map((i) => i.name ?? i.filename));

      // Gen-2 可能 status=Done 但 glb 还在打包中，此时继续轮询
      if (!file) {
        renderWaitCounts.delete(taskId);
        return {
          status: 'processing',
          progress: 90,
        };
      }

      const renderThumbnail = download.data?.list?.find(
          (item) =>
            item.filename === 'render.jpg' ||
            item.name === 'render.jpg'
        );
      const previewThumbnail = download.data?.list?.find(
          (item) =>
            item.filename?.includes('preview.webp') ||
            item.name?.includes('preview.webp') ||
            item.url?.includes('preview.webp')
        );

      if (!renderThumbnail && previewThumbnail) {
        const nextWaitCount = (renderWaitCounts.get(taskId) ?? 0) + 1;
        renderWaitCounts.set(taskId, nextWaitCount);

        if (nextWaitCount <= MAX_RENDER_WAIT_POLLS) {
          console.log(
            `[Hyper3DAdapter] glb ready but render.jpg not yet available, continuing poll (attempt ${nextWaitCount}/${MAX_RENDER_WAIT_POLLS})`
          );
          return {
            status: 'processing',
            progress: 95,
          };
        }

        console.log(
          `[Hyper3DAdapter] render.jpg still missing after ${MAX_RENDER_WAIT_POLLS} polls, falling back to preview.webp`
        );
      }

      renderWaitCounts.delete(taskId);

      return {
        status: 'success',
        progress: 100,
        creditCost: 0.5,
        outputUrl: file?.url,
        thumbnailUrl: renderThumbnail?.url ?? previewThumbnail?.url,
      };
    }

    renderWaitCounts.delete(taskId);
    return {
      status: 'processing',
      progress,
    };
  }

  async getBalance(apiKey: string): Promise<ProviderBalance> {
    const response = await axios.get<HyperBalanceResponse>(`${HYPER3D_API_BASE}/check_balance`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      timeout: 10000,
    });

    if (response.data?.error) {
      throw new Error(response.data.error);
    }

    return {
      available: Number(response.data?.remaining_balance ?? response.data?.balance ?? 0),
      frozen: 0,
    };
  }
}

export const hyper3dAdapter = new Hyper3DAdapter();
