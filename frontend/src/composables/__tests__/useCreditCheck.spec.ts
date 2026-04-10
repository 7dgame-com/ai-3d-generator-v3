import fc from 'fast-check'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCreditStatus = vi.fn()
const can = vi.fn()
const isRootUser = ref(false)

vi.mock('../../api', () => ({
  getCreditStatus,
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

  it('returns true iff the global account has no available credits', async () => {
    const { isAllCreditsZero } = await import('../useCreditCheck')

    await fc.assert(
      fc.asyncProperty(
        fc.option(
          fc.record({
            wallet_balance: fc.integer({ min: -1000, max: 1000 }),
            pool_balance: fc.integer({ min: -1000, max: 1000 }),
            pool_baseline: fc.integer({ min: -1000, max: 1000 }),
            cycles_remaining: fc.integer({ min: 0, max: 1000 }),
            cycle_duration: fc.integer({ min: 0, max: 100000 }),
            total_duration: fc.integer({ min: 0, max: 100000 }),
            cycle_started_at: fc.option(fc.string(), { nil: null }),
            next_cycle_at: fc.option(fc.string(), { nil: null }),
          }),
          { nil: null }
        ),
        async (status) => {
          const expected = !!status && status.wallet_balance + status.pool_balance <= 0
          expect(isAllCreditsZero(status)).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('opens the dialog after a successful zero-credit check and exposes admin status', async () => {
    can.mockImplementation((permission: string) => permission === 'admin-config')
    isRootUser.value = true
    getCreditStatus.mockResolvedValue({
      data: {
        data: {
          wallet_balance: 0,
          pool_balance: 0,
          pool_baseline: 0,
          cycles_remaining: 0,
          cycle_duration: 0,
          total_duration: 0,
          cycle_started_at: null,
          next_cycle_at: null,
        },
      },
    })

    const { useCreditCheck } = await import('../useCreditCheck')
    const creditCheck = useCreditCheck()

    expect(creditCheck.showCreditDialog.value).toBe(false)
    expect(creditCheck.isAdmin.value).toBe(true)

    await creditCheck.checkCredits()

    expect(getCreditStatus).toHaveBeenCalledTimes(1)
    expect(creditCheck.showCreditDialog.value).toBe(true)
  })

  it('does not expose admin recharge affordances to non-root operators', async () => {
    can.mockImplementation((permission: string) => permission === 'admin-config')
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
