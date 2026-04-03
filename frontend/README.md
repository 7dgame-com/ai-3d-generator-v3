# 纯前端插件模板

> 一个面向 xrugc 插件系统的纯前端模板。插件通过 iframe 接入主系统，使用 nginx 反向代理连接主后端 API，无需自建后端即可复用主系统的登录态、权限、主题和语言。

## 模板定位

这个模板适合：

- 管理类或工具类插件
- 业务逻辑主要在主后端的插件
- 需要快速复用现有插件接入规范的项目

如果你的插件需要独立数据库、缓存或服务端逻辑，应单独建立全栈插件工程，而不是使用这个纯前端模板。

---

## 文档入口

本模板的文档已经整合了 xrugc 仓库中分散的插件设计与接入规则。建议按以下顺序阅读：

1. [docs/PLUGIN_DEVELOPMENT_STANDARD.md](docs/PLUGIN_DEVELOPMENT_STANDARD.md)
2. [docs/QUICK_START.md](docs/QUICK_START.md)
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
4. [docs/CHECKLIST.md](docs/CHECKLIST.md)
5. [docs/DOCUMENT_INDEX.md](docs/DOCUMENT_INDEX.md)

以后开发新插件，优先以本模板文档为准；当历史文档表述不一致时，按本模板文档中基于 user-management 代码整理后的标准执行。

---

## 与全栈插件形态的区别

| 维度 | 全栈插件 | plugin-template-frontend-only（纯前端） |
|------|------|------|
| 后端 | 有独立服务和数据层 | 无，走 nginx 反向代理 |
| Docker 容器数 | 通常大于 1 | 1 |
| 适用场景 | 自有业务后端、数据存储、复杂服务逻辑 | 展示/管理类插件，业务逻辑在主后端 |
| 规范来源 | 仍需遵循统一插件规范 | 本模板已内置统一规范文档 |

---

## 快速使用

```bash
npm install
npm run dev
```

默认开发地址是 `http://localhost:3006`，`/api/` 默认代理到 `http://localhost:8081`。

要从模板创建新插件，请直接看 [docs/QUICK_START.md](docs/QUICK_START.md)。

---

## 模板包含的能力

- 标准握手流程：`PLUGIN_READY -> INIT`
- Token 存取与两段式刷新
- 权限查询与路由守卫
- 主题与语言同步
- manifest 自动生成
- nginx 反向代理与健康检查
- 可用于独立调试的诊断页

---

## 目录概览

```text
src/
	App.vue
	api/
	composables/
	i18n/
	layout/
	router/
	styles/
	utils/
	views/
docs/
Dockerfile
docker-entrypoint.sh
nginx.conf.template
vite.config.ts
plugins.json.example
```

如果你要理解这些目录分别承担什么职责，请查看 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
