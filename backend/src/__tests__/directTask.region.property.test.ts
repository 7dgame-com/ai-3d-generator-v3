import * as fc from 'fast-check'
import type { Response } from 'express'
import { prepareTask } from '../controllers/directTask'

/* ------------------------------------------------------------------ */
/*  Validates: Requirements 4.2, 4.5                                  */
/* ------------------------------------------------------------------ */

const mockQuery = jest.fn()
const mockPoolGetConnection = jest.fn()
const mockDecrypt = jest.fn()
const mockPreDeduct = jest.fn()
const mockComputeThrottleDelay = jest.fn()
const mockSleep = jest.fn()
const mockSignPrepareToken = jest.fn()
const mockGetTripoRegion = jest.fn()

const mockProviderIsEnabled = jest.fn()
const mockGetEnabledIds = jest.fn(() => ['tripo3d'])

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  pool: {
    getConnection: (...args: unknown[]) => mockPoolGetConnection(...args),
  },
}))

jest.mock('../services/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}))

jest.mock('../services/creditManager', () => ({
  computeThrottleDelay: (...args: unknown[]) => mockComputeThrottleDelay(...args),
  sleep: (...args: unknown[]) => mockSleep(...args),
}))

jest.mock('../services/sitePowerManager', () => ({
  sitePowerManager: {
    preDeduct: (...args: unknown[]) => mockPreDeduct(...args),
  },
}))

jest.mock('../services/prepareToken', () => ({
  signPrepareToken: (...args: unknown[]) => mockSignPrepareToken(...args),
}))

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    isEnabled: (...args: unknown[]) => mockProviderIsEnabled(...args),
    getEnabledIds: () => mockGetEnabledIds(),
    getDefaultId: jest.fn(() => mockGetEnabledIds()[0] ?? null),
  },
}))

jest.mock('../services/tripoRegion', () => ({
  getTripoRegion: (...args: unknown[]) => mockGetTripoRegion(...args),
}))

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createResponse() {
  const payload: { body?: unknown; headers: Record<string, string> } = { headers: {} }
  const res = {
    status: jest.fn().mockReturnThis(),
    set: jest.fn((key: string, value: string) => {
      payload.headers[key] = value
      return res
    }),
    json: jest.fn((body: unknown) => {
      payload.body = body
      return res
    }),
  } as unknown as Response

  return { res, payload }
}

function createLockedAccountConnection(row: Record<string, unknown> | null) {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    query: jest.fn().mockResolvedValue([row ? [row] : []]),
  }
}

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/** The two valid Tripo3D region values. */
const regionArb = fc.constantFrom('ai' as const, 'com' as const)

/** Expected apiBaseUrl mapping per region. */
const EXPECTED_API_BASE: Record<'ai' | 'com', string> = {
  ai: '/tripo-ai',
  com: '/tripo',
}

/* ------------------------------------------------------------------ */
/*  Property test                                                     */
/* ------------------------------------------------------------------ */

describe('Feature: tripo3d-dual-region, Property 6: prepareTask 返回正确区域的 API 端点', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetEnabledIds.mockReturnValue(['tripo3d'])
    mockProviderIsEnabled.mockReturnValue(true)
    mockDecrypt.mockReturnValue('real-provider-api-key')
    mockComputeThrottleDelay.mockReturnValue(0)
    mockSleep.mockResolvedValue(undefined)
    mockPreDeduct.mockResolvedValue({ success: true, walletDeducted: 1.43, poolDeducted: 0 })
    mockSignPrepareToken.mockReturnValue('prepare-token-001')
  })

  it('apiBaseUrl matches the region returned by getTripoRegion', async () => {
    await fc.assert(
      fc.asyncProperty(regionArb, async (region) => {
        // Mock getTripoRegion to return the generated region
        mockGetTripoRegion.mockResolvedValue(region)

        // Mock DB queries: api key lookup, max_delay_ms, api_mode
        mockQuery
          .mockResolvedValueOnce([{ value: 'encrypted-api-key' }])
          .mockResolvedValueOnce([{ value: '30000' }])
          .mockResolvedValueOnce([{ value: 'direct' }])

        mockPoolGetConnection.mockResolvedValue(
          createLockedAccountConnection({
            wallet_balance: '10.00',
            pool_balance: '5.00',
            pool_baseline: '5.00',
            next_cycle_at: null,
          }),
        )

        const req = {
          body: { type: 'text_to_model', provider_id: 'tripo3d' },
          user: { userId: 1 },
        } as unknown as Parameters<typeof prepareTask>[0]
        const { res, payload } = createResponse()

        await prepareTask(req, res)

        expect(res.status).toHaveBeenCalledWith(200)
        const body = payload.body as { apiBaseUrl: string }
        expect(body.apiBaseUrl).toBe(EXPECTED_API_BASE[region])

        // Verify getTripoRegion was called
        expect(mockGetTripoRegion).toHaveBeenCalled()

        // Clean up mock call history for next iteration
        jest.clearAllMocks()
        mockGetEnabledIds.mockReturnValue(['tripo3d'])
        mockProviderIsEnabled.mockReturnValue(true)
        mockDecrypt.mockReturnValue('real-provider-api-key')
        mockComputeThrottleDelay.mockReturnValue(0)
        mockSleep.mockResolvedValue(undefined)
        mockPreDeduct.mockResolvedValue({ success: true, walletDeducted: 1.43, poolDeducted: 0 })
        mockSignPrepareToken.mockReturnValue('prepare-token-001')
      }),
      { numRuns: 100 },
    )
  })
})
