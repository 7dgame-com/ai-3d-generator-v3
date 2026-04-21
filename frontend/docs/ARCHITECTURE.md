# 架构说明

## 整体架构

纯前端插件模板采用单容器架构：Vue 3 SPA + nginx 反向代理。

```
┌─────────────────────────────────────────────┐
│ 主系统 web/ (Vue 3)                          │
│   PluginLayout.vue → iframe → 插件           │
│   MessageBus → postMessage                   │
└──────────────────┬──────────────────────────┘
                   │ iframe + postMessage
┌──────────────────▼──────────────────────────┐
│ 插件容器 (Docker: nginx:alpine)              │
│ ┌───────────────────────────────────────┐   │
│ │ nginx                                  │   │
│ │  / → 静态文件 (try_files → SPA)        │   │
│ │  /api/ → 反向代理 → 主后端             │   │
│ │  /health → health.json                 │   │
│ │  /debug-env → debug-env.json           │   │
│ └───────────────────────────────────────┘   │
│ ┌───────────────────────────────────────┐   │
│ │ Vue 3 SPA                              │   │
│ │  usePluginMessageBridge → 通信桥       │   │
│ │  useTheme → 主题同步                   │   │
│ │  useAuthSession → 身份/root 会话        │   │
│ │  axios 双实例 → API 请求               │   │
│ │  token.ts → localStorage 管理          │   │
│ └───────────────────────────────────────┘   │
└──────────────────┬──────────────────────────┘
                   │ /api/ 反向代理 (failover)
┌──────────────────▼──────────────────────────┐
│ 主后端 (Yii2 PHP)                            │
│  Plugin Auth API (verify-token)              │
│  业务 API                                    │
└─────────────────────────────────────────────┘
```

## 认证握手流程

1. 主系统创建 iframe，加载插件 URL（含 `?lang=zh-CN&theme=modern-blue`）
2. 插件 `index.html` 中的 early handler 尽早注册 message 监听
3. Vue 挂载后，`usePluginMessageBridge` 发送 `PLUGIN_READY`
4. 主系统收到后回复 `INIT { token, config }`
5. 插件存储 token 到 localStorage，握手完成

### 运行时消息

- `TOKEN_UPDATE { token }` — 主系统刷新 token 后同步
- `DESTROY` — 主系统销毁插件，清除 token
- `THEME_CHANGE { theme }` — 切换主题
- `LANG_CHANGE { lang }` — 切换语言

## 反向代理机制

nginx 通过 `docker-entrypoint.sh` 动态生成的配置，将 `/api/` 请求转发到主后端。

支持多后端 failover：
```
APP_API_1_URL=http://primary-api:80
APP_API_2_URL=http://backup-api:80
```

当主后端 502/503/504 时自动切换到备用后端。

## 身份与访问控制

插件通过 `/api/v1/plugin/verify-token` 获取当前用户身份和角色。

- 普通功能按 `auth-only` 处理，由插件后端结合资源归属做约束
- 管理功能按 `root-only` 处理，由前端会话和后端 `requireRootUser` 双重约束
- 插件运行时不再依赖 `/api-config`、`allowed-actions`、`check-permission`

## 主题系统

支持 6 种主题：
- 亮色：modern-blue、edu-friendly、neo-brutalism、minimal-pure
- 暗色：deep-space、cyber-tech

通过 CSS 变量实现，同时覆盖 Element Plus 内置变量。

## 国际化

支持 5 种语言：zh-CN、zh-TW、en-US、ja-JP、th-TH

- 初始语言从 URL `?lang=` 读取
- 运行时通过 `LANG_CHANGE` 消息切换，无需刷新
