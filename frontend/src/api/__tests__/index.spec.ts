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

  it('posts global recharge payloads without provider_id', async () => {
    mockBackendPost.mockResolvedValue({ data: { success: true } })

    const { rechargeAdminCredits } = await import('../index')

    await rechargeAdminCredits({
      userId: 9,
      wallet_amount: 300,
      pool_amount: 100,
      total_duration: 7200,
      cycle_duration: 1440,
    })

    expect(mockBackendPost).toHaveBeenCalledWith('/admin/recharge', {
      userId: 9,
      wallet_amount: 300,
      pool_amount: 100,
      total_duration: 7200,
      cycle_duration: 1440,
    })
  })
})
