import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'

// 生成北京时间版本号，格式：2026.03.25-0200
export function buildVersion(): string {
  const now = new Date()
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const y = beijing.getUTCFullYear()
  const M = String(beijing.getUTCMonth() + 1).padStart(2, '0')
  const d = String(beijing.getUTCDate()).padStart(2, '0')
  const h = String(beijing.getUTCHours()).padStart(2, '0')
  const m = String(beijing.getUTCMinutes()).padStart(2, '0')
  return `${y}.${M}.${d}-${h}${m}`
}

/**
 * 从 src/i18n/locales/*.ts 文件里提取 pluginMeta 字段，
 * 组装成 PluginPublicManifest JSON 字符串。
 * 使用正则解析（无需运行时），构建时零依赖。
 */
export function buildPluginManifest(): string {
  const localesDir = path.resolve(__dirname, 'src/i18n/locales')
  const langs = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'th-TH']

  const nameI18n: Record<string, string> = {}
  const descriptionI18n: Record<string, string> = {}
  const groupNameI18n: Record<string, string> = {}

  for (const lang of langs) {
    const file = path.join(localesDir, `${lang}.ts`)
    if (!fs.existsSync(file)) continue
    const src = fs.readFileSync(file, 'utf-8')

    const extract = (key: string): string | null => {
      const m = src.match(new RegExp(`${key}:\\s*['"]([^'"]+)['"]`))
      return m ? m[1] : null
    }

    const name = extract('name')
    const description = extract('description')
    const groupName = extract('groupName')

    if (name) nameI18n[lang] = name
    if (description) descriptionI18n[lang] = description
    if (groupName) groupNameI18n[lang] = groupName
  }

  const manifest = {
    id: 'ai-3d-generator-v3',
    schemaVersion: '1',
    nameI18n,
    descriptionI18n,
    group: {
      id: 'tools',
      nameI18n: groupNameI18n,
    },
  }

  return JSON.stringify(manifest, null, 2)
}

/**
 * Vite 插件：
 * - dev 模式：在 configureServer 中注册中间件，实时响应 /plugin-manifest.json
 * - build 模式：在 buildStart 钩子中写入 public/plugin-manifest.json
 */
function pluginManifestPlugin() {
  return {
    name: 'plugin-manifest',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/plugin-manifest.json', (_req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end(buildPluginManifest())
      })
      // dev 模式模拟 nginx 的 /health 和 /debug-env 端点
      server.middlewares.use('/health', (_req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ status: 'ok', mode: 'development' }))
      })
      server.middlewares.use('/debug-env', (_req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ hostname: 'localhost', buildTime: new Date().toISOString(), mode: 'development' }))
      })
    },
    buildStart() {
      const publicDir = path.resolve(__dirname, 'public')
      if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true })
      fs.writeFileSync(path.join(publicDir, 'plugin-manifest.json'), buildPluginManifest(), 'utf-8')
    },
  }
}

const proxyConfig = {
  '/api-config/': {
    target: 'http://localhost:8088',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api-config/, '')
  },
  '/api/': {
    target: 'http://localhost:8081',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, '')
  },
  '/backend/': {
    target: 'http://localhost:8089',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/backend/, '')
  },
  '/tripo/': {
    target: 'https://api.tripo3d.ai',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/tripo/, '/v2/openapi')
  },
  '/hyper/': {
    target: 'https://api.hyper3d.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/hyper/, '/api/v2')
  }
}

export default defineConfig({
  plugins: [vue(), pluginManifestPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },
  server: {
    port: 3008,
    proxy: proxyConfig
  },
  preview: {
    proxy: proxyConfig
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
})
