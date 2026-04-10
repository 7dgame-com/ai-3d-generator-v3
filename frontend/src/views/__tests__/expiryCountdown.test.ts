import { describe, expect, it } from 'vitest'
import { formatExpiryCountdown } from '../generatorTaskMeta'

describe('Feature: task-expiry-pagination, formatExpiryCountdown', () => {
  it('formats an expiry countdown and marks urgent windows', () => {
    const now = new Date('2026-04-09T10:00:00.000Z')
    const soon = new Date('2026-04-09T10:15:00.000Z')

    const result = formatExpiryCountdown(soon.toISOString(), now.getTime())

    expect(result).toEqual({
      text: '剩余 15分',
      urgent: true,
    })
  })

  it('formats multi-day expiry countdowns as days, hours, and minutes', () => {
    const now = new Date('2026-04-09T15:38:13.000Z')
    const future = new Date('2026-04-16T13:53:54.000Z')

    const result = formatExpiryCountdown(future.toISOString(), now.getTime())

    expect(result).toEqual({
      text: '剩余 6天22小时15分',
      urgent: false,
    })
  })

  it('returns null for missing or expired expiry timestamps', () => {
    const now = new Date('2026-04-09T10:00:00.000Z').getTime()

    expect(formatExpiryCountdown(null, now)).toBeNull()
    expect(formatExpiryCountdown('2026-04-09T09:59:00.000Z', now)).toBeNull()
  })
})
