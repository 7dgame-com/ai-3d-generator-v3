import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, '..', 'AdminView.vue'), 'utf8')

describe('AdminView account quota wiring', () => {
  it('keeps provider balance reads while moving quota management to account usage APIs', () => {
    expect(source).toContain('availablePower')
    expect(source).toContain('getQuotaSummary')
    expect(source).toContain('updateDefaultQuotaLimit')
    expect(source).toContain('resetQuotaUsage')
    expect(source).toContain('resetUserQuotaUsage')
    expect(source).toContain('getUserQuotas')
    expect(source).toContain('adminUsage.value?.totalPower')
  })

  it('renders account quota controls instead of wallet, pond, or cycle controls', () => {
    expect(source).toContain("t('admin.accountQuotaTitle')")
    expect(source).toContain("t('admin.defaultQuotaLimit')")
    expect(source).toContain("t('admin.resetAllUsage')")
    expect(source).toContain("t('admin.resetSingleUserUsage')")
    expect(source).toContain("t('admin.userSearchPlaceholder')")
    expect(source).toContain('updateDefaultQuotaLimit(quotaLimitDraft.value)')
    expect(source).not.toContain('v-if="isRootUser" class="quota-limit-control"')
    expect(source).not.toContain("t('admin.walletBalance')")
    expect(source).not.toContain("t('admin.poolBalance')")
    expect(source).not.toContain("t('admin.compatRechargeAction')")
    expect(source).not.toContain('cycle_started_at')
  })

  it('derives provider total power from the loaded provider list', () => {
    expect(source).toMatch(
      /providers\.value\s*\.reduce\(\(sum, provider\) => sum \+ \(balances\[provider\]\?\.availablePower \?\? 0\), 0\)/
    )
    expect(source).not.toContain('(balances.tripo3d?.availablePower ?? 0) +')
    expect(source).not.toContain('balances.hyper3d?.availablePower')
  })

  it('shows quota table fields for accounts that already have plugin usage records', () => {
    expect(source).toContain('row.quota?.used_power ?? 0')
    expect(source).toContain('row.quota?.remaining_power ?? quotaLimit')
    expect(source).toContain("t('admin.accountQuotaHint')")
    expect(source).not.toContain('quotaRequestParams()')
    expect(source).toContain('canResetSingleUser(row)')
    expect(source).not.toContain("t('admin.noQuotaRecord')")
  })
})
