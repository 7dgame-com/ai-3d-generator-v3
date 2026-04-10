import type {
  CreateTaskInput,
  CreateTaskOutput,
  IFrontendProviderAdapter,
  TaskStatusOutput,
} from './IFrontendProviderAdapter'
import { getEstimatedCreditCost } from '../utils/providerBilling'

interface HyperCreateResponse {
  uuid?: string
  jobs?: { subscription_key?: string } | Array<{ subscription_key?: string }>
  error?: string
}

interface HyperStatusResponse {
  jobs?: Array<{ status?: string }>
  error?: string
}

interface HyperDownloadResponse {
  list?: Array<{ url?: string; type?: string; filename?: string; name?: string }>
  error?: string
}

const MAX_RENDER_WAIT_POLLS = 10
const renderWaitCounts = new Map<string, number>()

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return (await response.json()) as T
}

export class Hyper3DFrontendAdapter implements IFrontendProviderAdapter {
  readonly providerId = 'hyper3d'

  async createTask(apiKey: string, input: CreateTaskInput, apiBaseUrl: string): Promise<CreateTaskOutput> {
    const form = new FormData()
    form.append('tier', 'Gen-2')
    form.append('geometry_file_format', 'glb')
    form.append('material', 'PBR')
    form.append('quality', 'high')
    form.append('mesh_mode', 'Quad')
    form.append('preview_render', 'true')

    if (input.prompt) {
      form.append('prompt', input.prompt)
    }

    if (input.type === 'image_to_model' && input.imageFile) {
      form.append('images', input.imageFile, input.imageFile.name)
    }

    const response = await fetch(`${apiBaseUrl}/rodin`, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    })
    const json = await parseJsonResponse<HyperCreateResponse>(response)

    if (json.error) {
      throw new Error(json.error)
    }
    if (!json.uuid) {
      throw new Error('Hyper3D API 未返回任务 ID')
    }

    const pollingKey = Array.isArray(json.jobs)
      ? json.jobs[0]?.subscription_key
      : json.jobs?.subscription_key

    return {
      taskId: json.uuid,
      pollingKey: pollingKey ?? json.uuid,
      estimatedCreditCost: getEstimatedCreditCost(this.providerId),
    }
  }

  async getTaskStatus(
    apiKey: string,
    taskId: string,
    apiBaseUrl: string,
    pollingKey?: string
  ): Promise<TaskStatusOutput> {
    const response = await fetch(`${apiBaseUrl}/status`, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ subscription_key: pollingKey ?? taskId }),
    })
    const statusJson = await parseJsonResponse<HyperStatusResponse>(response)

    if (statusJson.error) {
      throw new Error(statusJson.error)
    }

    const jobs = statusJson.jobs ?? []
    if (jobs.length === 0) {
      return { status: 'queued', progress: 0 }
    }

    if (jobs.some((job) => job.status === 'Failed')) {
      renderWaitCounts.delete(taskId)
      return { status: 'failed', progress: 0, errorMessage: '任务生成失败' }
    }

    const doneCount = jobs.filter((job) => job.status === 'Done').length
    const progress = Math.round((doneCount / jobs.length) * 100)

    if (doneCount === jobs.length) {
      const downloadResponse = await fetch(`${apiBaseUrl}/download`, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ task_uuid: taskId }),
      })
      const downloadJson = await parseJsonResponse<HyperDownloadResponse>(downloadResponse)
      if (downloadJson.error) {
        throw new Error(downloadJson.error)
      }

      const file = downloadJson.list?.find(
        (item) =>
          item.filename?.endsWith('.glb') ||
          item.name?.endsWith('.glb') ||
          item.type === 'glb'
      )

      if (!file) {
        renderWaitCounts.delete(taskId)
        return { status: 'processing', progress: 90 }
      }

      const renderThumbnail = downloadJson.list?.find(
        (item) => item.filename === 'render.jpg' || item.name === 'render.jpg'
      )
      const previewThumbnail = downloadJson.list?.find(
        (item) =>
          item.filename?.includes('preview.webp') ||
          item.name?.includes('preview.webp') ||
          item.url?.includes('preview.webp')
      )

      if (!renderThumbnail && previewThumbnail) {
        const nextWaitCount = (renderWaitCounts.get(taskId) ?? 0) + 1
        renderWaitCounts.set(taskId, nextWaitCount)
        if (nextWaitCount <= MAX_RENDER_WAIT_POLLS) {
          return { status: 'processing', progress: 95 }
        }
      }

      renderWaitCounts.delete(taskId)
      return {
        status: 'success',
        progress: 100,
        creditCost: getEstimatedCreditCost(this.providerId),
        outputUrl: file.url,
        thumbnailUrl: renderThumbnail?.url ?? previewThumbnail?.url,
      }
    }

    renderWaitCounts.delete(taskId)
    return {
      status: 'processing',
      progress,
    }
  }
}
