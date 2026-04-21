<template>
  <div class="diagnostics">
    <div class="diag-header">
      <div>
        <h2>API 诊断面板</h2>
        <p>检查 AI 3D Generator 前端、主后端、插件后端与外部 Provider 代理链路。</p>
      </div>
      <el-button type="primary" :loading="runningAll" @click="runAll">全部测试</el-button>
    </div>

    <section class="section">
      <h3>环境信息</h3>
      <div class="info-grid">
        <div class="info-item">
          <span class="label">当前页面地址</span>
          <code>{{ envInfo.location }}</code>
        </div>
        <div class="info-item">
          <span class="label">Origin</span>
          <code>{{ envInfo.origin }}</code>
        </div>
        <div class="info-item">
          <span class="label">backendApi baseURL</span>
          <code>{{ envInfo.backendApiBase }}</code>
        </div>
        <div class="info-item">
          <span class="label">mainApi baseURL</span>
          <code>{{ envInfo.mainApiBase }}</code>
        </div>
        <div class="info-item">
          <span class="label">Token 状态</span>
          <code :class="envInfo.hasToken ? 'ok' : 'warn'">{{ envInfo.hasToken ? '已设置' : '未设置' }}</code>
        </div>
        <div class="info-item">
          <span class="label">是否在 iframe 中</span>
          <code>{{ envInfo.isIframe ? '是' : '否' }}</code>
        </div>
        <div class="info-item">
          <span class="label">Nginx 上游配置</span>
          <code :class="envInfo.upstreams === '加载中...' ? '' : envInfo.upstreams ? 'ok' : 'warn'">
            {{ envInfo.upstreams || '未设置' }}
          </code>
        </div>
        <div class="info-item">
          <span class="label">容器 hostname</span>
          <code>{{ envInfo.hostname || '-' }}</code>
        </div>
        <div class="info-item">
          <span class="label">容器启动时间</span>
          <code>{{ envInfo.serverBuildTime || '-' }}</code>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <h3>反向代理连通性检测</h3>
          <p class="hint">直接用 fetch 探测 Nginx location，4xx 认证错误会视为代理已连通。</p>
        </div>
        <el-button type="primary" size="small" :loading="runningProxy" @click="runAllProxy">全部检测</el-button>
      </div>

      <el-table :data="proxyTests" stripe border>
        <el-table-column prop="name" label="代理路径" width="210" />
        <el-table-column label="请求 URL" min-width="280">
          <template #default="{ row }">
            <code class="url">{{ row.url }}</code>
          </template>
        </el-table-column>
        <el-table-column label="预期后端" min-width="260">
          <template #default="{ row }">
            <code class="url">{{ row.expectedBackend }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="140">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'pending'" type="info" size="small">待检测</el-tag>
            <el-tag v-else-if="row.status === 'loading'" type="warning" size="small">
              <el-icon class="is-loading"><Loading /></el-icon> 检测中
            </el-tag>
            <el-tag v-else-if="row.status === 'proxy-error'" type="danger" size="small">
              {{ row.httpStatus }} 代理异常
            </el-tag>
            <el-tag v-else-if="row.status === 'success'" type="success" size="small">
              {{ row.httpStatus }} 可达
            </el-tag>
            <el-tag v-else type="danger" size="small">
              {{ row.httpStatus || '不可达' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="诊断结果" min-width="380">
          <template #default="{ row }">
            <div v-if="row.status !== 'pending' && row.status !== 'loading'" class="resp-detail">
              <div class="diag-verdict" :class="row.verdict">{{ row.verdictText }}</div>
              <div v-if="row.upstreamAddr" class="upstream-addr">
                Nginx 实际连接的后端：<code>{{ row.upstreamAddr }}</code>
              </div>
              <div v-if="row.finalUrl" class="redirect-warn">
                最终地址：<code>{{ row.finalUrl }}</code>
              </div>
              <div v-if="row.responseHeaders" class="resp-headers">
                <span class="label">关键响应头：</span>
                <code>{{ row.responseHeaders }}</code>
              </div>
              <div class="resp-body">
                <span class="label">响应体前 300 字：</span>
                <pre>{{ row.responseBody }}</pre>
              </div>
              <div v-if="row.latency !== null" class="latency">响应耗时：{{ row.latency }}ms</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="runProxyTest(row)">检测</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <h3>API 端点测试</h3>
          <p class="hint">通过当前 Axios 实例发起请求，验证 baseURL、Token 拦截器与接口路径。</p>
        </div>
        <el-button type="primary" size="small" :loading="runningApi" @click="runAllApi">全部测试</el-button>
      </div>

      <el-table :data="apiTests" stripe border>
        <el-table-column prop="name" label="接口名称" width="210" />
        <el-table-column prop="method" label="方法" width="80" />
        <el-table-column label="请求地址" min-width="300">
          <template #default="{ row }">
            <code class="url">{{ row.fullUrl }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'pending'" type="info" size="small">待测试</el-tag>
            <el-tag v-else-if="row.status === 'loading'" type="warning" size="small">
              <el-icon class="is-loading"><Loading /></el-icon> 测试中
            </el-tag>
            <el-tag v-else-if="row.status === 'success'" type="success" size="small">{{ row.httpStatus }} OK</el-tag>
            <el-tag v-else type="danger" size="small">{{ row.httpStatus || '失败' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="响应详情" min-width="360">
          <template #default="{ row }">
            <div v-if="row.status === 'success' || row.status === 'error'" class="resp-detail">
              <div v-if="row.responseHeaders" class="resp-headers">
                <span class="label">响应头：</span>
                <code>{{ row.responseHeaders }}</code>
              </div>
              <div class="resp-body">
                <span class="label">响应体：</span>
                <pre>{{ row.responseBody }}</pre>
              </div>
              <div v-if="row.errorMessage" class="error-msg">{{ row.errorMessage }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="runApiTest(row)">测试</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <h3>原始 Fetch 测试</h3>
          <p class="hint">绕过 Axios 拦截器，直接观察浏览器拿到的最终响应。</p>
        </div>
        <el-button type="primary" size="small" :loading="runningRaw" @click="runAllRaw">全部测试</el-button>
      </div>

      <el-table :data="rawTests" stripe border>
        <el-table-column prop="name" label="接口" width="210" />
        <el-table-column label="请求地址" min-width="300">
          <template #default="{ row }">
            <code class="url">{{ row.url }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'pending'" type="info" size="small">待测试</el-tag>
            <el-tag v-else-if="row.status === 'loading'" type="warning" size="small">测试中</el-tag>
            <el-tag v-else-if="row.status === 'success'" type="success" size="small">{{ row.httpStatus }}</el-tag>
            <el-tag v-else type="danger" size="small">{{ row.httpStatus || '失败' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="响应" min-width="360">
          <template #default="{ row }">
            <div v-if="row.finalUrl" class="redirect-warn">最终地址：<code>{{ row.finalUrl }}</code></div>
            <pre v-if="row.responseBody">{{ row.responseBody }}</pre>
            <div v-if="row.errorMessage" class="error-msg">{{ row.errorMessage }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="runRawTest(row)">测试</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="section">
      <h3>自定义 URL 测试</h3>
      <div class="custom-test">
        <el-input v-model="customUrl" placeholder="输入完整或相对 URL，如 /backend/health" />
        <el-select v-model="customMethod" class="method-select">
          <el-option label="GET" value="GET" />
          <el-option label="POST" value="POST" />
        </el-select>
        <el-button type="primary" :loading="customLoading" @click="runCustom">发送</el-button>
      </div>
      <div v-if="customResult" class="custom-result">
        <div>HTTP {{ customResult.status }} {{ customResult.statusText }}</div>
        <div v-if="customResult.finalUrl" class="redirect-warn">最终地址：<code>{{ customResult.finalUrl }}</code></div>
        <pre>{{ customResult.body }}</pre>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import type { AxiosInstance } from 'axios'
import { backendApi, mainApi } from '../api'
import { getToken, isInIframe } from '../utils/token'

type RunStatus = 'pending' | 'loading' | 'success' | 'error'
type ProxyStatus = RunStatus | 'proxy-error'
type Verdict = 'ok' | 'warn' | 'fail'

const envInfo = reactive({
  location: window.location.href,
  origin: window.location.origin,
  backendApiBase: backendApi.defaults.baseURL || '/backend',
  mainApiBase: mainApi.defaults.baseURL || '/api',
  hasToken: !!getToken(),
  isIframe: isInIframe(),
  upstreams: '加载中...',
  hostname: '',
  serverBuildTime: '',
})

interface ProxyTestItem {
  name: string
  url: string
  expectedBackend: string
  status: ProxyStatus
  httpStatus: number | string
  responseHeaders: string
  responseBody: string
  finalUrl: string
  upstreamAddr: string
  latency: number | null
  verdict: Verdict
  verdictText: string
}

function makeProxyTest(name: string, url: string, expectedBackend: string): ProxyTestItem {
  return {
    name,
    url,
    expectedBackend,
    status: 'pending',
    httpStatus: '',
    responseHeaders: '',
    responseBody: '',
    finalUrl: '',
    upstreamAddr: '',
    latency: null,
    verdict: 'ok',
    verdictText: '',
  }
}

const proxyTests = ref<ProxyTestItem[]>([
  makeProxyTest('/api/ → 主后端', '/api/v1/plugin/verify-token', 'proxy_pass → 主后端 API'),
  makeProxyTest('/backend/ → 插件后端', '/backend/health', 'proxy_pass → AI 3D Generator backend'),
  makeProxyTest('/tripo/ → Tripo3D', '/tripo/', 'proxy_pass → https://api.tripo3d.ai/v2/openapi/'),
  makeProxyTest('/tripo-alt/ → Tripo3D 备用', '/tripo-alt/', 'proxy_pass → https://api.tripo3d.com/v2/openapi/'),
  makeProxyTest('/hyper/ → Hyper3D', '/hyper/', 'proxy_pass → https://api.hyper3d.com/api/v2/'),
  makeProxyTest('/health → 前端健康检查', '/health', '本地 Nginx health.json'),
  makeProxyTest('/debug-env → 调试环境', '/debug-env', '本地 Nginx debug-env.json'),
  makeProxyTest('/ → 前端静态文件', '/', '本地 Nginx try_files'),
])

function authHeaders() {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function describeProxyResult(resp: Response, text: string, item: ProxyTestItem) {
  if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
    item.status = 'proxy-error'
    item.verdict = 'fail'
    item.verdictText = `代理目标不可达 (${resp.status})，Nginx 无法连接后端服务`
    return
  }

  if (resp.status === 404 && text.includes('<html')) {
    item.status = 'error'
    item.verdict = 'warn'
    item.verdictText = 'Nginx 可能未匹配到代理规则，返回了静态 404'
    return
  }

  if (resp.ok) {
    item.status = 'success'
    item.verdict = 'ok'
    item.verdictText = '代理正常，目标已响应'
    return
  }

  item.status = 'success'
  item.verdict = 'ok'
  item.verdictText = `代理连通（目标返回 ${resp.status}，可能需要认证、参数或 Provider API key）`
}

async function runProxyTest(item: ProxyTestItem) {
  item.status = 'loading'
  item.httpStatus = ''
  item.responseHeaders = ''
  item.responseBody = ''
  item.finalUrl = ''
  item.upstreamAddr = ''
  item.latency = null
  item.verdict = 'ok'
  item.verdictText = ''

  const start = performance.now()
  try {
    const resp = await fetch(item.url, { headers: authHeaders() })
    item.latency = Math.round(performance.now() - start)
    item.httpStatus = resp.status
    const expectedAbsolute = new URL(item.url, window.location.href).href
    item.finalUrl = resp.url !== expectedAbsolute ? resp.url : ''
    item.upstreamAddr = resp.headers.get('x-upstream-addr') || ''

    const headerNames = ['content-type', 'server', 'x-powered-by', 'x-request-id', 'x-upstream-addr']
    const headerParts: string[] = []
    headerNames.forEach((name) => {
      const value = resp.headers.get(name)
      if (value) headerParts.push(`${name}: ${value}`)
    })
    item.responseHeaders = headerParts.join(' | ')

    const text = await resp.text()
    item.responseBody = text.slice(0, 300)
    describeProxyResult(resp, text, item)
  } catch (error) {
    item.latency = Math.round(performance.now() - start)
    item.status = 'error'
    item.httpStatus = 'N/A'
    item.verdict = 'fail'
    item.verdictText = error instanceof Error ? `请求失败：${error.message}` : `请求失败：${String(error)}`
  }
}

const runningProxy = ref(false)
async function runAllProxy() {
  runningProxy.value = true
  for (const test of proxyTests.value) {
    await runProxyTest(test)
  }
  runningProxy.value = false
}

interface ApiTestItem {
  name: string
  method: string
  instance: 'backendApi' | 'mainApi'
  path: string
  params?: Record<string, string>
  fullUrl: string
  status: RunStatus
  httpStatus: number | string
  responseHeaders: string
  responseBody: string
  errorMessage: string
}

function makeApiTest(
  name: string,
  method: string,
  instance: 'backendApi' | 'mainApi',
  path: string,
  params?: Record<string, string>
): ApiTestItem {
  const base = instance === 'backendApi'
    ? (backendApi.defaults.baseURL || '/backend')
    : (mainApi.defaults.baseURL || '/api')
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  return {
    name,
    method,
    instance,
    path,
    params,
    fullUrl: `${window.location.origin}${base}${path}${query}`,
    status: 'pending',
    httpStatus: '',
    responseHeaders: '',
    responseBody: '',
    errorMessage: '',
  }
}

const apiTests = ref<ApiTestItem[]>([
  makeApiTest('插件后端健康检查', 'GET', 'backendApi', '/health'),
  makeApiTest('任务列表', 'GET', 'backendApi', '/tasks', { page: '1', pageSize: '1' }),
  makeApiTest('额度状态', 'GET', 'backendApi', '/credits/status'),
  makeApiTest('验证 Token', 'GET', 'mainApi', '/v1/plugin/verify-token'),
])

async function runApiTest(item: ApiTestItem) {
  item.status = 'loading'
  item.httpStatus = ''
  item.responseHeaders = ''
  item.responseBody = ''
  item.errorMessage = ''

  const instance: AxiosInstance = item.instance === 'backendApi' ? backendApi : mainApi
  try {
    const resp = await instance.request({
      method: item.method,
      url: item.path,
      params: item.params,
      validateStatus: () => true,
    })
    item.httpStatus = resp.status
    item.status = resp.status >= 200 && resp.status < 400 ? 'success' : 'error'
    item.responseHeaders = `content-type: ${resp.headers['content-type'] || 'N/A'}`
    item.responseBody = typeof resp.data === 'string'
      ? resp.data.slice(0, 500)
      : JSON.stringify(resp.data, null, 2).slice(0, 500)
  } catch (error) {
    item.status = 'error'
    item.errorMessage = error instanceof Error ? error.message : String(error)
  }
}

const runningApi = ref(false)
async function runAllApi() {
  runningApi.value = true
  for (const test of apiTests.value) {
    await runApiTest(test)
  }
  runningApi.value = false
}

interface RawTestItem {
  name: string
  url: string
  status: RunStatus
  httpStatus: number | string
  responseBody: string
  finalUrl: string
  errorMessage: string
}

function makeRawTest(name: string, url: string): RawTestItem {
  return {
    name,
    url,
    status: 'pending',
    httpStatus: '',
    responseBody: '',
    finalUrl: '',
    errorMessage: '',
  }
}

const rawTests = ref<RawTestItem[]>([
  makeRawTest('主后端 Token 验证', '/api/v1/plugin/verify-token'),
  makeRawTest('插件后端 Health Check', '/backend/health'),
  makeRawTest('前端 Health Check', '/health'),
  makeRawTest('Debug Env', '/debug-env'),
])

async function runRawTest(item: RawTestItem) {
  item.status = 'loading'
  item.httpStatus = ''
  item.responseBody = ''
  item.finalUrl = ''
  item.errorMessage = ''
  try {
    const resp = await fetch(item.url, { headers: authHeaders() })
    item.httpStatus = resp.status
    const expectedAbsolute = new URL(item.url, window.location.href).href
    item.finalUrl = resp.url !== expectedAbsolute ? resp.url : ''
    item.status = resp.ok ? 'success' : 'error'
    const text = await resp.text()
    item.responseBody = text.slice(0, 500)
  } catch (error) {
    item.status = 'error'
    item.errorMessage = error instanceof Error ? error.message : String(error)
  }
}

const runningRaw = ref(false)
async function runAllRaw() {
  runningRaw.value = true
  for (const test of rawTests.value) {
    await runRawTest(test)
  }
  runningRaw.value = false
}

const runningAll = ref(false)
async function runAll() {
  runningAll.value = true
  try {
    await runAllProxy()
    await runAllApi()
    await runAllRaw()
  } finally {
    runningAll.value = false
  }
}

const customUrl = ref('')
const customMethod = ref('GET')
const customLoading = ref(false)
const customResult = ref<{ status: number; statusText: string; body: string; finalUrl: string } | null>(null)

async function runCustom() {
  if (!customUrl.value) return
  customLoading.value = true
  customResult.value = null
  try {
    const resp = await fetch(customUrl.value, { method: customMethod.value, headers: authHeaders() })
    const text = await resp.text()
    const expectedAbsolute = new URL(customUrl.value, window.location.href).href
    customResult.value = {
      status: resp.status,
      statusText: resp.statusText,
      body: text.slice(0, 1000),
      finalUrl: resp.url !== expectedAbsolute ? resp.url : '',
    }
  } catch (error) {
    customResult.value = {
      status: 0,
      statusText: 'Error',
      body: error instanceof Error ? error.message : String(error),
      finalUrl: '',
    }
  } finally {
    customLoading.value = false
  }
}

function updateExpectedBackends(data: Record<string, string>) {
  const apiUrls: string[] = []
  const backendUrls: string[] = []
  const upstreams: string[] = []

  let i = 1
  while (data[`APP_API_${i}_URL`]) {
    apiUrls.push(data[`APP_API_${i}_URL`])
    upstreams.push(`APP_API_${i}_URL=${data[`APP_API_${i}_URL`]}`)
    i += 1
  }

  i = 1
  while (data[`APP_BACKEND_${i}_URL`]) {
    backendUrls.push(data[`APP_BACKEND_${i}_URL`])
    upstreams.push(`APP_BACKEND_${i}_URL=${data[`APP_BACKEND_${i}_URL`]}`)
    i += 1
  }

  envInfo.upstreams = upstreams.length ? upstreams.join(' | ') : '未设置'
  envInfo.hostname = data.hostname || ''
  envInfo.serverBuildTime = data.buildTime || ''

  proxyTests.value.forEach((test) => {
    if (apiUrls.length && test.url.startsWith('/api/')) {
      const path = test.url.replace(/^\/api/, '')
      test.expectedBackend = apiUrls.length === 1
        ? apiUrls[0].replace(/\/$/, '') + path
        : apiUrls.map((url, index) => `[${index + 1}] ${url.replace(/\/$/, '') + path}`).join(' → ')
    }
    if (backendUrls.length && test.url.startsWith('/backend/')) {
      const path = test.url.replace(/^\/backend/, '')
      test.expectedBackend = backendUrls.length === 1
        ? backendUrls[0].replace(/\/$/, '') + path
        : backendUrls.map((url, index) => `[${index + 1}] ${url.replace(/\/$/, '') + path}`).join(' → ')
    }
  })
}

onMounted(async () => {
  envInfo.hasToken = !!getToken()
  try {
    const resp = await fetch('/debug-env')
    if (!resp.ok) {
      envInfo.upstreams = `请求失败 (${resp.status})`
      return
    }

    const text = await resp.text()
    try {
      updateExpectedBackends(JSON.parse(text) as Record<string, string>)
    } catch {
      envInfo.upstreams = '/debug-env 返回了非 JSON 内容'
    }
  } catch (error) {
    envInfo.upstreams = error instanceof Error ? `请求异常：${error.message}` : `请求异常：${String(error)}`
  }
})
</script>

<style scoped>
.diagnostics {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px 32px 40px;
}

.diag-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 24px;
}

.diag-header h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.25;
}

.diag-header p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.section {
  margin-bottom: 28px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border-color);
}

.section h3 {
  margin: 0 0 12px;
  font-size: 16px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 8px 24px;
}

.info-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 4px 0;
}

.info-item .label {
  flex: 0 0 150px;
  color: var(--text-secondary);
  font-size: 13px;
}

code {
  min-width: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  word-break: break-all;
}

code.ok {
  color: var(--success-color);
}

code.warn {
  color: var(--warning-color);
}

code.url {
  font-size: 12px;
}

.resp-detail,
.resp-headers,
.resp-body,
.latency,
.upstream-addr,
.redirect-warn,
.error-msg {
  font-size: 12px;
}

.resp-detail pre,
.custom-result pre,
pre {
  max-height: 160px;
  margin: 4px 0 0;
  padding: 8px;
  overflow: auto;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.diag-verdict {
  margin-bottom: 4px;
  font-weight: 600;
}

.diag-verdict.ok {
  color: var(--success-color);
}

.diag-verdict.warn,
.redirect-warn {
  color: var(--warning-color);
}

.diag-verdict.fail,
.error-msg {
  color: var(--danger-color);
}

.upstream-addr,
.latency {
  color: var(--text-secondary);
}

.custom-test {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 120px auto;
  gap: 8px;
  align-items: center;
}

.method-select {
  width: 120px;
}

.custom-result {
  margin-top: 12px;
  padding: 12px;
  border-radius: 6px;
  background: var(--bg-secondary);
}

@media (max-width: 760px) {
  .diagnostics {
    padding: 16px;
  }

  .diag-header,
  .section-header,
  .info-item {
    flex-direction: column;
    align-items: stretch;
  }

  .info-item .label {
    flex-basis: auto;
  }

  .custom-test {
    grid-template-columns: 1fr;
  }
}
</style>
