import { ref } from 'vue'
import {
  failTask,
  prepareTask,
  registerTask,
} from '../api'
import { frontendProviderRegistry } from '../adapters/FrontendProviderRegistry'
import type { TaskStatusOutput } from '../adapters/IFrontendProviderAdapter'
import { useDirectTaskPoller } from './useDirectTaskPoller'

interface DirectTaskCreationParams {
  type: 'text_to_model' | 'image_to_model'
  prompt?: string
  imageFile?: File
  providerId: string
  onUpdate?: (status: TaskStatusOutput) => void
  onComplete?: () => void
  onFail?: (error: string) => void
}

export function useDirectTaskCreation() {
  const isCreating = ref(false)
  const { startPolling } = useDirectTaskPoller()

  async function createTask(params: DirectTaskCreationParams): Promise<{ taskId: string; mode: 'direct' }> {
    isCreating.value = true

    let prepareToken: string | null = null
    let providerTaskId: string | null = null

    try {
      const prepareResponse = await prepareTask({
        type: params.type,
        provider_id: params.providerId,
      })

      const prepared = prepareResponse.data
      prepareToken = prepared.prepareToken

      const adapter = frontendProviderRegistry.get(params.providerId)
      if (!adapter) {
        throw new Error(`Provider 适配器不存在: ${params.providerId}`)
      }

      const providerTask = await adapter.createTask(
        prepared.apiKey,
        {
          type: params.type,
          prompt: params.prompt,
          imageFile: params.imageFile,
        },
        prepared.apiBaseUrl
      )
      providerTaskId = providerTask.taskId

      await registerTask({
        prepareToken: prepared.prepareToken,
        taskId: providerTask.taskId,
        type: params.type,
        prompt: params.prompt,
        pollingKey: providerTask.pollingKey,
      })

      startPolling({
        taskId: providerTask.taskId,
        pollingKey: providerTask.pollingKey,
        apiKey: prepared.apiKey,
        providerId: params.providerId,
        apiBaseUrl: prepared.apiBaseUrl,
        prepareToken: prepared.prepareToken,
        onUpdate: params.onUpdate ?? (() => {}),
        onComplete: params.onComplete ?? (() => {}),
        onFail: params.onFail ?? (() => {}),
      })

      return { taskId: providerTask.taskId, mode: 'direct' }
    } catch (error) {
      if (prepareToken && providerTaskId) {
        try {
          await failTask(providerTaskId, {
            prepareToken,
            errorMessage: '任务创建流程失败',
          })
        } catch {
          // Let timeout guardian recover if rollback callback fails.
        }
      }
      throw error
    } finally {
      isCreating.value = false
    }
  }

  return {
    isCreating,
    createTask,
  }
}
