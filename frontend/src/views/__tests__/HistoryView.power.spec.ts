import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, '..', 'HistoryView.vue'), 'utf8')

describe('HistoryView power wiring', () => {
  it('reads totalPower and monthPower in the summary text', () => {
    expect(source).toContain('summary?.totalPower')
    expect(source).toContain('summary?.monthPower')
    expect(source).not.toContain('summary?.totalCredits')
  })

  it('renders the powerUsed column with the power i18n key', () => {
    expect(source).toContain('prop="powerUsed"')
    expect(source).toContain("t('history.colPower')")
    expect(source).not.toContain('prop="creditsUsed"')
  })
})
