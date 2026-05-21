import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, '..', 'AdminView.vue'), 'utf8')

describe('AdminView account quota structure', () => {
  it('uses a compact account quota panel with a user quota table', () => {
    expect(source).toContain('class="panel quota-panel"')
    expect(source).toContain('class="quota-config"')
    expect(source).toContain('class="quota-summary-strip"')
    expect(source).toContain('class="user-quota-toolbar"')
    expect(source).toContain('class="quota-table"')
  })

  it('does not render the removed wallet, pond, cycle, or compatibility recharge surfaces', () => {
    expect(source).not.toContain('class="pond-chamber"')
    expect(source).not.toContain('class="wallet-cockpit"')
    expect(source).not.toContain('class="compat-console"')
    expect(source).not.toContain('class="compat-recharge-dialog"')
    expect(source).not.toContain('cycleProgress')
  })

  it('keeps responsive stacking rules for the simplified admin tool surface', () => {
    expect(source).toContain('@media (max-width: 900px)')
    expect(source).toContain('.quota-config')
    expect(source).toContain('.user-quota-toolbar')
  })
})
