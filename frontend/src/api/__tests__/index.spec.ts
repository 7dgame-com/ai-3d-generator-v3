import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockBackendPost = vi.fn()
const mockBackendGet = vi.fn()
const mockBackendPut = vi.fn()
const mockMainGet = vi.fn()
const mockMainPost = vi.fn()
const mockMainPut = vi.fn()
const mockAxiosCreate = vi.fn()

function createMockInstance(post = vi.fn(), get = vi.fn(), put = vi.fn()) {
  return {
    post,
    get,
    put,
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  }
}

vi.mock('axios', () => ({
  default: {
    create: mockAxiosCreate,
  },
}))

describe('frontend api module', () => {
  beforeEach(() => {
    vi.resetModules()

    mockBackendPost.mockReset()
    mockBackendGet.mockReset()
    mockBackendPut.mockReset()
    mockMainGet.mockReset()
    mockMainPost.mockReset()
    mockMainPut.mockReset()
    mockAxiosCreate.mockReset()

    mockAxiosCreate
      .mockReturnValueOnce(createMockInstance(mockBackendPost, mockBackendGet, mockBackendPut))
      .mockReturnValueOnce(createMockInstance(mockMainPost, mockMainGet, mockMainPut))
  })

  it('uses an extended timeout for prepareTask to cover backend throttle delays', async () => {
    mockBackendPost.mockResolvedValue({ data: { ok: true } })

    const { prepareTask } = await import('../index')

    await prepareTask({
      type: 'image_to_model',
      provider_id: 'tripo3d',
    })

    expect(mockBackendPost).toHaveBeenCalledWith(
      '/tasks/prepare',
      {
        type: 'image_to_model',
        provider_id: 'tripo3d',
      },
      {
        timeout: 90000,
      }
    )
  })

  it('loads the shared site power status from the site admin endpoint', async () => {
    mockBackendGet.mockResolvedValue({ data: { data: { wallet_balance: 0, pool_balance: 0 } } })

    const { getSitePowerStatus } = await import('../index')

    await getSitePowerStatus()

    expect(mockBackendGet).toHaveBeenCalledWith('/admin/site-power-status')
  })

  it('posts site recharge payloads to the site admin endpoint', async () => {
    mockBackendPost.mockResolvedValue({ data: { success: true } })

    const { rechargeSitePower } = await import('../index')

    await rechargeSitePower({
      total_power: 1200,
      wallet_percent: 40,
      pool_percent: 60,
      wallet_amount: 480,
      pool_amount: 720,
      total_duration: 10080,
      cycle_duration: 1440,
    })

    expect(mockBackendPost).toHaveBeenCalledWith('/admin/site-power-recharge', {
      total_power: 1200,
      wallet_percent: 40,
      pool_percent: 60,
      wallet_amount: 480,
      pool_amount: 720,
      total_duration: 10080,
      cycle_duration: 1440,
    })
  })
})
