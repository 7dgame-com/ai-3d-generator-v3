import { describe, expect, it } from 'vitest'
import enUS from '../en-US'
import jaJP from '../ja-JP'
import thTH from '../th-TH'
import zhCN from '../zh-CN'
import zhTW from '../zh-TW'

function collectKeyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : []
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key
    return collectKeyPaths(child, nextPrefix)
  })
}

describe('locale packs', () => {
  const zhCNKeyPaths = collectKeyPaths(zhCN).sort()
  const locales = [
    ['zh-TW', zhTW],
    ['en-US', enUS],
    ['ja-JP', jaJP],
    ['th-TH', thTH],
  ] as const

  it.each(locales)('%s matches the zh-CN key structure', (_localeName, locale) => {
    expect(collectKeyPaths(locale).sort()).toEqual(zhCNKeyPaths)
  })

  it.each(locales)('%s exports an independent translation object', (_localeName, locale) => {
    expect(locale).not.toBe(zhCN)
  })

  it.each([
    ['zh-CN', zhCN.pluginMeta.description],
    ['zh-TW', zhTW.pluginMeta.description],
    ['en-US', enUS.pluginMeta.description],
    ['ja-JP', jaJP.pluginMeta.description],
    ['th-TH', thTH.pluginMeta.description],
  ])('%s uses provider-neutral plugin copy', (_localeName, description) => {
    expect(description).not.toMatch(/Tripo3D|Hyper3D/i)
  })

  it('zh-CN defines the compatibility recharge locale keys', () => {
    const keys = collectKeyPaths(zhCN)

    expect(keys).toContain('admin.compatRechargeAction')
    expect(keys).toContain('admin.compatTotalPower')
    expect(keys).toContain('admin.compatWalletPercent')
    expect(keys).toContain('admin.compatPoolPercent')
    expect(keys).toContain('admin.compatRechargeValidationPercent')
    expect(keys).toContain('admin.compatRechargeValidationDuration')
    expect(keys).toContain('admin.compatPreviewWallet')
    expect(keys).toContain('admin.compatPreviewCycleHours')
  })

  it('zh-CN defines the unified admin console locale keys', () => {
    const keys = collectKeyPaths(zhCN)

    expect(keys).toContain('admin.compatSummarySplit')
    expect(keys).toContain('admin.compatSummaryDuration')
    expect(keys).toContain('admin.compatAllocationTitle')
    expect(keys).toContain('admin.compatScheduleTitle')
    expect(keys).toContain('admin.compatPreviewDockTitle')
  })
})
