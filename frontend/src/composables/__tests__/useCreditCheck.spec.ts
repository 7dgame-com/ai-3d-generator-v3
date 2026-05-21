import fc from 'fast-check'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCreditStatus = vi.fn()
const can = vi.fn()
const isRootUser = ref(false)

vi.mock('../../api', () => ({
  getCreditStatus,
}))

vi.mock('../useAuthSession', () => ({
  useAuthSession: () => ({
    isRootUser,
  }),
}))

vi.mock('../usePermissions', () => ({
  usePermissions: () => ({
    can,
    isRootUser,
  }),
}))

describe('Feature: ai-3d-v3-i18n-credit-dialog, Property 1: Credit exhaustion detection correctness', () => {
  beforeEach(() => {
    getCreditStatus.mockReset()
    can.mockReset()
    can.mockReturnValue(false)
    isRootUser.value = false
  })

  it('returns true iff the current account has no remaining quota', async () => {
    const { isAllCreditsZero } = await import('../useCreditCheck')

    await fc.assert(
      fc.asyncProperty(
        fc.option(
          fc.record({
            tool: fc.constant('simple-user-usage-quota' as const),
            user_id: fc.integer({ min: 1, max: 100000 }),
            quota_limit: fc.integer({ min: 0, max: 1000 }),
            used_power: fc.integer({ min: 0, max: 1000 }),
            remaining_power: fc.integer({ min: -1000, max: 1000 }),
            has_record: fc.boolean(),
            updated_at: fc.option(fc.string(), { nil: null }),
          }),
          { nil: null }
        ),
        async (status) => {
          const expected = !!status && status.remaining_power <= 0
          expect(isAllCreditsZero(status)).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('opens the dialog after a successful zero-credit check and exposes admin status', async () => {
    can.mockReturnValue(false)
    isRootUser.value = true
    getCreditStatus.mockResolvedValue({
      data: {
        data: {
          tool: 'simple-user-usage-quota',
          user_id: 7,
          quota_limit: 100,
          used_power: 100,
          remaining_power: 0,
          has_record: true,
          updated_at: '2026-05-21T00:00:00.000Z',
        },
      },
    })

    const { useCreditCheck } = await import('../useCreditCheck')
    const creditCheck = useCreditCheck()

    expect(creditCheck.showCreditDialog.value).toBe(false)
    expect(creditCheck.isAdmin.value).toBe(true)

    await creditCheck.checkCredits()

    expect(getCreditStatus).toHaveBeenCalledTimes(1)
    expect(creditCheck.quotaStatus.value).toMatchObject({
      used_power: 100,
      remaining_power: 0,
    })
    expect(creditCheck.isCheckingCredits.value).toBe(false)
    expect(creditCheck.showCreditDialog.value).toBe(true)
  })

  it('does not expose admin recharge affordances to non-root operators', async () => {
    can.mockReturnValue(true)
    isRootUser.value = false

    const { useCreditCheck } = await import('../useCreditCheck')
    const creditCheck = useCreditCheck()

    expect(creditCheck.isAdmin.value).toBe(false)
  })

  it('keeps the dialog hidden when the credit check API fails', async () => {
    getCreditStatus.mockRejectedValue(new Error('boom'))

    const { useCreditCheck } = await import('../useCreditCheck')
    const creditCheck = useCreditCheck()

    await expect(creditCheck.checkCredits()).resolves.toBeUndefined()
    expect(creditCheck.quotaStatus.value).toBe(null)
    expect(creditCheck.isCheckingCredits.value).toBe(false)
    expect(creditCheck.showCreditDialog.value).toBe(false)
  })

  it('supports manual open and close for insufficient-credit task creation responses', async () => {
    const { useCreditCheck } = await import('../useCreditCheck')
    const creditCheck = useCreditCheck()

    creditCheck.triggerDialog()
    expect(creditCheck.showCreditDialog.value).toBe(true)

    creditCheck.closeDialog()
    expect(creditCheck.showCreditDialog.value).toBe(false)
  })
})
