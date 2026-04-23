import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('early INIT handler', () => {
  it('caches INIT payload without sending a duplicate PLUGIN_READY', () => {
    const source = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const start = source.indexOf('function earlyHandler')
    const end = source.indexOf('// 从 URL 参数初始化主题')
    const earlyHandler = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(earlyHandler).toContain('__EARLY_INIT_PAYLOAD__')
    expect(earlyHandler).toContain("localStorage.setItem('ai-3d-gen-v3-token'")
    expect(earlyHandler).not.toContain('PLUGIN_READY')
    expect(earlyHandler).not.toContain('ready-early')
  })
})
