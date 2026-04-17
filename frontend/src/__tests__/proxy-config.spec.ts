import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('provider reverse proxy config', () => {
  it('proxies shared plugin permission requests through api-config in dev and preview', () => {
    const viteConfigPath = path.resolve(__dirname, '../../vite.config.ts')
    const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8')

    expect(viteConfig).toContain("'/api-config/': {")
    expect(viteConfig).toContain("target: 'http://localhost:8088'")
    expect(viteConfig).toContain("rewrite: (path: string) => path.replace(/^\\/api-config/, '')")
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

  it('ships matching docker api-config upstream wiring for runtime permission checks', () => {
    const entrypointPath = path.resolve(__dirname, '../../docker-entrypoint.sh')
    const entrypoint = fs.readFileSync(entrypointPath, 'utf-8')
    const nginxTemplatePath = path.resolve(__dirname, '../../nginx.conf.template')
    const nginxTemplate = fs.readFileSync(nginxTemplatePath, 'utf-8')
    const composePath = path.resolve(process.cwd(), '../../../driver/docker-compose.yml')
    const compose = fs.readFileSync(composePath, 'utf-8')

    expect(entrypoint).toContain('generate_lb_config "APP_CONFIG" "/api-config/" "config"')
    expect(entrypoint).toContain('APP_CONFIG_${i}_URL')
    expect(nginxTemplate).toContain('# __CONFIG_LOCATIONS__')
    expect(compose).toContain('APP_CONFIG_1_URL=http://system-admin-backend:8088')
  })

  it('registers Vite reverse proxies for Tripo3D and Hyper3D', () => {
    const viteConfigPath = path.resolve(__dirname, '../../vite.config.ts')
    const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8')

    expect(viteConfig).toContain("'/tripo/': {")
    expect(viteConfig).toContain("target: 'https://api.tripo3d.ai'")
    expect(viteConfig).toContain("rewrite: (path: string) => path.replace(/^\\/tripo/, '/v2/openapi')")

    expect(viteConfig).toContain("'/hyper/': {")
    expect(viteConfig).toContain("target: 'https://api.hyper3d.com'")
    expect(viteConfig).toContain("rewrite: (path: string) => path.replace(/^\\/hyper/, '/api/v2')")
  })

  it('ships matching Nginx reverse proxy locations for both providers', () => {
    const templatePath = path.resolve(__dirname, '../../nginx.conf.template')
    const template = fs.readFileSync(templatePath, 'utf-8')

    expect(template).toContain('location /tripo/')
    expect(template).toContain('proxy_pass https://api.tripo3d.ai/v2/openapi/')
    expect(template).toContain('proxy_set_header Host api.tripo3d.ai')
    expect(template).toContain("proxy_set_header Cookie ''")

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
