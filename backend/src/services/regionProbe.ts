/**
 * Region probe service for Tripo3D.
 *
 * Determines which Tripo3D region (`.ai` or `.com`) an API Key belongs to
 * by probing both endpoints in parallel. The first endpoint returning
 * HTTP 200 wins.
 */

export const REGION_ENDPOINTS = {
  com: 'https://api.tripo3d.com/v2/openapi',
  ai: 'https://api.tripo3d.ai/v2/openapi',
} as const

export type TripoRegion = keyof typeof REGION_ENDPOINTS

const PROBE_TIMEOUT_MS = 5000

/**
 * Probes both Tripo3D region endpoints in parallel to determine which
 * region the given API Key belongs to.
 *
 * Uses `Promise.any` — the first endpoint returning HTTP 200 is the
 * target region. If all probes fail (timeout, auth error, network error),
 * an `AggregateError` is thrown.
 */
export async function probeRegion(apiKey: string): Promise<TripoRegion> {
  const probes = (Object.entries(REGION_ENDPOINTS) as [TripoRegion, string][]).map(
    async ([region, baseUrl]) => {
      const resp = await fetch(`${baseUrl}/user/balance`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (!resp.ok) throw new Error(`${region}: HTTP ${resp.status}`)
      return region
    }
  )

  return Promise.any(probes)
}
