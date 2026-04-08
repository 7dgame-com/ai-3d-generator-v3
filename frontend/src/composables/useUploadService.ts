import { ref } from 'vue'
import COS from 'cos-js-sdk-v5'
import {
  createFileRecord,
  createResourceRecord,
  downloadTaskBuffer,
  getCloudConfig,
  getCosToken,
  updateTaskResource,
} from '../api'

export function useUploadService() {
  const uploading = ref(false)
  const uploadError = ref<string | null>(null)

  async function uploadToMain(taskId: string, prompt: string | null, onProgress: (percent: number) => void) {
    uploading.value = true
    uploadError.value = null

    try {
      const [{ data: modelBuffer }, { data: cloudData }, { data: tokenData }] = await Promise.all([
        downloadTaskBuffer(taskId),
        getCloudConfig(),
        getCosToken(),
      ])
      const objectKey = `ai-3d-generator-v3/${taskId}.glb`

      const cos = new COS({
        getAuthorization: (
          _options: unknown,
          callback: (params: {
            TmpSecretId: string
            TmpSecretKey: string
            SecurityToken: string
            StartTime: number
            ExpiredTime: number
          }) => void
        ) => {
          callback({
            TmpSecretId: tokenData.credentials.tmpSecretId,
            TmpSecretKey: tokenData.credentials.tmpSecretKey,
            SecurityToken: tokenData.credentials.sessionToken,
            StartTime: tokenData.startTime ?? Math.floor(Date.now() / 1000),
            ExpiredTime: tokenData.expiredTime,
          })
        },
      })

      const uploadResult = await new Promise<{ Location?: string }>((resolve, reject) => {
        cos.uploadFile(
          {
            Bucket: cloudData.bucket,
            Region: cloudData.region,
            Key: objectKey,
            Body: new Blob([modelBuffer]),
            onProgress: (info: { percent: number }) => onProgress(Math.round(info.percent * 100)),
          },
          (error: Error | null, data: { Location?: string }) => {
            if (error) {
              reject(error)
            } else {
              resolve(data)
            }
          }
        )
      })

      const fileRecord = await createFileRecord({
        filename: `${taskId}.glb`,
        md5: '',
        key: objectKey,
        url: uploadResult.Location ? `https://${uploadResult.Location}` : '',
      })

      const resourceRecord = await createResourceRecord({
        name: (prompt || taskId).slice(0, 50),
        file_id: fileRecord.data.id,
        type: 'polygen',
      })

      await updateTaskResource(taskId, resourceRecord.data.id)

      return { fileId: fileRecord.data.id, resourceId: resourceRecord.data.id }
    } catch (error) {
      uploadError.value = error instanceof Error ? error.message : '上传失败'
      throw error
    } finally {
      uploading.value = false
    }
  }

  return {
    uploadToMain,
    uploading,
    uploadError,
  }
}
