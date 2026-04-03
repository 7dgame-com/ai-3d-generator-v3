# 快速开始指南

## 1. 复制模板

```bash
cp -r plugins/plugin-template-frontend-only plugins/my-plugin
cd plugins/my-plugin
```

## 2. 修改插件名

需要修改以下位置的插件标识：

### package.json
```json
{ "name": "my-plugin" }
```

### src/utils/token.ts
修改 localStorage key 前缀，避免与其他插件冲突：
```typescript
const TOKEN_KEY = 'my-plugin-token'
const REFRESH_TOKEN_KEY = 'my-plugin-refresh-token'
```

### index.html
修改 early token handler 中的 `localStorage.setItem` key：
```javascript
localStorage.setItem('my-plugin-token', data.payload.token);
```

### src/api/index.ts
修改业务 API 的 baseURL：
```typescript
const sampleApi = axios.create({
  baseURL: '/api/v1/plugin-my-plugin',
  timeout: 10000
})
```

### src/composables/usePermissions.ts
修改权限接口和插件名：
```typescript
export interface Permissions {
  'my-action-1': boolean
  'my-action-2': boolean
}
// ...
params: { plugin_name: 'my-plugin' }
```

### vite.config.ts
修改 manifest id 和开发端口：
```typescript
// manifest id
id: 'my-plugin',
// 开发端口（避免冲突）
port: 3007,
```

## 3. 修改语言包

编辑 `src/i18n/locales/` 下的 5 个语言文件，替换 `pluginMeta` 字段和业务文案。

## 4. 添加业务页面

1. 在 `src/views/` 下创建新页面组件
2. 在 `src/router/index.ts` 中添加路由
3. 在 `src/composables/usePermissions.ts` 中添加权限项
4. 在 `src/layout/AppLayout.vue` 中添加导航链接

## 5. 注册到主系统

参考 `plugins.json.example`，将插件配置添加到主系统的 `plugins.json` 中。

## 6. 本地开发

```bash
npm install
npm run dev
```

开发服务器默认运行在 http://localhost:3006，`/api` 请求自动代理到 `http://localhost:8081`（主后端）。

## 7. Docker 部署

```bash
# 构建并启动
docker compose up -d --build

# 配置后端地址
APP_API_1_URL=http://your-api:80 docker compose up -d
```
