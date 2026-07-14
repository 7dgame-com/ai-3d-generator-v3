import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  startPolling: vi.fn(),
}))

vi.mock('../../api', () => ({
  createTask: mocks.createTask,
}))

vi.mock('../useTaskPoller', () => ({
  useTaskPoller: () => ({
    startPolling: mocks.startPolling,
    stopPolling: vi.fn(),
    stopAllPolling: vi.fn(),
  }),
}))

describe('useDirectTaskCreation', () => {
  beforeEach(() => {
    mocks.createTask.mockReset()
    mocks.startPolling.mockReset()
  })

  it('creates through the server and never supplies a provider API key to the browser', async () => {
    mocks.createTask.mockResolvedValue({ data: { taskId: 'server-task-001', providerId: 'tripo3d', status: 'waiting_provider', queuePosition: 3 } })

    const { useDirectTaskCreation } = await import('../useDirectTaskCreation')
    const creator = useDirectTaskCreation()
    const result = await creator.createTask({
      type: 'image_to_model',
      imageBase64: 'base64-image',
      mimeType: 'image/png',
      providerId: 'tripo3d',
    })

    expect(mocks.createTask).toHaveBeenCalledWith({
      type: 'image_to_model',
      prompt: undefined,
      imageBase64: 'base64-image',
      mimeType: 'image/png',
      provider_id: 'tripo3d',
    })
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    expect(mocks.startPolling).toHaveBeenCalledWith('server-task-001', expect.any(Function))
    expect(result).toEqual({ taskId: 'server-task-001', providerId: 'tripo3d', status: 'waiting_provider', queuePosition: 3, mode: 'direct' })
  })

  it('maps a server timeout into the existing failure callback', async () => {
    mocks.createTask.mockResolvedValue({ data: { taskId: 'server-task-timeout', status: 'queued' } })
    const onUpdate = vi.fn()
    const onFail = vi.fn()

    const { useDirectTaskCreation } = await import('../useDirectTaskCreation')
    await useDirectTaskCreation().createTask({
      type: 'text_to_model',
      prompt: 'a chair',
      providerId: 'hyper3d',
      onUpdate,
      onFail,
    })

    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))

    const update = mocks.startPolling.mock.calls[0][1] as (task: {
      status: 'timeout'
      progress: number
      outputUrl: null
      thumbnailUrl: null
      errorMessage: string
    }) => void
    update({ status: 'timeout', progress: 100, outputUrl: null, thumbnailUrl: null, errorMessage: '生成超时' })

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', progress: 100 }))
    expect(onFail).toHaveBeenCalledWith('生成超时')
  })
})
