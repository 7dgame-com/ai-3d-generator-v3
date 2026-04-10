import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('admin root-only wiring', () => {
  it('marks the admin route as root-only in the router guard', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../router/index.ts'), 'utf8')

    expect(source).toContain('requiresRoot: true')
    expect(source).toContain('to.meta.requiresRoot')
    expect(source).toContain("return '/no-permission'")
  })

  it('shows the admin navigation entry only for root users with admin-config permission', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../layout/AppLayout.vue'), 'utf8')

    expect(source).toContain("can('admin-config') && isRootUser")
  })
})
