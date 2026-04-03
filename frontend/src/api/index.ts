import axios from 'axios'
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import {
  getToken,
  isInIframe,
  removeAllTokens,
  requestParentTokenRefresh,
  setToken,
} from '../utils/token'

export const backendApi = axios.create({
  baseURL: '/backend',
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
})

export const mainApi = axios.create({
  baseURL: '/api',
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
})

let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (error: Error) => void
}> = []

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

function setupInterceptors(instance: AxiosInstance) {
  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getToken()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
      if (!originalRequest || error.response?.status !== 401 || originalRequest._retry) {
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
        const refreshed = isInIframe() ? await requestParentTokenRefresh() : null
        if (!refreshed?.accessToken) {
          throw new Error('Token refresh failed')
        }

        setToken(refreshed.accessToken)
        processQueue(null, refreshed.accessToken)
        originalRequest.headers.Authorization = `Bearer ${refreshed.accessToken}`
        return instance(originalRequest)
      } catch (refreshError) {
        removeAllTokens()
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

export type TaskStatus = 'queued' | 'processing' | 'success' | 'failed' | 'timeout'

export interface Task {
  taskId: string
  type: 'text_to_model' | 'image_to_model'
  prompt: string | null
  status: TaskStatus
  progress: number
  creditCost: number
  outputUrl: string | null
  resourceId: number | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export interface UsageHistoryItem {
  taskId: string
  type: 'text_to_model' | 'image_to_model'
  prompt: string | null
  creditsUsed: number
  createdAt: string
  status: TaskStatus
}

export interface ProviderCreditStatus {
  provider_id: string
  wallet_balance: number
  pool_balance: number
  pool_baseline: number
  cycles_remaining: number
  cycle_started_at: string | null
  next_cycle_at: string | null
}

export const createTask = (payload: {
  type: 'text_to_model' | 'image_to_model'
  prompt?: string
  imageBase64?: string
  mimeType?: string
  provider_id?: string
}) => backendApi.post<{ taskId: string; status: TaskStatus }>('/tasks', payload)

export const listTasks = () => backendApi.get<{ data: Task[]; total: number }>('/tasks')
export const getTask = (taskId: string) => backendApi.get<Task>(`/tasks/${taskId}`)
export const getDownloadUrl = (taskId: string) => backendApi.get<{ url: string }>(`/tasks/${taskId}/download-url`)
export const updateTaskResource = (taskId: string, resourceId: number) =>
  backendApi.put<{ success: boolean }>(`/tasks/${taskId}/resource`, { resource_id: resourceId })

export const getAdminConfig = (providerId?: string) =>
  backendApi.get<{ configured: boolean; apiKeyMasked?: string }>('/admin/config', {
    params: providerId ? { provider_id: providerId } : undefined,
  })

export const saveAdminConfig = (apiKey: string, providerId: string) =>
  backendApi.put<{ success: boolean }>('/admin/config', { apiKey, provider_id: providerId })

export const getEnabledProviders = () => backendApi.get<{ providers: string[] }>('/admin/providers')

export const getAdminBalance = (providerId: string) =>
  backendApi.get<{ configured: boolean; available?: number; frozen?: number }>('/admin/balance', {
    params: { provider_id: providerId },
  })

export const getAdminUsage = () =>
  backendApi.get<{
    totalCredits: number
    userRanking: Array<{ userId: number; username: string; credits: number }>
    dailyTrend: Array<{ date: string; credits: number }>
  }>('/admin/usage')

export const getCreditStatus = (providerId?: string) =>
  backendApi.get<{ data: ProviderCreditStatus[] }>('/credits/status', {
    params: providerId ? { provider_id: providerId } : undefined,
  })

export const getAdminCreditStatus = (userId: number) =>
  backendApi.get<{ data: ProviderCreditStatus[] }>(`/admin/credits/${userId}`)

export const rechargeAdminCredits = (payload: {
  userId: number
  provider_id: string
  wallet_amount: number
  pool_amount: number
  total_duration: number
  cycle_duration: number
}) => backendApi.post<{ success: boolean }>('/admin/recharge', payload)

export const getUsageSummary = () =>
  backendApi.get<{
    totalCredits: number
    monthCredits: number
    taskCount: number
    dailyTrend: Array<{ date: string; credits: number }>
  }>('/usage')

export const getUsageHistory = (params?: {
  startDate?: string
  endDate?: string
  type?: 'text_to_model' | 'image_to_model'
}) => backendApi.get<{ data: UsageHistoryItem[] }>('/usage/history', { params })

export const verifyToken = () =>
  mainApi.get('/v1/plugin/verify-token', {
    params: { plugin_name: 'ai-3d-generator-v3' },
  })

export const getAllowedActions = () =>
  mainApi.get('/v1/plugin/allowed-actions', {
    params: { plugin_name: 'ai-3d-generator-v3' },
  })

export const getCloudConfig = () => mainApi.get<{ bucket: string; region: string }>('/v1/tencent-clouds/cloud')
export const getCosToken = () =>
  mainApi.get<{
    credentials: { tmpSecretId: string; tmpSecretKey: string; sessionToken: string }
    expiredTime: number
    startTime?: number
  }>('/v1/tencent-clouds/token')

export const createFileRecord = (payload: {
  filename: string
  md5: string
  key: string
  url: string
}) => mainApi.post<{ id: number }>('/v1/files', payload)

export const createResourceRecord = (payload: {
  name: string
  file_id: number
  type: string
}) => mainApi.post<{ id: number }>('/v1/resources', payload)
