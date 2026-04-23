import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function getNginxLocationBlock(template: string, location: string): string {
  const start = template.indexOf(`location ${location} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = template.indexOf('\n    }', start)
  expect(end).toBeGreaterThan(start)
  return template.slice(start, end)
}

describe('provider reverse proxy config', () => {
  it('uses only main api and plugin backend proxies in dev and preview', () => {
    const viteConfigPath = path.resolve(__dirname, '../../vite.config.ts')
    const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8')

    expect(viteConfig).not.toContain("'/api-config/': {")
    expect(viteConfig).toContain("'/api/': {")
    expect(viteConfig).toContain("target: 'http://localhost:8081'")
    expect(viteConfig).toContain('preview: {')
    expect(viteConfig).toContain('proxy: proxyConfig')
  })

  it('rewrites plugin backend requests to the backend root paths', () => {
    const viteConfigPath = path.resolve(__dirname, '../../vite.config.ts')
    const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8')

    expect(viteConfig).toContain("'/backend/': {")
    expect(viteConfig).toContain("target: 'http://localhost:8089'")
    expect(viteConfig).toContain("rewrite: (path: string) => path.replace(/^\\/backend/, '')")
  })

  it('reuses the same proxy config during Vite preview', () => {
    const viteConfigPath = path.resolve(__dirname, '../../vite.config.ts')
    const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8')

    expect(viteConfig).toContain('const proxyConfig = {')
    expect(viteConfig).toContain('server: {')
    expect(viteConfig).toContain('proxy: proxyConfig')
    expect(viteConfig).toContain('preview: {')
    expect(viteConfig).toContain('proxy: proxyConfig')
  })

  it('ships docker runtime wiring without api-config upstreams', () => {
    const entrypointPath = path.resolve(__dirname, '../../docker-entrypoint.sh')
    const entrypoint = fs.readFileSync(entrypointPath, 'utf-8')
    const nginxTemplatePath = path.resolve(__dirname, '../../nginx.conf.template')
    const nginxTemplate = fs.readFileSync(nginxTemplatePath, 'utf-8')
    const composePath = path.resolve(process.cwd(), '../../../driver/docker-compose.yml')
    const compose = fs.readFileSync(composePath, 'utf-8')
    const ai3dFrontendBlock =
      compose.match(/  ai-3d-generator-v3-frontend:[\s\S]*?(?=\n  [A-Za-z0-9_-]+:|\nvolumes:|\n$)/)?.[0] ?? ''
    const ai3dBackendBlock =
      compose.match(/  ai-3d-generator-v3-backend:[\s\S]*?(?=\n  [A-Za-z0-9_-]+:|\nvolumes:|\n$)/)?.[0] ?? ''

    expect(entrypoint).not.toContain('generate_lb_config "APP_CONFIG" "/api-config/" "config"')
    expect(entrypoint).not.toContain('APP_CONFIG_${i}_URL')
    expect(nginxTemplate).not.toContain('# __CONFIG_LOCATIONS__')
    expect(ai3dFrontendBlock).not.toContain('APP_CONFIG_')
    expect(ai3dBackendBlock).not.toContain('APP_CONFIG_')
    expect(ai3dBackendBlock).toContain('APP_API_1_URL=http://api:80')
  })

  it('registers Vite reverse proxies for Tripo3D and Hyper3D', () => {
    const viteConfigPath = path.resolve(__dirname, '../../vite.config.ts')
    const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8')

    expect(viteConfig).toContain(`'/tripo/': {
    target: 'https://api.tripo3d.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\\/tripo/, '/v2/openapi')
  }`)
    expect(viteConfig).toContain(`'/tripo-alt/': {
    target: 'https://api.tripo3d.ai',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\\/tripo-alt/, '/v2/openapi')
  }`)

    expect(viteConfig).toContain("'/hyper/': {")
    expect(viteConfig).toContain("target: 'https://api.hyper3d.com'")
    expect(viteConfig).toContain("rewrite: (path: string) => path.replace(/^\\/hyper/, '/api/v2')")
  })

  it('ships matching Nginx reverse proxy locations for both providers', () => {
    const templatePath = path.resolve(__dirname, '../../nginx.conf.template')
    const template = fs.readFileSync(templatePath, 'utf-8')
    const tripoBlock = getNginxLocationBlock(template, '/tripo/')
    const tripoAltBlock = getNginxLocationBlock(template, '/tripo-alt/')

    expect(tripoBlock).toContain('proxy_pass https://api.tripo3d.com/v2/openapi/')
    expect(tripoBlock).toContain('proxy_set_header Host api.tripo3d.com')
    expect(tripoBlock).toContain('proxy_set_header X-Forwarded-Proto https')
    expect(tripoBlock).toContain('proxy_redirect off')
    expect(tripoBlock).toContain("proxy_set_header Cookie ''")
    expect(tripoAltBlock).toContain('proxy_pass https://api.tripo3d.ai/v2/openapi/')
    expect(tripoAltBlock).toContain('proxy_set_header Host api.tripo3d.ai')
    expect(tripoAltBlock).toContain('proxy_set_header X-Forwarded-Proto https')
    expect(tripoAltBlock).toContain('proxy_redirect off')
    expect(tripoAltBlock).toContain("proxy_set_header Cookie ''")

    expect(template).toContain('location /hyper/')
    expect(template).toContain('proxy_pass https://api.hyper3d.com/api/v2/')
    expect(template).toContain('proxy_set_header Host api.hyper3d.com')
    expect(template).toContain("proxy_set_header Cookie ''")
  })

  it('uses direct upstream proxying for single-backend Docker locations', () => {
    const entrypointPath = path.resolve(__dirname, '../../docker-entrypoint.sh')
    const entrypoint = fs.readFileSync(entrypointPath, 'utf-8')

    expect(entrypoint).toContain('Mode: single backend (direct upstream)')
    expect(entrypoint).toContain('proxy_pass ${url};')
    expect(entrypoint).not.toContain('proxy_pass \\$${PREFIX_NAME}_single_backend;')
    expect(entrypoint).not.toContain('resolver-enabled')
  })
})
