import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('admin root-only wiring', () => {
  it('marks the admin route as root-only in the router guard', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../router/index.ts'), 'utf8')

    expect(source).toContain("path: '/api-diagnostics'")
    expect(source).toContain("name: 'ApiDiagnostics'")
    expect(source).toContain("meta: { public: true, title: 'API Diagnostics' }")
    expect(source).toContain('requiresRoot: true')
    expect(source).toContain('to.meta.requiresRoot')
    expect(source).toContain('fetchSession')
    expect(source).not.toContain('requiresPermission')
    expect(source).toContain("return '/no-permission'")
  })

  it('ships a public API diagnostics page for standalone connectivity checks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../views/ApiDiagnosticsView.vue'), 'utf8')

    expect(source).toContain('API 诊断面板')
    expect(source).toContain('/api/v1/plugin/verify-token')
    expect(source).toContain('/backend/health')
    expect(source).toContain('/tripo/')
    expect(source).toContain('/hyper/')
    expect(source).toContain('/debug-env')
    expect(source).toContain('x-upstream-addr')
    expect(source).toContain('502 || resp.status === 503 || resp.status === 504')
  })

  it('shows navigation using auth-only history and root-only admin rules', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../layout/AppLayout.vue'), 'utf8')

    expect(source).toContain('<router-link to="/history">')
    expect(source).toContain('v-if="isRootUser"')
    expect(source).not.toContain("can('admin-config')")
    expect(source).not.toContain("can('view-usage')")
  })

  it('does not gate ordinary generator actions behind plugin permission names', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../views/GeneratorView.vue'), 'utf8')

    expect(source).not.toContain("can('generate-model')")
    expect(source).not.toContain("can('download-model')")
    expect(source).not.toContain("can('upload-to-main')")
    expect(source).not.toContain('fetchAllowedActions')
  })
})
