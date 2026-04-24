import * as fc from 'fast-check'
import { probeRegion, REGION_ENDPOINTS, type TripoRegion } from '../services/regionProbe'

/* ------------------------------------------------------------------ */
/*  Validates: Requirements 1.1, 1.2, 1.3, 1.4                       */
/* ------------------------------------------------------------------ */

/**
 * Endpoint response outcome — models the three possible results of
 * probing a single region endpoint.
 */
type EndpointOutcome = 'success' | 'authError' | 'timeout'

/** Build a mock fetch that returns deterministic results per region. */
function buildMockFetch(
  comOutcome: EndpointOutcome,
  aiOutcome: EndpointOutcome,
): jest.Mock {
  return jest.fn().mockImplementation((url: string) => {
    const isAi = url.includes('tripo3d.ai')
    const outcome = isAi ? aiOutcome : comOutcome

    switch (outcome) {
      case 'success':
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK' })
      case 'authError':
        return Promise.resolve({ ok: false, status: 401, statusText: 'Unauthorized' })
      case 'timeout':
        return Promise.reject(
          new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
        )
    }
  })
}

/** Determine expected result from a pair of endpoint outcomes. */
function expectedResult(
  comOutcome: EndpointOutcome,
  aiOutcome: EndpointOutcome,
): { shouldSucceed: true; possibleRegions: TripoRegion[] } | { shouldSucceed: false } {
  const comOk = comOutcome === 'success'
  const aiOk = aiOutcome === 'success'

  if (!comOk && !aiOk) {
    return { shouldSucceed: false }
  }

  // When both succeed, Promise.any returns whichever resolves first —
  // since both are instant mocks the order is deterministic but
  // implementation-dependent, so we accept either.
  if (comOk && aiOk) {
    return { shouldSucceed: true, possibleRegions: ['com', 'ai'] }
  }

  return {
    shouldSucceed: true,
    possibleRegions: [comOk ? 'com' : 'ai'],
  }
}

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/** Random API Key — non-empty printable ASCII string. */
const apiKeyArb = fc.string({ minLength: 1, maxLength: 64 })

/** Random endpoint outcome. */
const outcomeArb: fc.Arbitrary<EndpointOutcome> = fc.constantFrom(
  'success',
  'authError',
  'timeout',
)

/* ------------------------------------------------------------------ */
/*  Property test                                                     */
/* ------------------------------------------------------------------ */

describe('Feature: tripo3d-dual-region, Property 1: 区域探测正确性', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it(
    'returns the correct region when at least one endpoint succeeds, ' +
      'and throws when all endpoints fail',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          apiKeyArb,
          outcomeArb,
          outcomeArb,
          async (apiKey: string, comOutcome: EndpointOutcome, aiOutcome: EndpointOutcome) => {
            // Arrange
            global.fetch = buildMockFetch(comOutcome, aiOutcome)

            const expected = expectedResult(comOutcome, aiOutcome)

            if (expected.shouldSucceed) {
              // Act — should resolve to one of the possible regions
              const region = await probeRegion(apiKey)
              expect(expected.possibleRegions).toContain(region)
            } else {
              // Act — should reject (AggregateError from Promise.any)
              await expect(probeRegion(apiKey)).rejects.toThrow()
            }

            // Verify both endpoints were probed
            const calls = (global.fetch as jest.Mock).mock.calls
            expect(calls).toHaveLength(2)

            const urls = calls.map(([url]: [string]) => url)
            expect(urls).toContain(`${REGION_ENDPOINTS.com}/user/balance`)
            expect(urls).toContain(`${REGION_ENDPOINTS.ai}/user/balance`)

            // Verify Authorization header carries the provided key
            for (const [, opts] of calls) {
              expect(opts.headers).toEqual({
                Authorization: `Bearer ${apiKey}`,
              })
            }
          },
        ),
        { numRuns: 100 },
      )
    },
  )
})
