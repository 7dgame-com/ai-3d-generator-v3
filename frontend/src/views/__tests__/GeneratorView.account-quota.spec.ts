import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('GeneratorView account quota strip', () => {
  it('renders current account remaining and used power from credit status', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../GeneratorView.vue'), 'utf8')

    expect(source).toContain('data-test="account-quota-strip"')
    expect(source).toContain('quotaRemainingPower')
    expect(source).toContain('quotaUsedPower')
    expect(source).toContain("t('generator.accountQuota')")
    expect(source).toContain("t('generator.remainingPower')")
    expect(source).toContain("t('generator.usedPower')")
  })
})
