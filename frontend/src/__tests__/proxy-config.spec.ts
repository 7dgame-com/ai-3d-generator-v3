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
    expect(entrypoint).toContain('generate_lb_config "APP_AUTH" "/api-auth/" "auth"')
    expect(entrypoint).toContain('${ENV_PREFIX}_${i}_URL')
    expect(entrypoint).toContain('${API_LOCATIONS}${AUTH_LOCATIONS}')
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
    expect(viteConfig).toContain(`'/tripo-ai/': {
    target: 'https://api.tripo3d.ai',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\\/tripo-ai/, '/v2/openapi')
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
    const tripoAiCompatBlock = getNginxLocationBlock(template, '/tripo-ai/')

    expect(tripoBlock).toContain('set $tripo_host api.tripo3d.com')
    expect(tripoBlock).toContain('rewrite ^/tripo/(.*)$ /v2/openapi/$1 break')
    expect(tripoBlock).toContain('proxy_pass https://$tripo_host')
    expect(tripoBlock).toContain('proxy_ssl_name $tripo_host')
    expect(tripoBlock).toContain('proxy_set_header Host $tripo_host')
    expect(tripoBlock).toContain('proxy_set_header X-Forwarded-Proto https')
    expect(tripoBlock).toContain('proxy_redirect off')
    expect(tripoBlock).toContain("proxy_set_header Cookie ''")
    expect(tripoAltBlock).toContain('set $tripo_alt_host api.tripo3d.ai')
    expect(tripoAltBlock).toContain('rewrite ^/tripo-alt/(.*)$ /v2/openapi/$1 break')
    expect(tripoAltBlock).toContain('proxy_pass https://$tripo_alt_host')
    expect(tripoAltBlock).toContain('proxy_ssl_name $tripo_alt_host')
    expect(tripoAltBlock).toContain('proxy_set_header Host $tripo_alt_host')
    expect(tripoAltBlock).toContain('proxy_set_header X-Forwarded-Proto https')
    expect(tripoAltBlock).toContain('proxy_redirect off')
    expect(tripoAltBlock).toContain("proxy_set_header Cookie ''")
    expect(tripoAiCompatBlock).toContain('set $tripo_ai_host api.tripo3d.ai')
    expect(tripoAiCompatBlock).toContain('rewrite ^/tripo-ai/(.*)$ /v2/openapi/$1 break')
    expect(tripoAiCompatBlock).toContain('proxy_pass https://$tripo_ai_host')
    expect(tripoAiCompatBlock).toContain('proxy_ssl_name $tripo_ai_host')
    expect(tripoAiCompatBlock).toContain('proxy_set_header Host $tripo_ai_host')
    expect(tripoAiCompatBlock).toContain('proxy_set_header X-Forwarded-Proto https')
    expect(tripoAiCompatBlock).toContain('proxy_redirect off')
    expect(tripoAiCompatBlock).toContain("proxy_set_header Cookie ''")

    expect(template).toContain('location /hyper/')
    expect(template).toContain('set $hyper_host api.hyper3d.com')
    expect(template).toContain('rewrite ^/hyper/(.*)$ /api/v2/$1 break')
    expect(template).toContain('proxy_pass https://$hyper_host')
    expect(template).toContain('proxy_ssl_name $hyper_host')
    expect(template).toContain('proxy_set_header Host $hyper_host')
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
