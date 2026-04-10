import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatExpiryCountdown } from '../generatorTaskMeta'

const NOW_MS = Date.parse('2026-04-09T10:00:00.000Z')

describe('Feature: task-expiry-pagination, Property 5: 倒计时格式化正确性', () => {
  it('formats future expiry timestamps with the correct hours, minutes, and urgency flag', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 14 * 24 * 60 }), (minutesAhead) => {
        const expiresAt = new Date(NOW_MS + minutesAhead * 60_000).toISOString()
        const result = formatExpiryCountdown(expiresAt, NOW_MS)
        const days = Math.floor(minutesAhead / (24 * 60))
        const hours = Math.floor(minutesAhead / 60)
        const hoursWithinDay = Math.floor((minutesAhead % (24 * 60)) / 60)
        const minutes = minutesAhead % 60

        expect(result).not.toBeNull()
        expect(result).toEqual({
          text:
            days > 0
              ? `剩余 ${days}天${hoursWithinDay}小时${minutes}分`
              : hours > 0
                ? `剩余 ${hours}小时${minutes}分`
                : `剩余 ${minutes}分`,
          urgent: minutesAhead < 60,
        })
      }),
      { numRuns: 100 }
    )
  })

  it('returns null for missing or past expiry timestamps', () => {
    fc.assert(
      fc.property(fc.integer({ min: -72 * 60, max: 0 }), (minutesOffset) => {
        const expiresAt = new Date(NOW_MS + minutesOffset * 60_000).toISOString()

        expect(formatExpiryCountdown(expiresAt, NOW_MS)).toBeNull()
        expect(formatExpiryCountdown(null, NOW_MS)).toBeNull()
      }),
      { numRuns: 100 }
    )
  })
})
