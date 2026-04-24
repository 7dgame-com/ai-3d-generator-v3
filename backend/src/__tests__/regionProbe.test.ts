import { probeRegion, REGION_ENDPOINTS } from '../services/regionProbe'

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function ok200(): Partial<Response> {
  return { ok: true, status: 200, statusText: 'OK' }
}

function unauthorized401(): Partial<Response> {
  return { ok: false, status: 401, statusText: 'Unauthorized' }
}

function timeoutError(): Error {
  const err = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  return err
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('probeRegion', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns "com" when only .com returns 200', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('tripo3d.com')) {
        return Promise.resolve(ok200())
      }
      // .ai returns 401
      return Promise.resolve(unauthorized401())
    })

    const region = await probeRegion('test-api-key')
    expect(region).toBe('com')
  })

  it('returns "ai" when only .ai returns 200', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('tripo3d.ai')) {
        return Promise.resolve(ok200())
      }
      // .com returns 401
      return Promise.resolve(unauthorized401())
    })

    const region = await probeRegion('test-api-key')
    expect(region).toBe('ai')
  })

  it('throws when both endpoints return 401', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve(unauthorized401())
    })

    await expect(probeRegion('bad-key')).rejects.toThrow()
  })

  it('returns "ai" when .com times out and .ai returns 200', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('tripo3d.com')) {
        return Promise.reject(timeoutError())
      }
      // .ai returns 200
      return Promise.resolve(ok200())
    })

    const region = await probeRegion('test-api-key')
    expect(region).toBe('ai')
  })

  it('throws when both endpoints time out', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      return Promise.reject(timeoutError())
    })

    await expect(probeRegion('timeout-key')).rejects.toThrow()
  })

  it('sends correct Authorization header and hits /user/balance', async () => {
    const apiKey = 'my-secret-key'
    global.fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve(ok200())
    })

    await probeRegion(apiKey)

    const calls = (global.fetch as jest.Mock).mock.calls
    expect(calls).toHaveLength(2)

    // Both calls should hit /user/balance with Bearer token
    for (const [url, opts] of calls) {
      expect(url).toMatch(/\/user\/balance$/)
      expect(opts.headers).toEqual({ Authorization: `Bearer ${apiKey}` })
      expect(opts.signal).toBeDefined()
    }
  })

  it('probes both region endpoints', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve(ok200())
    })

    await probeRegion('any-key')

    const urls = (global.fetch as jest.Mock).mock.calls.map(([url]: [string]) => url)
    expect(urls).toContain(`${REGION_ENDPOINTS.com}/user/balance`)
    expect(urls).toContain(`${REGION_ENDPOINTS.ai}/user/balance`)
  })
})
