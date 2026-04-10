import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createFileRecord: vi.fn(),
  createResourceRecord: vi.fn(),
  downloadTaskBuffer: vi.fn(),
  fetchThumbnailBlob: vi.fn(),
  getCloudConfig: vi.fn(),
  getCosPublicToken: vi.fn(),
  updateTaskResource: vi.fn(),
  authParams: null as
    | {
        TmpSecretId: string
        TmpSecretKey: string
        SecurityToken: string
        StartTime: number
        ExpiredTime: number
      }
    | null,
  uploadCalls: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../api', () => ({
  createFileRecord: mocks.createFileRecord,
  createResourceRecord: mocks.createResourceRecord,
  downloadTaskBuffer: mocks.downloadTaskBuffer,
  fetchThumbnailBlob: mocks.fetchThumbnailBlob,
  getCloudConfig: mocks.getCloudConfig,
  getCosPublicToken: mocks.getCosPublicToken,
  updateTaskResource: mocks.updateTaskResource,
}))

vi.mock('cos-js-sdk-v5', () => ({
  default: vi.fn().mockImplementation((options: {
    getAuthorization: (
      options: unknown,
      callback: (params: {
        TmpSecretId: string
        TmpSecretKey: string
        SecurityToken: string
        StartTime: number
        ExpiredTime: number
      }) => void
    ) => void
  }) => ({
    uploadFile: (
      params: Record<string, unknown>,
      callback: (error: Error | null, data: { Location?: string }) => void
    ) => {
      mocks.uploadCalls.push(params)
      options.getAuthorization({}, (auth) => {
        mocks.authParams = auth
        const key = String(params.Key)
        callback(null, { Location: `cos.example.com/${key}` })
      })
    },
  })),
}))

describe('useUploadService', () => {
  beforeEach(() => {
    vi.resetModules()

    mocks.createFileRecord.mockReset()
    mocks.createResourceRecord.mockReset()
    mocks.downloadTaskBuffer.mockReset()
    mocks.fetchThumbnailBlob.mockReset()
    mocks.getCloudConfig.mockReset()
    mocks.getCosPublicToken.mockReset()
    mocks.updateTaskResource.mockReset()
    mocks.authParams = null
    mocks.uploadCalls = []

    mocks.downloadTaskBuffer.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]).buffer,
    })
    mocks.fetchThumbnailBlob.mockResolvedValue({
      data: new Blob([new Uint8Array([9, 8, 7])], { type: 'image/webp' }),
    })
    mocks.getCloudConfig.mockResolvedValue({
      data: {
        public: { bucket: 'public-bucket-123456', region: 'ap-nanjing' },
        private: { bucket: 'private-bucket-123456', region: 'ap-guangzhou' },
      },
    })
    mocks.getCosPublicToken.mockResolvedValue({
      data: {
        Credentials: {
          TmpSecretId: 'tmp-id',
          TmpSecretKey: 'tmp-key',
          Token: 'tmp-token',
        },
        StartTime: 100,
        ExpiredTime: 200,
      },
    })
    mocks.createFileRecord
      .mockResolvedValueOnce({ data: { id: 11 } })
      .mockResolvedValueOnce({ data: { id: 12 } })
    mocks.createResourceRecord.mockResolvedValue({ data: { id: 22 } })
    mocks.updateTaskResource.mockResolvedValue({ data: { success: true } })
  })

  it('uploads the model and thumbnail, then creates the resource with image_id', async () => {
    const { useUploadService } = await import('../useUploadService')

    const { uploadToMain } = useUploadService()
    const result = await uploadToMain('task-123', 'demo prompt', vi.fn())

    expect(result).toEqual({ fileId: 11, resourceId: 22 })
    expect(mocks.fetchThumbnailBlob).toHaveBeenCalledWith('task-123')
    expect(mocks.uploadCalls).toHaveLength(2)
    expect(mocks.uploadCalls[0]).toMatchObject({
      Bucket: 'public-bucket-123456',
      Region: 'ap-nanjing',
      Key: 'ai-3d-generator-v3/task-123.glb',
    })
    expect(mocks.uploadCalls[1]).toMatchObject({
      Bucket: 'public-bucket-123456',
      Region: 'ap-nanjing',
      Key: 'ai-3d-generator-v3/task-123-thumbnail.webp',
    })
    expect(mocks.authParams).toEqual({
      TmpSecretId: 'tmp-id',
      TmpSecretKey: 'tmp-key',
      SecurityToken: 'tmp-token',
      StartTime: 100,
      ExpiredTime: 200,
    })
    expect(mocks.createFileRecord).toHaveBeenNthCalledWith(1, {
      filename: 'task-123.glb',
      md5: '',
      key: 'ai-3d-generator-v3/task-123.glb',
      url: 'https://cos.example.com/ai-3d-generator-v3/task-123.glb',
    })
    expect(mocks.createFileRecord).toHaveBeenNthCalledWith(2, {
      filename: 'task-123-thumbnail.webp',
      md5: '',
      key: 'ai-3d-generator-v3/task-123-thumbnail.webp',
      url: 'https://cos.example.com/ai-3d-generator-v3/task-123-thumbnail.webp',
    })
    expect(mocks.createResourceRecord).toHaveBeenCalledWith({
      name: 'demo prompt',
      file_id: 11,
      image_id: 12,
      type: 'polygen',
    })
    expect(mocks.updateTaskResource).toHaveBeenCalledWith('task-123', 22)
  })

  it('creates the resource without image_id when thumbnail fetch fails', async () => {
    mocks.fetchThumbnailBlob.mockRejectedValueOnce(new Error('thumbnail failed'))
    mocks.createFileRecord.mockReset()
    mocks.createFileRecord.mockResolvedValueOnce({ data: { id: 11 } })

    const { useUploadService } = await import('../useUploadService')

    const { uploadToMain } = useUploadService()
    const result = await uploadToMain('task-123', 'demo prompt', vi.fn())

    expect(result).toEqual({ fileId: 11, resourceId: 22 })
    expect(mocks.fetchThumbnailBlob).toHaveBeenCalledWith('task-123')
    expect(mocks.uploadCalls).toHaveLength(1)
    expect(mocks.createFileRecord).toHaveBeenCalledTimes(1)
    expect(mocks.createResourceRecord).toHaveBeenCalledWith({
      name: 'demo prompt',
      file_id: 11,
      type: 'polygen',
    })
  })

  it('falls back to a jpg thumbnail filename when blob type is unknown', async () => {
    mocks.fetchThumbnailBlob.mockResolvedValueOnce({
      data: new Blob([new Uint8Array([5, 4, 3])], { type: 'application/octet-stream' }),
    })

    const { useUploadService } = await import('../useUploadService')

    const { uploadToMain } = useUploadService()
    await uploadToMain('task-123', 'demo prompt', vi.fn())

    expect(mocks.uploadCalls[1]).toMatchObject({
      Key: 'ai-3d-generator-v3/task-123-thumbnail.jpg',
    })
    expect(mocks.createFileRecord).toHaveBeenNthCalledWith(2, {
      filename: 'task-123-thumbnail.jpg',
      md5: '',
      key: 'ai-3d-generator-v3/task-123-thumbnail.jpg',
      url: 'https://cos.example.com/ai-3d-generator-v3/task-123-thumbnail.jpg',
    })
  })
})
