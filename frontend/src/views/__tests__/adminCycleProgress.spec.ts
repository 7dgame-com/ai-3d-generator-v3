import { describe, expect, it } from 'vitest'
import { getCycleProgress } from '../adminCycleProgress'

describe('getCycleProgress', () => {
  it('derives elapsed minutes and percentage from the current cycle window', () => {
    const result = getCycleProgress(
      {
        cycle_started_at: '2026-04-12T00:00:00.000Z',
        next_cycle_at: '2026-04-12T04:00:00.000Z',
        cycle_duration: 240,
      },
      Date.parse('2026-04-12T01:00:00.000Z')
    )

    expect(result).toEqual({
      elapsedMinutes: 60,
      fillPercent: 25,
      percent: 25,
      totalMinutes: 240,
    })
  })

  it('falls back to cycle_duration when next_cycle_at is missing', () => {
    const result = getCycleProgress(
      {
        cycle_started_at: '2026-04-12T00:00:00.000Z',
        next_cycle_at: null,
        cycle_duration: 90,
      },
      Date.parse('2026-04-12T00:45:00.000Z')
    )

    expect(result).toEqual({
      elapsedMinutes: 45,
      fillPercent: 50,
      percent: 50,
      totalMinutes: 90,
    })
  })
})
