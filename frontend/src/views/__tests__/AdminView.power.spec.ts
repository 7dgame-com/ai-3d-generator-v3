import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, '..', 'AdminView.vue'), 'utf8')

describe('AdminView power wiring', () => {
  it('uses availablePower and totalPower for admin displays', () => {
    expect(source).toContain('availablePower')
    expect(source).toContain('adminUsage.value?.totalPower')
    expect(source).not.toContain("adminUsage?.totalCredits ?? 0")
  })

  it('uses power-oriented i18n labels for quota and recharge fields', () => {
    expect(source).toContain("t('admin.walletBalance')")
    expect(source).toContain("t('admin.poolBalance')")
    expect(source).toContain("t('admin.walletAmount')")
    expect(source).toContain("t('admin.poolAmount')")
    expect(source).toContain("t('admin.balancePower',")
  })

  it('renders the dashboard sections and derived visual helpers for the single global account view', () => {
    expect(source).toContain("t('admin.providerOpsTitle')")
    expect(source).toContain("t('admin.quotaOverviewTitle')")
    expect(source).toContain('summaryCards')
    expect(source).toContain('quotaStatus')
    expect(source).toContain('poolFillStyle')
    expect(source).toContain('trendBarStyle')
  })

  it('keeps provider controls in the ops panel but removes provider_id from recharge payloads', () => {
    expect(source).toContain('loadBalance(provider)')
    expect(source).not.toContain('rechargeForm.provider_id')
    expect(source).not.toContain('provider_id: rechargeForm.provider_id')
  })
})
