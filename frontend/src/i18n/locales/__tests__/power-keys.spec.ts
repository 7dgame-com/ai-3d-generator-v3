import { describe, expect, it } from 'vitest'
import enUS from '../en-US'
import jaJP from '../ja-JP'
import thTH from '../th-TH'
import zhCN from '../zh-CN'
import zhTW from '../zh-TW'

const locales = [zhCN, zhTW, enUS, jaJP, thTH]

describe('power i18n keys', () => {
  it('exports power keys for generator and history in every locale', () => {
    locales.forEach((locale) => {
      expect(locale.generator.power).toContain('{n}')
      expect(locale.history.colPower).toBeTruthy()
      expect(locale.admin.balancePower).toBeTruthy()
      expect(locale.admin.statusOnline).toBeTruthy()
      expect(locale.admin.previewDockTitle).toBeTruthy()
    })
  })

  it('removes deprecated credits keys from every locale', () => {
    locales.forEach((locale) => {
      expect(locale.generator).not.toHaveProperty('credits')
      expect(locale.history).not.toHaveProperty('colCredits')
    })
  })
})
