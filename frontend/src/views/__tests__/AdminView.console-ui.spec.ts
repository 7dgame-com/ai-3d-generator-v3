import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, '..', 'AdminView.vue'), 'utf8')

describe('AdminView unified console structure', () => {
  it('renders provider and site power as one console stack', () => {
    expect(source).toContain('class="admin-console"')
    expect(source).toContain('class="provider-console"')
    expect(source).toContain('class="site-power-console"')
    expect(source).toContain('class="provider-console__grid"')
    expect(source).toContain('class="site-power-console__grid"')
  })

  it('replaces the old compat form layout with a summary-form-preview console', () => {
    expect(source).toContain('class="compat-console__summary"')
    expect(source).toContain('class="compat-console__form"')
    expect(source).toContain('class="compat-console__preview-dock"')
    expect(source).not.toContain('class="compat-grid"')
    expect(source).not.toContain('class="compat-preview"')
  })

  it('defines the unified console style primitives and responsive layout hooks', () => {
    expect(source).toContain('.admin-console')
    expect(source).toContain('.console-head')
    expect(source).toContain('.provider-console__grid')
    expect(source).toContain('.site-power-console__grid')
    expect(source).toContain('.compat-console__summary')
    expect(source).toContain('.compat-console__body')
    expect(source).toContain('.compat-console__preview-dock')
    expect(source).toContain('@media (max-width: 960px)')
  })
})
