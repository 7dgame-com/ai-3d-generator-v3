import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockBackendPost = vi.fn()
const mockBackendGet = vi.fn()
const mockBackendPut = vi.fn()
const mockMainGet = vi.fn()
const mockMainPost = vi.fn()
const mockMainPut = vi.fn()
const mockAxiosCreate = vi.fn()
const mockGetToken = vi.fn()
const mockSetToken = vi.fn()
const mockIsInIframe = vi.fn()
const mockRequestParentTokenRefresh = vi.fn()

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

vi.mock('../../utils/token', () => ({
  getToken: mockGetToken,
  setToken: mockSetToken,
  isInIframe: mockIsInIframe,
  requestParentTokenRefresh: mockRequestParentTokenRefresh,
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
    mockGetToken.mockReset()
    mockSetToken.mockReset()
    mockIsInIframe.mockReset()
    mockRequestParentTokenRefresh.mockReset()
    mockGetToken.mockReturnValue(null)
    mockIsInIframe.mockReturnValue(false)
    mockRequestParentTokenRefresh.mockResolvedValue(null)

    mockAxiosCreate
      .mockReturnValueOnce(createMockInstance(mockBackendPost, mockBackendGet, mockBackendPut))
      .mockReturnValueOnce(createMockInstance(mockMainPost, mockMainGet, mockMainPut))
  })

  it('waits for the parent token before sending the first embedded request', async () => {
    mockIsInIframe.mockReturnValue(true)
    mockRequestParentTokenRefresh.mockResolvedValueOnce({ accessToken: 'parent-token' })

    await import('../index')

    const backendInstance = mockAxiosCreate.mock.results[0].value
    const requestInterceptor = backendInstance.interceptors.request.use.mock.calls[0][0]
    const config = await requestInterceptor({ headers: {} })

    expect(mockRequestParentTokenRefresh).toHaveBeenCalledTimes(1)
    expect(mockSetToken).toHaveBeenCalledWith('parent-token')
    expect(config.headers.Authorization).toBe('Bearer parent-token')
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

  it('verifies tokens through the main api plugin endpoint', async () => {
    mockMainGet.mockResolvedValue({ data: { code: 0, data: { id: 3, roles: ['root'] } } })

    const { verifyToken } = await import('../index')

    await verifyToken()

    expect(mockAxiosCreate).toHaveBeenCalledTimes(2)
    expect(mockMainGet).toHaveBeenCalledWith('/v1/plugin/verify-token')
  })
})
