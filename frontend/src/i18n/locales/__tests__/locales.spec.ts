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
})
