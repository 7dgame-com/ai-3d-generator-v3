import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, '..', 'AdminView.vue'), 'utf8')

describe('AdminView visual refresh structure', () => {
  it('renders the quota section as a dual cockpit instead of the old soft-card layout', () => {
    expect(source).toContain('class="quota-console"')
    expect(source).toContain('class="quota-kpi-strip"')
    expect(source).toContain('class="quota-console__grid"')
    expect(source).toContain('class="pond-chamber"')
    expect(source).toContain('class="wallet-cockpit"')
    expect(source).not.toContain('class="quota-visuals"')
    expect(source).not.toContain('class="wallet-widget"')
  })

  it('renders the compat recharge dialog as a split console with a preview dock', () => {
    expect(source).toContain('class="compat-console"')
    expect(source).toContain('class="compat-console__form"')
    expect(source).toContain('class="compat-console__preview"')
    expect(source).toContain("t('admin.previewDockTitle')")
    expect(source).not.toContain('class="compat-preview"')
  })

  it('defines the approved industrial tokens and responsive stacking rules', () => {
    expect(source).toContain('--console-bg')
    expect(source).toContain('--pond-a')
    expect(source).toContain('--wallet-a')
    expect(source).toContain('.quota-status-pill')
    expect(source).toContain('.pond-chamber__tank')
    expect(source).toContain('.compat-console__preview')
    expect(source).toContain('class="compat-recharge-dialog"')
    expect(source).toContain('.compat-recharge-dialog .el-dialog__header')
    expect(source).toContain('@media (max-width: 960px)')
  })
})
