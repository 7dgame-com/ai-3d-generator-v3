import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import {
  createTask as createServerTask,
  type Task,
} from '../api'
import type { TaskStatusOutput } from '../adapters/IFrontendProviderAdapter'
import { useTaskPoller } from './useTaskPoller'

interface DirectTaskCreationParams {
  type: 'text_to_model' | 'image_to_model'
  prompt?: string
  imageBase64?: string
  mimeType?: string
  providerId: string
  onUpdate?: (status: TaskStatusOutput) => void
  onComplete?: () => void
  onFail?: (error: string) => void
}

export function useDirectTaskCreation() {
  const isCreating = ref(false)
  const { startPolling } = useTaskPoller()
  const deferredPollTimers = new Set<number>()

  function schedulePolling(taskId: string, onUpdate: (task: Task) => void) {
    // The caller adds the optimistic task row immediately after createTask
    // resolves. Deferring the first poll by one event-loop turn guarantees a
    // very fast terminal response is applied to that row rather than dropped.
    const timer = window.setTimeout(() => {
      deferredPollTimers.delete(timer)
      startPolling(taskId, onUpdate)
    }, 0)
    deferredPollTimers.add(timer)
  }

  // The composable is also unit-tested outside a Vue setup context. Register
  // cleanup only when a component instance is available.
  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      for (const timer of deferredPollTimers) {
        window.clearTimeout(timer)
      }
      deferredPollTimers.clear()
    })
  }

  async function createTask(params: DirectTaskCreationParams): Promise<{
    taskId: string
    providerId: string
    status: Task['status']
    queuePosition: number | null
    mode: 'direct'
  }> {
    isCreating.value = true

    try {
      // Creation, provider calls, polling, and billing are server-mediated so
      // a long-lived provider API key never reaches the browser.
      const response = await createServerTask({
        type: params.type,
        prompt: params.prompt,
        imageBase64: params.imageBase64,
        mimeType: params.mimeType,
        provider_id: params.providerId,
      })
      schedulePolling(response.data.taskId, (task) => {
        const normalizedStatus = task.status === 'timeout' ? 'failed' : task.status
        params.onUpdate?.({
          status: normalizedStatus,
          progress: task.progress,
          outputUrl: task.outputUrl ?? undefined,
          thumbnailUrl: task.thumbnailUrl ?? undefined,
          errorMessage: task.errorMessage ?? undefined,
        })
        if (task.status === 'success') {
          params.onComplete?.()
        } else if (task.status === 'failed' || task.status === 'timeout') {
          params.onFail?.(task.errorMessage ?? '任务生成失败')
        }
      })

      return {
        taskId: response.data.taskId,
        providerId: response.data.providerId,
        status: response.data.status,
        queuePosition: response.data.queuePosition,
        mode: 'direct',
      }
    } finally {
      isCreating.value = false
    }
  }

  return {
    isCreating,
    createTask,
  }
}
