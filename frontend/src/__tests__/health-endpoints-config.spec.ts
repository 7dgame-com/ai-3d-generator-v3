import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const template = fs.readFileSync(path.resolve(process.cwd(), 'nginx.conf.template'), 'utf-8')
const entrypoint = fs.readFileSync(path.resolve(process.cwd(), 'docker-entrypoint.sh'), 'utf-8')

describe('frontend nginx health endpoint config', () => {
  it('uses exact match locations for /health and /health.json', () => {
    expect(template).toMatch(/location\s*=\s*\/health\s*\{/)
    expect(template).toMatch(/location\s*=\s*\/health\.json\s*\{/)
    expect(template).not.toMatch(/location\s+\/health\s*\{/)
  })

  it('returns 404 for both debug-env endpoints', () => {
    expect(template).toMatch(/location\s*=\s*\/debug-env\s*\{/)
    expect(template).toMatch(/location\s*=\s*\/debug-env\.json\s*\{/)
    expect(template).not.toMatch(/location\s+\/debug-env\s*\{/)
    expect(template).toMatch(/location\s*=\s*\/debug-env\s*\{[\s\S]*?return 404;/)
    expect(template).toMatch(/location\s*=\s*\/debug-env\.json\s*\{[\s\S]*?return 404;/)
    expect(template).toMatch(/location\s*=\s*\/api-diagnostics\s*\{[\s\S]*?return 404;/)
    expect(template).toMatch(/location\s*=\s*\/api-diagnostics\/\s*\{[\s\S]*?return 404;/)
    expect(entrypoint).not.toContain('DEBUG_LIST=')
    expect(entrypoint).toContain('rm -f /usr/share/nginx/html/debug-env.json')
  })
})
