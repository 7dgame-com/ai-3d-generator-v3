import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { displayPower, formatDuration, providerLabel } from '../generatorTaskMeta'

describe('Feature: hyper3d-gen2-upgrade, generatorTaskMeta helpers', () => {
  it('maps known provider IDs to display names', () => {
    expect(providerLabel('hyper3d')).toBe('Hyper3D')
    expect(providerLabel('tripo3d')).toBe('Tripo3D')
    expect(providerLabel('custom-provider')).toBe('custom-provider')
  })

  it('formats example durations in zh-CN style', () => {
    expect(formatDuration('2026-04-08T00:00:00.000Z', '2026-04-08T00:02:30.000Z', 'zh-CN')).toBe('2 分 30 秒')
    expect(formatDuration('2026-04-08T00:00:00.000Z', '2026-04-08T00:00:08.000Z', 'zh-CN')).toBe('0 分 8 秒')
  })

  it('formats example durations in en-US style', () => {
    expect(formatDuration('2026-04-08T00:00:00.000Z', '2026-04-08T00:02:30.000Z', 'en-US')).toBe('2 min 30 sec')
  })

  it('converts legacy provider credit cost into the unified power unit', () => {
    expect(displayPower(0, 30, 'tripo3d')).toBe(1)
    expect(displayPower(0, 0.5, 'hyper3d')).toBe(1)
  })

  it('prefers stored power_cost over fallback conversion', () => {
    expect(displayPower(2.5, 30, 'tripo3d')).toBe(2.5)
  })

  it('Property 3: formatted duration preserves the elapsed total seconds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 24 * 60 * 60 - 1 }), (seconds) => {
        const start = '2026-04-08T00:00:00.000Z'
        const end = new Date(Date.parse(start) + seconds * 1000).toISOString()
        const formatted = formatDuration(start, end, 'en-US')
        const match = formatted.match(/^(\d+) min (\d+) sec$/)

        expect(match).not.toBeNull()
        const [, minutes, secs] = match ?? []
        expect(Number(minutes) * 60 + Number(secs)).toBe(seconds)
      }),
      { numRuns: 100 }
    )
  })
})
