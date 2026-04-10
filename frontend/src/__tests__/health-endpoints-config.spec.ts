import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const template = fs.readFileSync(path.resolve(process.cwd(), 'nginx.conf.template'), 'utf-8')

describe('frontend nginx health endpoint config', () => {
  it('uses exact match locations for /health and /health.json', () => {
    expect(template).toMatch(/location\s*=\s*\/health\s*\{/)
    expect(template).toMatch(/location\s*=\s*\/health\.json\s*\{/)
    expect(template).not.toMatch(/location\s+\/health\s*\{/)
  })

  it('uses exact match locations for /debug-env and /debug-env.json', () => {
    expect(template).toMatch(/location\s*=\s*\/debug-env\s*\{/)
    expect(template).toMatch(/location\s*=\s*\/debug-env\.json\s*\{/)
    expect(template).not.toMatch(/location\s+\/debug-env\s*\{/)
  })
})
