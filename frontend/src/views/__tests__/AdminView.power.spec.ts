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

  it('uses power-oriented i18n labels for the shared site quota dashboard', () => {
    expect(source).toContain("t('admin.walletBalance')")
    expect(source).toContain("t('admin.poolBalance')")
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

  it('renders a compat recharge button in the provider ops header and a site modal model', () => {
    expect(source).toContain("t('admin.compatRechargeAction')")
    expect(source).toContain('showCompatRechargeModal')
    expect(source).toContain('compatRechargeForm.totalPower')
    expect(source).toContain('compatRechargePreview')
    expect(source).not.toContain('targetUserId')
  })

  it('keeps provider controls in the ops panel but removes provider_id and userId from recharge payloads', () => {
    expect(source).toContain('loadBalance(provider)')
    expect(source).not.toContain('rechargeForm.provider_id')
    expect(source).not.toContain('provider_id: rechargeForm.provider_id')
    expect(source).not.toContain('userId: targetUserId.value')
  })

  it('derives cockpit badge state for the shared site account', () => {
    expect(source).toContain('quotaStatusTone')
    expect(source).toContain('quotaStatusLabel')
    expect(source).toContain("t('admin.statusOnline')")
    expect(source).toContain("t('admin.statusLowReserve')")
    expect(source).toContain("t('admin.statusDepleted')")
    expect(source).toContain("t('admin.statusStandby')")
  })

  it('builds KPI rows for the cockpit instead of only relying on the old status list', () => {
    expect(source).toContain('quotaKpis')
    expect(source).toContain('cyclesRemaining')
  })

  it('wires the quota cockpit to the derived KPI and status helpers', () => {
    expect(source).toContain('quotaKpis')
    expect(source).toContain('quotaStatusLabel')
    expect(source).toContain('quotaStatusTone')
    expect(source).toContain('formatDateTime(quotaStatus.cycle_started_at)')
  })
})
