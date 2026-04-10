import { getCurrentInstance, onBeforeUnmount } from 'vue'
import { completeTask, failTask } from '../api'
import { frontendProviderRegistry } from '../adapters/FrontendProviderRegistry'
import type { TaskStatusOutput } from '../adapters/IFrontendProviderAdapter'
import { getProviderDefaultCreditCost } from '../utils/providerBilling'

const POLL_INTERVAL_MS = 3000
const TIMEOUT_MS = 10 * 60 * 1000
const NETWORK_RETRY_MAX = 3
const NETWORK_RETRY_DELAY_MS = 2000

interface PollingParams {
  taskId: string
  pollingKey?: string
  apiKey: string
  providerId: string
  apiBaseUrl: string
  prepareToken: string
  onUpdate: (status: TaskStatusOutput) => void
  onComplete: () => void
  onFail: (error: string) => void
}

interface PollingContext extends Omit<PollingParams, 'apiKey'> {
  startedAt: number
  apiKey: string | null
}

const timers = new Map<string, number>()
const contexts = new Map<string, PollingContext>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= NETWORK_RETRY_MAX; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < NETWORK_RETRY_MAX) {
        await delay(NETWORK_RETRY_DELAY_MS)
      }
    }
  }

  throw lastError
}

function clearTaskState(taskId: string): void {
  const timer = timers.get(taskId)
  if (timer) {
    window.clearTimeout(timer)
    timers.delete(taskId)
  }

  const context = contexts.get(taskId)
  if (context) {
    context.apiKey = null
  }
  contexts.delete(taskId)
}

function scheduleNextPoll(taskId: string): void {
  const timer = window.setTimeout(() => {
    void pollTask(taskId)
  }, POLL_INTERVAL_MS)
  timers.set(taskId, timer)
}

async function markFailed(taskId: string, errorMessage: string): Promise<void> {
  const context = contexts.get(taskId)
  if (!context) {
    return
  }

  try {
    await failTask(taskId, {
      prepareToken: context.prepareToken,
      errorMessage,
    })
  } catch {
    // Let timeout guardian handle refunds when callback fails.
  }

  context.onFail(errorMessage)
  clearTaskState(taskId)
}

async function pollTask(taskId: string): Promise<void> {
  const context = contexts.get(taskId)
  if (!context) {
    return
  }

  if (Date.now() - context.startedAt > TIMEOUT_MS) {
    await markFailed(taskId, '任务轮询超时')
    return
  }

  const adapter = frontendProviderRegistry.get(context.providerId)
  if (!adapter || !context.apiKey) {
    await markFailed(taskId, '未找到可用的 Provider 适配器')
    return
  }

  let status: TaskStatusOutput
  try {
    status = await withRetry(() =>
      adapter.getTaskStatus(
        context.apiKey as string,
        context.taskId,
        context.apiBaseUrl,
        context.pollingKey
      )
    )
  } catch {
    await markFailed(taskId, '轮询任务状态失败')
    return
  }

  context.onUpdate(status)

  if (status.status === 'success') {
    if (!status.outputUrl) {
      scheduleNextPoll(taskId)
      return
    }

    try {
      const creditCost = status.creditCost ?? getProviderDefaultCreditCost(context.providerId)
      await completeTask(taskId, {
        prepareToken: context.prepareToken,
        outputUrl: status.outputUrl,
        thumbnailUrl: status.thumbnailUrl,
        creditCost,
      })
      context.onComplete()
      clearTaskState(taskId)
    } catch {
      await markFailed(taskId, '任务完成回调失败')
    }
    return
  }

  if (status.status === 'failed') {
    await markFailed(taskId, status.errorMessage ?? '任务生成失败')
    return
  }

  scheduleNextPoll(taskId)
}

export function useDirectTaskPoller() {
  function startPolling(params: PollingParams): void {
    clearTaskState(params.taskId)
    contexts.set(params.taskId, {
      ...params,
      startedAt: Date.now(),
      apiKey: params.apiKey,
    })
    scheduleNextPoll(params.taskId)
  }

  function stopPolling(taskId: string): void {
    clearTaskState(taskId)
  }

  function stopAllPolling(): void {
    for (const taskId of Array.from(contexts.keys())) {
      clearTaskState(taskId)
    }
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      stopAllPolling()
    })
  }

  return {
    startPolling,
    stopPolling,
    stopAllPolling,
  }
}
