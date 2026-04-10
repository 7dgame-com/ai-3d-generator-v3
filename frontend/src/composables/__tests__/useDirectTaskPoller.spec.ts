import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  completeTask: vi.fn(),
  failTask: vi.fn(),
  getAdapter: vi.fn(),
  getTaskStatus: vi.fn(),
}))

vi.mock('../../api', () => ({
  completeTask: mocks.completeTask,
  failTask: mocks.failTask,
}))

vi.mock('../../adapters/FrontendProviderRegistry', () => ({
  frontendProviderRegistry: {
    get: mocks.getAdapter,
  },
}))

describe('useDirectTaskPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))
    mocks.completeTask.mockReset()
    mocks.failTask.mockReset()
    mocks.getAdapter.mockReset()
    mocks.getTaskStatus.mockReset()
    mocks.getAdapter.mockReturnValue({
      getTaskStatus: mocks.getTaskStatus,
    })
  })

  it('polls every 3s and calls complete callback on success', async () => {
    mocks.getTaskStatus
      .mockResolvedValueOnce({ status: 'processing', progress: 30 })
      .mockResolvedValueOnce({
        status: 'success',
        progress: 100,
        outputUrl: 'https://cdn.example.com/model.glb',
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
        creditCost: 30,
      })
    mocks.completeTask.mockResolvedValue({ data: { success: true } })

    const { useDirectTaskPoller } = await import('../useDirectTaskPoller')
    const poller = useDirectTaskPoller()
    const onUpdate = vi.fn()
    const onComplete = vi.fn()
    const onFail = vi.fn()

    poller.startPolling({
      taskId: 'task-001',
      apiKey: 'api-key',
      providerId: 'tripo3d',
      apiBaseUrl: '/tripo',
      prepareToken: 'prepare-token',
      onUpdate,
      onComplete,
      onFail,
    })

    await vi.advanceTimersByTimeAsync(3000)
    await vi.runAllTicks()
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing', progress: 30 }))

    await vi.advanceTimersByTimeAsync(3000)
    await vi.runAllTicks()

    expect(mocks.completeTask).toHaveBeenCalledWith('task-001', {
      prepareToken: 'prepare-token',
      outputUrl: 'https://cdn.example.com/model.glb',
      thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
      creditCost: 30,
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onFail).not.toHaveBeenCalled()
  })

  it('falls back to the provider default credit cost when direct polling success omits creditCost', async () => {
    mocks.getTaskStatus.mockResolvedValueOnce({
      status: 'success',
      progress: 100,
      outputUrl: 'https://cdn.example.com/model.glb',
      thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
    })
    mocks.completeTask.mockResolvedValue({ data: { success: true } })

    const { useDirectTaskPoller } = await import('../useDirectTaskPoller')
    const poller = useDirectTaskPoller()

    poller.startPolling({
      taskId: 'task-fallback-credit',
      apiKey: 'api-key',
      providerId: 'tripo3d',
      apiBaseUrl: '/tripo',
      prepareToken: 'prepare-token',
      onUpdate: vi.fn(),
      onComplete: vi.fn(),
      onFail: vi.fn(),
    })

    await vi.advanceTimersByTimeAsync(3000)
    await vi.runAllTicks()

    expect(mocks.completeTask).toHaveBeenCalledWith('task-fallback-credit', {
      prepareToken: 'prepare-token',
      outputUrl: 'https://cdn.example.com/model.glb',
      thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
      creditCost: 30,
    })
  })

  it('stops on timeout and sends fail callback', async () => {
    mocks.getTaskStatus.mockResolvedValue({ status: 'processing', progress: 50 })
    mocks.failTask.mockResolvedValue({ data: { success: true } })

    const { useDirectTaskPoller } = await import('../useDirectTaskPoller')
    const poller = useDirectTaskPoller()
    const onFail = vi.fn()

    poller.startPolling({
      taskId: 'task-timeout',
      apiKey: 'api-key',
      providerId: 'tripo3d',
      apiBaseUrl: '/tripo',
      prepareToken: 'prepare-token',
      onUpdate: vi.fn(),
      onComplete: vi.fn(),
      onFail,
    })

    vi.setSystemTime(new Date('2026-04-09T00:10:01.000Z'))
    await vi.advanceTimersByTimeAsync(3000)
    await vi.runAllTicks()

    expect(mocks.failTask).toHaveBeenCalledWith('task-timeout', {
      prepareToken: 'prepare-token',
      errorMessage: '任务轮询超时',
    })
    expect(onFail).toHaveBeenCalledWith('任务轮询超时')
  })

  it('retries provider polling 3 times and then fails', async () => {
    mocks.getTaskStatus
      .mockRejectedValueOnce(new Error('network-1'))
      .mockRejectedValueOnce(new Error('network-2'))
      .mockRejectedValueOnce(new Error('network-3'))
    mocks.failTask.mockResolvedValue({ data: { success: true } })

    const { useDirectTaskPoller } = await import('../useDirectTaskPoller')
    const poller = useDirectTaskPoller()
    const onFail = vi.fn()

    poller.startPolling({
      taskId: 'task-retry',
      apiKey: 'api-key',
      providerId: 'tripo3d',
      apiBaseUrl: '/tripo',
      prepareToken: 'prepare-token',
      onUpdate: vi.fn(),
      onComplete: vi.fn(),
      onFail,
    })

    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.runAllTicks()

    expect(mocks.getTaskStatus).toHaveBeenCalledTimes(3)
    expect(mocks.failTask).toHaveBeenCalledWith('task-retry', {
      prepareToken: 'prepare-token',
      errorMessage: '轮询任务状态失败',
    })
    expect(onFail).toHaveBeenCalledWith('轮询任务状态失败')
  })
})
