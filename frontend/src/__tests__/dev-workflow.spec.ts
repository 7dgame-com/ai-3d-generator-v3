import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('local frontend development workflow', () => {
  it('provides a plugin-root script that runs the frontend with pnpm dev', () => {
    const scriptPath = path.resolve(__dirname, '../../../start-frontend-dev.sh')
    const script = fs.readFileSync(scriptPath, 'utf-8')

    expect(script).toContain('(cd "$SCRIPT_DIR/frontend" && pnpm run dev)')
    expect(script).toContain('localhost:3008')
    expect(script).toContain('localhost:8089')
  })

  it('documents pnpm frontend dev while preserving reverse proxy routes', () => {
    const readmePath = path.resolve(__dirname, '../../../README.md')
    const readme = fs.readFileSync(readmePath, 'utf-8')

    expect(readme).toContain('./start-frontend-dev.sh')
    expect(readme).toContain('cd frontend')
    expect(readme).toContain('pnpm run dev')
    expect(readme).toContain('/api/')
    expect(readme).toContain('/backend/')
    expect(readme).toContain('/tripo/')
    expect(readme).toContain('/hyper/')
    expect(readme).toContain('frontend/vite.config.ts')
  })
})
