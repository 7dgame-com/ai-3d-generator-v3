import { ref } from 'vue'
import {
  createTask as createTaskLegacy,
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

async function fileToBase64(file: File): Promise<string> {
  if (typeof file.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : ''
      if (!base64) {
        reject(new Error('图片读取失败'))
        return
      }
      resolve(base64)
    }
    reader.readAsDataURL(file)
  })
}

export function useDirectTaskCreation() {
  const isCreating = ref(false)
  const { startPolling } = useDirectTaskPoller()

  async function createTask(params: DirectTaskCreationParams): Promise<{ taskId: string; mode: 'direct' | 'proxy' }> {
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

      if (prepared.mode === 'proxy') {
        if (params.type === 'text_to_model') {
          const response = await createTaskLegacy({
            type: 'text_to_model',
            prompt: params.prompt,
            provider_id: params.providerId,
          })
          return { taskId: response.data.taskId, mode: 'proxy' }
        }

        if (!params.imageFile) {
          throw new Error('image_to_model 缺少 imageFile')
        }

        const imageBase64 = await fileToBase64(params.imageFile)
        const response = await createTaskLegacy({
          type: 'image_to_model',
          imageBase64,
          mimeType: params.imageFile.type || 'image/png',
          provider_id: params.providerId,
        })
        return { taskId: response.data.taskId, mode: 'proxy' }
      }

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
