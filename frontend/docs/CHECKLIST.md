# 新插件开发检查清单

从本模板创建新插件时，请逐项确认。

---

## 代码质量

- [ ] 重命名 `package.json` 中的 `name` 字段
- [ ] 修改 `token.ts` 中 `TOKEN_KEY`、`REFRESH_TOKEN_KEY` 前缀，避免 localStorage 冲突
- [ ] 修改 `api/index.ts` 中 `sampleApi` 的 `baseURL` 为新插件 API 前缀
- [ ] 修改 `usePermissions.ts` 中 `plugin_name` 为新插件注册名
- [ ] 修改 `usePermissions.ts` 中权限列表 `allActions` 为实际权限
- [ ] 修改 `vite.config.ts` 中端口号，避免与其他插件冲突
- [ ] 修改 `docker-compose.yml` 中端口映射
- [ ] 修改 i18n 各语言包中 `pluginMeta` 信息
- [ ] `vue-tsc -b` 无类型错误
- [ ] ESLint 检查通过 (`pnpm lint`)

## 功能测试

- [ ] iframe 内启动，握手正常完成（PLUGIN_READY → INIT）
- [ ] 非 iframe 环境显示提示页面
- [ ] API 请求正确携带 Bearer token
- [ ] 401 时触发 token 刷新（iframe 模式向主系统请求，独立模式清空 token）
- [ ] TOKEN_UPDATE 消息正确更新 localStorage
- [ ] DESTROY 消息正确清空 token 和状态
- [ ] 路由守卫正确拦截无权限页面
- [ ] 权限 API 返回后 `can()` 方法判断正确

## 国际化测试

- [ ] URL `?lang=en-US` 应用英文
- [ ] LANG_CHANGE 消息切换语言无需刷新
- [ ] 所有 5 种语言包 key 一致（无缺失）
- [ ] Element Plus 组件语言同步

## 主题适配测试

- [ ] 6 种主题切换后 UI 正常
- [ ] 暗色主题下文字可读性正常
- [ ] URL `?theme=deep-space` 应用暗色主题
- [ ] THEME_CHANGE 消息切换主题即时生效
- [ ] Element Plus 组件颜色跟随 CSS 变量

## 安全检查

- [ ] localStorage key 使用唯一前缀
- [ ] postMessage 事件验证 `event.source === window.parent`
- [ ] 不在控制台 / 页面中暴露完整 token
- [ ] nginx 配置未暴露敏感路径

## 部署验证

- [ ] `docker build` 成功
- [ ] `/health` 返回 200
- [ ] `/debug-env` 返回当前环境信息（仅开发环境开启）
- [ ] `/api/` 反向代理到主后端正常
- [ ] SPA 路由 fallback 正常（直接访问子页面不 404）

## 插件注册

- [ ] `plugins.json` 中配置正确字段
- [ ] 主系统插件管理界面能加载插件
- [ ] 插件 icon 和名称正确显示
- [ ] 插件分组正确

## 文档

- [ ] README.md 更新为新插件信息
- [ ] 目录结构说明与实际一致
- [ ] 移除模板中的示例代码注释
