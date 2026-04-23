import type {
  CreateTaskInput,
  CreateTaskOutput,
  IFrontendProviderAdapter,
  TaskStatusOutput,
} from './IFrontendProviderAdapter'
import { getEstimatedCreditCost } from '../utils/providerBilling'

const TRIPO_MODEL_VERSION = 'P1-20260311'
const TRIPO_IMAGE_FILE_TYPE = 'image'
const TRIPO_API_BASE = '/tripo'
const TRIPO_ALT_API_BASE = '/tripo-alt'
const TRIPO_API_BASE_URL = 'https://api.tripo3d.com/v2/openapi'
const TRIPO_ALT_API_BASE_URL = 'https://api.tripo3d.ai/v2/openapi'
const TRIPO_POLLING_KEY_PREFIX = 'tripo-base:'

interface TripoResponseBody {
  code?: number
  message?: string
  data?: {
    task_id?: string
    image_token?: string
    status?: string
    progress?: number
    thumbnail?: string
    output?: {
      model?: string
      pbr_model?: string
      rendered_image?: string | { url?: string }
    }
    result?: {
      credit_cost?: number
      pbr_model?: { url?: string }
      rendered_image?: { url?: string }
    }
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return (await response.json()) as T
}

function getTripoApiBaseCandidates(apiBaseUrl: string): string[] {
  if (apiBaseUrl === TRIPO_API_BASE) {
    return [TRIPO_API_BASE, TRIPO_ALT_API_BASE]
  }

  if (apiBaseUrl === TRIPO_ALT_API_BASE) {
    return [TRIPO_ALT_API_BASE, TRIPO_API_BASE]
  }

  return [apiBaseUrl]
}

function getCanonicalTripoApiBase(apiBaseUrl: string): string {
  if (apiBaseUrl === TRIPO_API_BASE) {
    return TRIPO_API_BASE_URL
  }

  if (apiBaseUrl === TRIPO_ALT_API_BASE) {
    return TRIPO_ALT_API_BASE_URL
  }

  return apiBaseUrl
}

function getProxyTripoApiBase(apiBaseUrl: string): string | undefined {
  if (apiBaseUrl === TRIPO_API_BASE || apiBaseUrl === TRIPO_API_BASE_URL) {
    return TRIPO_API_BASE
  }

  if (apiBaseUrl === TRIPO_ALT_API_BASE || apiBaseUrl === TRIPO_ALT_API_BASE_URL) {
    return TRIPO_ALT_API_BASE
  }

  return undefined
}

function createPollingKey(apiBaseUrl: string): string {
  return `${TRIPO_POLLING_KEY_PREFIX}${getCanonicalTripoApiBase(apiBaseUrl)}`
}

function getPreferredTripoApiBase(apiBaseUrl: string, pollingKey?: string): string {
  if (!pollingKey || !pollingKey.startsWith(TRIPO_POLLING_KEY_PREFIX)) {
    return apiBaseUrl
  }

  const hintedBaseUrl = pollingKey.slice(TRIPO_POLLING_KEY_PREFIX.length)
  return getProxyTripoApiBase(hintedBaseUrl) ?? apiBaseUrl
}

function shouldRetryOnAlternateBase(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: number }).status)
    : Number.NaN

  if (Number.isFinite(status)) {
    return status === 401 || status === 403 || status >= 500 || status === 404
  }

  return error instanceof Error
}

async function withApiBaseFallback<T>(
  apiBaseUrl: string,
  request: (activeBaseUrl: string) => Promise<T>
): Promise<{ result: T; apiBaseUrl: string }> {
  const candidates = getTripoApiBaseCandidates(apiBaseUrl)
  let lastError: unknown

  for (let index = 0; index < candidates.length; index += 1) {
    const activeBaseUrl = candidates[index]

    try {
      return {
        result: await request(activeBaseUrl),
        apiBaseUrl: activeBaseUrl,
      }
    } catch (error) {
      lastError = error
      const isLastCandidate = index === candidates.length - 1
      if (isLastCandidate || !shouldRetryOnAlternateBase(error)) {
        throw error
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Tripo3D API 返回错误')
}

function createUploadFormData(file: File): FormData {
  const formData = new FormData()
  formData.append('file', file, file.name || 'upload-image')
  return formData
}

export class Tripo3DFrontendAdapter implements IFrontendProviderAdapter {
  readonly providerId = 'tripo3d'

  async createTask(apiKey: string, input: CreateTaskInput, apiBaseUrl: string): Promise<CreateTaskOutput> {
    const { result, apiBaseUrl: activeBaseUrl } = await withApiBaseFallback(apiBaseUrl, async (resolvedApiBaseUrl) => {
      if (input.type === 'text_to_model') {
        const response = await fetch(`${resolvedApiBaseUrl}/task`, {
          method: 'POST',
          credentials: 'omit',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'text_to_model',
            model_version: TRIPO_MODEL_VERSION,
            prompt: input.prompt,
          }),
        })
        const json = await parseJsonResponse<TripoResponseBody>(response)
        if (json.code !== 0 || !json.data?.task_id) {
          throw new Error(json.message ?? 'Tripo3D API 返回错误')
        }
        return {
          taskId: json.data.task_id,
          estimatedCreditCost: getEstimatedCreditCost(this.providerId),
        }
      }

      if (!input.imageFile) {
        throw new Error('image_to_model 缺少 imageFile')
      }

      const uploadFormData = createUploadFormData(input.imageFile)
      const uploadResponse = await fetch(`${resolvedApiBaseUrl}/upload`, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: uploadFormData,
      })
      const uploadJson = await parseJsonResponse<TripoResponseBody>(uploadResponse)
      const imageToken = uploadJson.data?.image_token
      if (!imageToken) {
        throw new Error('Tripo3D 上传图片失败')
      }

      const createResponse = await fetch(`${resolvedApiBaseUrl}/task`, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'image_to_model',
          model_version: TRIPO_MODEL_VERSION,
          file: {
            type: TRIPO_IMAGE_FILE_TYPE,
            file_token: imageToken,
          },
        }),
      })
      const createJson = await parseJsonResponse<TripoResponseBody>(createResponse)
      if (createJson.code !== 0 || !createJson.data?.task_id) {
        throw new Error(createJson.message ?? 'Tripo3D API 返回错误')
      }

      return {
        taskId: createJson.data.task_id,
        estimatedCreditCost: getEstimatedCreditCost(this.providerId),
      }
    })

    return {
      ...result,
      pollingKey: createPollingKey(activeBaseUrl),
    }
  }

  async getTaskStatus(apiKey: string, taskId: string, apiBaseUrl: string, pollingKey?: string): Promise<TaskStatusOutput> {
    const preferredApiBaseUrl = getPreferredTripoApiBase(apiBaseUrl, pollingKey)
    const { result: json } = await withApiBaseFallback(preferredApiBaseUrl, async (resolvedApiBaseUrl) => {
      const response = await fetch(`${resolvedApiBaseUrl}/task/${taskId}`, {
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
      return parseJsonResponse<TripoResponseBody>(response)
    })
    const taskData = json.data
    if (!taskData) {
      throw new Error('Tripo3D API 返回数据为空')
    }

    const rawStatus = taskData.status
    let status: TaskStatusOutput['status']
    if (rawStatus === 'success') {
      status = 'success'
    } else if (rawStatus === 'failed') {
      status = 'failed'
    } else if (rawStatus === 'processing' || rawStatus === 'running') {
      status = 'processing'
    } else {
      status = 'queued'
    }

    const outputUrl =
      taskData.result?.pbr_model?.url ??
      taskData.output?.pbr_model ??
      taskData.output?.model
    const thumbnailUrl =
      taskData.thumbnail ??
      taskData.result?.rendered_image?.url ??
      (typeof taskData.output?.rendered_image === 'string'
        ? taskData.output.rendered_image
        : taskData.output?.rendered_image?.url)

    return {
      status,
      progress: taskData.progress ?? 0,
      creditCost: taskData.result?.credit_cost,
      outputUrl,
      thumbnailUrl,
      errorMessage: status === 'failed' ? '任务生成失败' : undefined,
    }
  }
}
