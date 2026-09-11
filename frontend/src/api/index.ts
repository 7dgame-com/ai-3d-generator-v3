import axios from 'axios'
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import {
  getToken,
  isInIframe,
  requestParentTokenRefresh,
  setToken,
} from '../utils/token'

function resolveBackendBaseURL(): string {
  const configuredBaseURL = import.meta.env.VITE_BACKEND_BASE_URL
  if (configuredBaseURL) {
    return configuredBaseURL
  }

  return '/backend'
}

export const backendApi = axios.create({
  baseURL: resolveBackendBaseURL(),
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
})

export const mainApi = axios.create({
  baseURL: '/api',
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
})

type ApiErrorPayload = {
  message?: string
  errors?: string[]
  detail?: string
}

let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (error: Error) => void
}> = []
let bootstrapTokenPromise: Promise<string | null> | null = null

function processQueue(error: Error | null, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error || !token) {
      reject(error ?? new Error('Token refresh failed'))
    } else {
      resolve(token)
    }
  })
  failedQueue = []
}

async function getRequestToken(): Promise<string | null> {
  const token = getToken()
  if (token) return token

  if (!isInIframe()) {
    return null
  }

  if (!bootstrapTokenPromise) {
    bootstrapTokenPromise = requestParentTokenRefresh()
      .then((result) => {
        const accessToken = result?.accessToken ?? getToken()
        if (accessToken) {
          setToken(accessToken)
        }
        return accessToken
      })
      .finally(() => {
        bootstrapTokenPromise = null
      })
  }

  return bootstrapTokenPromise
}

function setupInterceptors(instance: AxiosInstance) {
  instance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const token = await getRequestToken()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
      const apiError = error as AxiosError<ApiErrorPayload>
      const backendMessage = typeof apiError.response?.data?.message === 'string'
        ? apiError.response.data.message.trim()
        : ''
      const fallbackDetail = Array.isArray(apiError.response?.data?.errors)
        ? apiError.response?.data?.errors.find((item) => typeof item === 'string' && item.trim().length > 0)?.trim() ?? ''
        : ''
      const backendDetail = typeof apiError.response?.data?.detail === 'string'
        ? apiError.response.data.detail.trim()
        : ''
      const resolvedMessage = backendMessage || fallbackDetail || backendDetail
      const shouldAppendDetail = Boolean(
        backendMessage &&
        backendDetail &&
        backendDetail !== backendMessage &&
        !backendMessage.includes(backendDetail)
      )
      const surfacedMessage = shouldAppendDetail
        ? `${backendMessage}：${backendDetail}`
        : resolvedMessage

      if (!originalRequest || error.response?.status !== 401 || originalRequest._retry) {
        if (surfacedMessage) {
          error.message = surfacedMessage
        }
        return Promise.reject(error)
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          originalRequest._retry = true
          return instance(originalRequest)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        // Check if TOKEN_UPDATE already delivered a newer token (race condition fix)
        const staleToken = originalRequest.headers.Authorization?.toString().replace('Bearer ', '')
        const currentToken = getToken()
        let freshToken: string | null = null

        if (currentToken && currentToken !== staleToken) {
          // Token was already refreshed via TOKEN_UPDATE broadcast — use it directly
          freshToken = currentToken
        } else if (isInIframe()) {
          // Token not yet updated — request from parent
          const refreshed = await requestParentTokenRefresh()
          freshToken = refreshed?.accessToken ?? null
        }

        if (!freshToken) {
          throw new Error('Token refresh failed')
        }

        setToken(freshToken)
        processQueue(null, freshToken)
        originalRequest.headers.Authorization = `Bearer ${freshToken}`
        return instance(originalRequest)
      } catch (refreshError) {
        // Don't wipe tokens on refresh failure — avoid triggering reload loops.
        // The plugin will get a fresh token on next TOKEN_UPDATE from the host.
        processQueue(
          refreshError instanceof Error ? refreshError : new Error('Token refresh failed'),
          null
        )
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }
  )
}

setupInterceptors(backendApi)
setupInterceptors(mainApi)

export type TaskStatus =
  | 'waiting_provider'
  | 'retry_wait'
  | 'submitting'
  | 'queued'
  | 'processing'
  | 'packaging'
  | 'provider_state_unknown'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'cancelled'

export interface Task {
  taskId: string
  providerId?: string
  directModeTask?: boolean
  type: 'text_to_model' | 'image_to_model'
  prompt: string | null
  status: TaskStatus
  progress: number
  creditCost: number
  powerCost: number
  outputUrl: string | null
  thumbnailUrl: string | null
  thumbnailExpired: boolean
  resourceId: number | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  expiresAt: string | null
  downloadExpired?: boolean
  fileSize?: number | null
  queuePosition?: number | null
  estimatedWaitSeconds?: number | null
  nextAttemptAt?: string | null
  canCancel?: boolean
  queueEnteredAt?: string | null
  errorCategory?: string | null
}

export interface UsageHistoryItem {
  taskId: string
  type: 'text_to_model' | 'image_to_model'
  prompt: string | null
  creditsUsed: number
  powerUsed: number
  createdAt: string
  status: TaskStatus
}

export interface QuotaStatus {
  tool: 'simple-user-usage-quota'
  user_id: number
  quota_limit: number
  used_power: number
  remaining_power: number
  has_record: boolean
  updated_at: string | null
  quota_epoch: number
  user_snapshot?: {
    user_id: number
    username?: string
    nickname?: string | null
    email?: string | null
    status?: number
    roles?: string[]
    organizations?: Array<{
      id?: number
      name?: string
      title?: string
    }>
    captured_at?: string
  } | null
}

export interface QuotaSummary {
  tool: 'simple-user-usage-quota'
  quota_limit: number
  used_user_count: number
  total_used_power: number
  total_remaining_power: number
}

export interface ProviderRuntime {
  providerId: string
  credentialScope: string
  maxConcurrency: number
  activeCount: number
  queueDepth: number
  oldestWait: string | null
  paused: boolean
  pauseReason: string | null
  pollIntervalSeconds: number
  retryLimit: number
  configVersion: number
  updatedAt: string
  configured?: boolean
  statusCounts?: {
    waiting: number
    retry: number
    submitting: number
    queued: number
    processing: number
    packaging: number
    unknown: number
    failed: number
  }
  recentMetrics?: {
    throttleCount: number
    unknownEventCount: number
    lastErrorAt: string | null
    lastErrorType: string | null
  }
}

export interface ProviderQueueTask {
  taskId: string
  providerTaskId: string | null
  userId: number
  providerId: string
  credentialScope: string
  status: TaskStatus
  progress: number
  queueEnteredAt: string | null
  nextAttemptAt: string | null
  attemptCount: number
  priority: number
  slotAcquiredAt: string | null
  slotReleasedAt: string | null
  errorCategory: string | null
  errorCode: string | null
  providerTraceId: string | null
  errorMessage: string | null
  quotaEpoch: number
  createdAt: string
  completedAt: string | null
}

export interface ProviderObservability {
  providerId: string
  credentialScope: string
  queueDepth: number
  activeCount: number
  stateUnknownCount: number
  oldestWait: string | null
  oldestWaitSeconds: number
  dispatchSuccessCount: number
  dispatchFailedCount: number
  dispatchSuccessRate: number | null
  throttleCount: number
  throttleRate: number | null
  retryCount: number
  averageQueueWaitSeconds: number
  averageActiveSlotSeconds: number
  waitP50Seconds: number | null
  waitP95Seconds: number | null
  paused: boolean
  pauseReason: string | null
  alerts: Array<{ code: string; severity: 'warning'; message: string }>
}

export interface QuotaResetPreview {
  targetUsers: number
  clearedPower: number
  waitingTasks: number
  activeTasks: number
  waitingReservedPower: number
}

export interface UserQuotaItem {
  id: number
  username?: string
  nickname?: string | null
  email?: string | null
  status?: number
  roles?: string[]
  quota: QuotaStatus | null
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface CloudBucketConfig {
  bucket: string
  region?: string
  baseUrl?: string
}

export interface MainCloudConfig {
  driver?: 'cos' | 'local' | string
  public?: CloudBucketConfig
  private?: CloudBucketConfig
  bucket?: string
  region?: string
}

export interface MainDeploymentConfig {
  deploymentMode?: string
  storageDriver?: string
  storage?: {
    publicBaseUrl?: string
    publicBucket?: string
    privateBucket?: string
    tempBucket?: string
  }
  features?: Record<string, boolean | undefined>
}

export interface CosTokenResponse {
  Credentials?: {
    TmpSecretId: string
    TmpSecretKey: string
    Token: string
  }
  StartTime?: number
  ExpiredTime?: number
  credentials?: {
    tmpSecretId: string
    tmpSecretKey: string
    sessionToken: string
  }
  startTime?: number
  expiredTime?: number
}

export const createTask = (payload: {
  type: 'text_to_model' | 'image_to_model'
  prompt?: string
  imageBase64?: string
  mimeType?: string
  provider_id?: string
}) => backendApi.post<{
  taskId: string
  status: TaskStatus
  providerId: string
  queuePosition: number | null
}>('/tasks', payload, { timeout: 90000 })

export const listTasks = (params?: { page?: number; pageSize?: number }) =>
  backendApi.get<{ data: Task[]; total: number; page: number; pageSize: number }>('/tasks', { params })
export const getTask = (taskId: string) => backendApi.get<Task>(`/tasks/${taskId}`)
export const getDownloadUrl = (taskId: string) => backendApi.get<{ url: string }>(`/tasks/${taskId}/download-url`)
export const downloadTaskFile = (taskId: string) =>
  backendApi.get<Blob>(`/download/${taskId}`, { responseType: 'blob' })
export const downloadTaskBuffer = (taskId: string) =>
  backendApi.get<ArrayBuffer>(`/download/${taskId}`, { responseType: 'arraybuffer' })
export const updateTaskResource = (taskId: string, resourceId: number) =>
  backendApi.put<{ success: boolean }>(`/tasks/${taskId}/resource`, { resource_id: resourceId })
export const cancelTask = (taskId: string) =>
  backendApi.delete<{ success: boolean; taskId: string; status: 'cancelled' }>(`/tasks/${taskId}`)

export const getAdminConfig = (providerId?: string) =>
  backendApi.get<{ configured: boolean; apiKeyMasked?: string; region?: 'ai' | 'com' }>('/admin/config', {
    params: providerId ? { provider_id: providerId } : undefined,
  })

export const saveAdminConfig = (apiKey: string, providerId: string) =>
  backendApi.put<{ success: boolean; region?: 'ai' | 'com' }>('/admin/config', { apiKey, provider_id: providerId })

export const getEnabledProviders = () => backendApi.get<{ providers: string[] }>('/admin/providers')
export const getProviderRuntime = () =>
  backendApi.get<{ data: ProviderRuntime[] }>('/admin/provider-runtime')
export const updateProviderRuntime = (
  providerId: string,
  payload: Pick<ProviderRuntime, 'maxConcurrency' | 'paused' | 'pollIntervalSeconds' | 'retryLimit' | 'configVersion'> & {
    pauseReason?: string | null
  }
) => backendApi.put<{ success: boolean }>(`/admin/provider-runtime/${providerId}`, payload)
export const wakeProviderRuntime = (providerId: string) =>
  backendApi.post<{ success: boolean }>(`/admin/provider-runtime/${providerId}/wake`)
export const pauseProviderRuntime = (providerId: string, pauseReason?: string) =>
  backendApi.post<{ success: boolean }>(`/admin/provider-runtime/${providerId}/pause`, { pauseReason })
export const resumeProviderRuntime = (providerId: string) =>
  backendApi.post<{ success: boolean }>(`/admin/provider-runtime/${providerId}/resume`)
export const getProviderQueue = (params?: { provider_id?: string; status?: TaskStatus; page?: number; pageSize?: number }) =>
  backendApi.get<{ data: ProviderQueueTask[]; pagination: Pagination }>('/admin/provider-queue', { params })
export const getProviderObservability = () =>
  backendApi.get<{ data: ProviderObservability[]; windowMinutes: number }>('/admin/observability')
export const getTaskDiagnostics = (taskId: string) =>
  backendApi.get<{ task: Omit<ProviderQueueTask, 'priority'> & { leaseOwner: string | null; leaseExpiresAt: string | null }; events: Array<{ eventType: string; fromStatus: string | null; toStatus: string | null; attemptCount: number; traceId: string | null; detail: unknown; createdAt: string }> }>(`/admin/tasks/${taskId}/diagnostics`)

export const getAdminBalance = (providerId: string) =>
  backendApi.get<{ configured: boolean; available?: number; availablePower?: number; frozen?: number; region?: 'ai' | 'com' }>('/admin/balance', {
    params: { provider_id: providerId },
  })

export const getAdminUsage = () =>
  backendApi.get<{
    totalCredits: number
    totalPower: number
    userRanking: Array<{ userId: number; username: string; credits: number; power: number }>
    dailyTrend: Array<{ date: string; credits: number; power: number }>
  }>('/admin/usage')

export const getCreditStatus = (providerId?: string) =>
  backendApi.get<{ data: QuotaStatus }>('/credits/status', {
    params: providerId ? { provider_id: providerId } : undefined,
  })

export const getQuotaSummary = () =>
  backendApi.get<{ data: QuotaSummary }>('/admin/quota/summary')

export const updateDefaultQuotaLimit = (quotaLimit: number) =>
  backendApi.put<{ success: boolean; data: QuotaSummary }>('/admin/quota/default-limit', {
    quota_limit: quotaLimit,
  })

export const resetQuotaUsage = (payload?: { note?: string }) =>
  backendApi.post<{
    success: boolean
    data: { affectedUsers: number; clearedPower: number; summary: QuotaSummary }
  }>('/admin/quota/reset-usage', payload ?? {})
export const getQuotaResetPreview = () =>
  backendApi.get<{ data: QuotaResetPreview }>('/admin/quota/reset-preview')
export const getUserQuotaResetPreview = (userId: number) =>
  backendApi.get<{ data: QuotaResetPreview }>(`/admin/user-quotas/${userId}/reset-preview`)

export const resetUserQuotaUsage = (
  userId: number,
  payload?: { note?: string }
) =>
  backendApi.post<{
    success: boolean
    data: { affectedUsers: number; clearedPower: number; summary: QuotaSummary }
  }>(`/admin/user-quotas/${userId}/reset`, payload ?? {})

export const getUserQuotas = (params?: {
  search?: string
  page?: number
  pageSize?: number
}) =>
  backendApi.get<{ data: UserQuotaItem[]; pagination: Pagination }>('/admin/user-quotas', {
    params,
  })

export const getUsageSummary = () =>
  backendApi.get<{
    totalCredits: number
    totalPower: number
    monthCredits: number
    monthPower: number
    taskCount: number
    dailyTrend: Array<{ date: string; credits: number; power: number }>
  }>('/usage')

export const fetchThumbnailBlob = (taskId: string) =>
  backendApi.get<Blob>(`/thumbnail/${taskId}`, { responseType: 'blob' })

export const getUsageHistory = (params?: {
  startDate?: string
  endDate?: string
  type?: 'text_to_model' | 'image_to_model'
}) => backendApi.get<{ data: UsageHistoryItem[] }>('/usage/history', { params })

export const verifyToken = () => mainApi.get('/v1/plugin/verify-token')

export const getDeploymentConfig = () => mainApi.get<MainDeploymentConfig>('/v1/system/deployment')
export const getCloudConfig = () => mainApi.get<MainCloudConfig>('/v1/tencent-cloud/cloud')
export const getCosPublicToken = () =>
  mainApi.get<CosTokenResponse>('/v1/tencent-cloud/public-token', { params: {} })

export interface LocalUploadResponse {
  over: boolean
  bucket: string
  key: string
  url?: string
  filename: string
  size: number
  md5: string
}

export const uploadLocalFile = (data: FormData) =>
  mainApi.post<LocalUploadResponse>('/v1/upload/file', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

export const createFileRecord = (payload: {
  filename: string
  md5: string
  key: string
  url: string
}) => mainApi.post<{ id: number }>('/v1/files', payload)

export const createResourceRecord = (payload: {
  name: string
  file_id: number
  image_id?: number
  info?: string
  type: string
}) => mainApi.post<{ id: number }>('/v1/resources', payload)
