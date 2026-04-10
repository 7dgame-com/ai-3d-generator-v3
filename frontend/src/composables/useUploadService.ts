import { ref } from 'vue'
import COS from 'cos-js-sdk-v5'
import {
  type CloudBucketConfig,
  type CosTokenResponse,
  type MainCloudConfig,
  createFileRecord,
  createResourceRecord,
  downloadTaskBuffer,
  fetchThumbnailBlob,
  getCloudConfig,
  getCosPublicToken,
  updateTaskResource,
} from '../api'

function resolvePublicCloudConfig(cloudData: MainCloudConfig): CloudBucketConfig {
  if (cloudData.public?.bucket && cloudData.public.region) {
    return cloudData.public
  }

  if (cloudData.bucket && cloudData.region) {
    return {
      bucket: cloudData.bucket,
      region: cloudData.region,
    }
  }

  throw new Error('Main cloud config is invalid')
}

function resolveCosAuthorization(tokenData: CosTokenResponse) {
  const fallbackStartTime = Math.floor(Date.now() / 1000)

  if (
    tokenData.Credentials?.TmpSecretId &&
    tokenData.Credentials.TmpSecretKey &&
    tokenData.Credentials.Token &&
    typeof tokenData.ExpiredTime === 'number'
  ) {
    return {
      TmpSecretId: tokenData.Credentials.TmpSecretId,
      TmpSecretKey: tokenData.Credentials.TmpSecretKey,
      SecurityToken: tokenData.Credentials.Token,
      StartTime: tokenData.StartTime ?? fallbackStartTime,
      ExpiredTime: tokenData.ExpiredTime,
    }
  }

  if (
    tokenData.credentials?.tmpSecretId &&
    tokenData.credentials.tmpSecretKey &&
    tokenData.credentials.sessionToken &&
    typeof tokenData.expiredTime === 'number'
  ) {
    return {
      TmpSecretId: tokenData.credentials.tmpSecretId,
      TmpSecretKey: tokenData.credentials.tmpSecretKey,
      SecurityToken: tokenData.credentials.sessionToken,
      StartTime: tokenData.startTime ?? fallbackStartTime,
      ExpiredTime: tokenData.expiredTime,
    }
  }

  throw new Error('Main COS token response is invalid')
}

function inferImageExtension(contentType?: string) {
  switch (contentType) {
    case 'image/webp':
      return '.webp'
    case 'image/png':
      return '.png'
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg'
    default:
      return '.jpg'
  }
}

async function uploadBlobToCos(params: {
  cos: InstanceType<typeof COS>
  bucket: string
  region: string
  key: string
  body: Blob
  onProgress?: (percent: number) => void
}) {
  const result = await new Promise<{ Location?: string }>((resolve, reject) => {
    params.cos.uploadFile(
      {
        Bucket: params.bucket,
        Region: params.region,
        Key: params.key,
        Body: params.body,
        onProgress: (info: { percent: number }) => {
          params.onProgress?.(Math.round(info.percent * 100))
        },
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

  return {
    key: params.key,
    url: result.Location ? `https://${result.Location}` : '',
  }
}

async function tryUploadThumbnail(params: {
  taskId: string
  cos: InstanceType<typeof COS>
  publicCloud: CloudBucketConfig
}) {
  try {
    const { data } = await fetchThumbnailBlob(params.taskId)
    const blob = data instanceof Blob ? data : new Blob([data])
    const extension = inferImageExtension(blob.type)
    const filename = `${params.taskId}-thumbnail${extension}`
    const objectKey = `ai-3d-generator-v3/${filename}`
    const upload = await uploadBlobToCos({
      cos: params.cos,
      bucket: params.publicCloud.bucket,
      region: params.publicCloud.region,
      key: objectKey,
      body: blob,
    })
    const fileRecord = await createFileRecord({
      filename,
      md5: '',
      key: upload.key,
      url: upload.url,
    })
    return fileRecord.data.id
  } catch {
    return null
  }
}

export function useUploadService() {
  const uploading = ref(false)
  const uploadError = ref<string | null>(null)

  async function uploadToMain(taskId: string, prompt: string | null, onProgress: (percent: number) => void) {
    uploading.value = true
    uploadError.value = null

    try {
      const [{ data: modelBuffer }, { data: cloudData }] = await Promise.all([
        downloadTaskBuffer(taskId),
        getCloudConfig(),
      ])
      const { data: tokenData } = await getCosPublicToken()
      const publicCloud = resolvePublicCloudConfig(cloudData)
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
          callback(resolveCosAuthorization(tokenData))
        },
      })

      const uploadResult = await uploadBlobToCos({
        cos,
        bucket: publicCloud.bucket,
        region: publicCloud.region,
        key: objectKey,
        body: new Blob([modelBuffer]),
        onProgress,
      })

      const fileRecord = await createFileRecord({
        filename: `${taskId}.glb`,
        md5: '',
        key: objectKey,
        url: uploadResult.url,
      })

      const thumbnailFileId = await tryUploadThumbnail({
        taskId,
        cos,
        publicCloud,
      })

      const resourceRecord = await createResourceRecord({
        name: (prompt || taskId).slice(0, 50),
        file_id: fileRecord.data.id,
        ...(thumbnailFileId ? { image_id: thumbnailFileId } : {}),
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
