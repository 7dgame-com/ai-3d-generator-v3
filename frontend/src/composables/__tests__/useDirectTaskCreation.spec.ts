import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepareTask: vi.fn(),
  registerTask: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  legacyCreateTask: vi.fn(),
  getAdapter: vi.fn(),
  adapterCreateTask: vi.fn(),
  startPolling: vi.fn(),
}))

vi.mock('../../api', () => ({
  prepareTask: mocks.prepareTask,
  registerTask: mocks.registerTask,
  completeTask: mocks.completeTask,
  failTask: mocks.failTask,
  createTask: mocks.legacyCreateTask,
}))

vi.mock('../../adapters/FrontendProviderRegistry', () => ({
  frontendProviderRegistry: {
    get: mocks.getAdapter,
  },
}))

vi.mock('../useDirectTaskPoller', () => ({
  useDirectTaskPoller: () => ({
    startPolling: mocks.startPolling,
    stopPolling: vi.fn(),
    stopAllPolling: vi.fn(),
  }),
}))

describe('useDirectTaskCreation', () => {
  beforeEach(() => {
    mocks.prepareTask.mockReset()
    mocks.registerTask.mockReset()
    mocks.completeTask.mockReset()
    mocks.failTask.mockReset()
    mocks.legacyCreateTask.mockReset()
    mocks.getAdapter.mockReset()
    mocks.adapterCreateTask.mockReset()
    mocks.startPolling.mockReset()

    mocks.getAdapter.mockReturnValue({
      createTask: mocks.adapterCreateTask,
    })
  })

  it('executes the direct flow: prepare -> provider create -> register -> poll', async () => {
    mocks.prepareTask.mockResolvedValue({
      data: {
        apiKey: 'provider-api-key',
        prepareToken: 'prepare-token',
        providerId: 'tripo3d',
        estimatedPower: 1.43,
        apiBaseUrl: '/tripo',
        mode: 'direct',
      },
    })
    mocks.adapterCreateTask.mockResolvedValue({
      taskId: 'provider-task-001',
      pollingKey: 'polling-key-001',
      estimatedCreditCost: 30,
    })
    mocks.registerTask.mockResolvedValue({ data: { success: true } })

    const { useDirectTaskCreation } = await import('../useDirectTaskCreation')
    const creator = useDirectTaskCreation()
    const result = await creator.createTask({
      type: 'text_to_model',
      prompt: 'a red chair',
      providerId: 'tripo3d',
    })

    expect(mocks.prepareTask).toHaveBeenCalledWith({
      type: 'text_to_model',
      provider_id: 'tripo3d',
    })
    expect(mocks.adapterCreateTask).toHaveBeenCalledWith(
      'provider-api-key',
      { type: 'text_to_model', prompt: 'a red chair', imageFile: undefined },
      '/tripo'
    )
    expect(mocks.registerTask).toHaveBeenCalledWith({
      prepareToken: 'prepare-token',
      taskId: 'provider-task-001',
      type: 'text_to_model',
      prompt: 'a red chair',
      pollingKey: 'polling-key-001',
    })
    expect(mocks.startPolling).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ taskId: 'provider-task-001', mode: 'direct' })
  })

  it('keeps using the direct browser flow even if backend still returns proxy mode', async () => {
    mocks.prepareTask.mockResolvedValue({
      data: {
        apiKey: 'provider-api-key',
        prepareToken: 'prepare-token',
        providerId: 'tripo3d',
        estimatedPower: 1.43,
        apiBaseUrl: '/tripo',
        mode: 'proxy',
      },
    })
    mocks.adapterCreateTask.mockResolvedValue({
      taskId: 'provider-task-proxy-compat',
      pollingKey: 'polling-key-proxy-compat',
      estimatedCreditCost: 30,
    })
    mocks.registerTask.mockResolvedValue({ data: { success: true } })

    const { useDirectTaskCreation } = await import('../useDirectTaskCreation')
    const creator = useDirectTaskCreation()
    const result = await creator.createTask({
      type: 'text_to_model',
      prompt: 'a robot',
      providerId: 'tripo3d',
    })

    expect(mocks.legacyCreateTask).not.toHaveBeenCalled()
    expect(mocks.adapterCreateTask).toHaveBeenCalledWith(
      'provider-api-key',
      { type: 'text_to_model', prompt: 'a robot', imageFile: undefined },
      '/tripo'
    )
    expect(mocks.registerTask).toHaveBeenCalledWith({
      prepareToken: 'prepare-token',
      taskId: 'provider-task-proxy-compat',
      type: 'text_to_model',
      prompt: 'a robot',
      pollingKey: 'polling-key-proxy-compat',
    })
    expect(result).toEqual({ taskId: 'provider-task-proxy-compat', mode: 'direct' })
  })

  it('calls failTask to rollback when register step fails after provider task creation', async () => {
    mocks.prepareTask.mockResolvedValue({
      data: {
        apiKey: 'provider-api-key',
        prepareToken: 'prepare-token',
        providerId: 'hyper3d',
        estimatedPower: 0.96,
        apiBaseUrl: '/hyper',
        mode: 'direct',
      },
    })
    mocks.adapterCreateTask.mockResolvedValue({
      taskId: 'provider-task-rollback',
      pollingKey: 'polling-key-rollback',
      estimatedCreditCost: 0.5,
    })
    mocks.registerTask.mockRejectedValue(new Error('register failed'))
    mocks.failTask.mockResolvedValue({ data: { success: true } })

    const { useDirectTaskCreation } = await import('../useDirectTaskCreation')
    const creator = useDirectTaskCreation()

    await expect(
      creator.createTask({
        type: 'text_to_model',
        prompt: 'a spaceship',
        providerId: 'hyper3d',
      })
    ).rejects.toThrow('register failed')

    expect(mocks.failTask).toHaveBeenCalledWith('provider-task-rollback', {
      prepareToken: 'prepare-token',
      errorMessage: '任务创建流程失败',
    })
  })
})
