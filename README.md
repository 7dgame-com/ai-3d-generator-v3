# AI 3D Generator V3

`ai-3d-generator-v3` 是一套独立于 `ai-3d-generator-v2` 的 clean-room 实现。

## Stack

- Frontend: Vue 3 + Vite + Element Plus
- Backend: Express + TypeScript
- Database: MySQL (`ai_3d_generator_v3`)

## Ports

- Frontend: `3008`
- Backend: `8089`

## Providers

- Tripo3D
- Hyper3D

## Upload Path

生成成功后，前端通过主系统的 COS STS 接口拿临时密钥，直传 COS，再调用主系统的 `/v1/files` 和 `/v1/resources` 创建资源记录，最后把 `resource_id` 回写到插件任务表。

## Database Initialization

Docker 首次启动 `ai-3d-generator-v3-db` 时，会自动导入插件最终态 schema：

- 挂载源文件: `plugins/ai-3d-generator-v3/backend/src/db/schema.sql`
- 容器内路径: `/docker-entrypoint-initdb.d/01-schema.sql`
- 默认本地端口: `3309`

如果你需要手动初始化、云端导入，或者本地快速重建数据库，可以直接导入仓库根目录的独立脚本：

```bash
mysql -h 127.0.0.1 -P 3309 -u bujiaban -p < driver/ai-3d-generator-v3-schema.sql
```

这个脚本会自动：

- 创建数据库 `ai_3d_generator_v3`
- 执行 `USE ai_3d_generator_v3`
- 创建当前插件所需的全部表结构

## Local Development

前端联调时，优先使用 Vite 开发服务器而不是前端 Docker 镜像。这样改动会直接热更新显示，不需要每次重新 build 前端镜像。

如果前端 Docker 还占着 `3008` 端口，先停掉它：

```bash
docker stop driver-ai-3d-generator-v3-frontend-1
```

然后在插件根目录启动前端开发模式：

```bash
./start-frontend-dev.sh
```

等价的手动命令是：

```bash
cd frontend
pnpm install
pnpm run dev
```

前端开发模式下，反向代理仍然保留，统一由 `frontend/vite.config.ts` 提供：

- `/api/` -> `http://localhost:8081`
- `/backend/` -> `http://localhost:8089`
- `/tripo/` -> `https://api.tripo3d.com/v2/openapi`
- `/tripo-alt/` -> `https://api.tripo3d.ai/v2/openapi`
- `/hyper/` -> `https://api.hyper3d.com/api/v2`

如果你想把插件后端也切到本地开发，可以单独运行：

```bash
cd backend
npm install
npm run dev
```

后端访问主系统现在和前端统一使用同一套主后端配置：

- `APP_API_1_URL`, `APP_API_2_URL`, ...
  插件后端访问主系统业务与 `verify-token` 的首选上游配置
- `APP_API_1_WEIGHT`, `APP_API_2_WEIGHT`, ...
  多上游时用于加权选择，并在网络错误、超时、`502/503/504` 时环形 failover

未配置 `APP_API_*` 时，插件后端会默认回退到 `http://localhost:8081`，用于本地开发。

当前不再使用 `pluginApi`、`/api-config`、`APP_CONFIG_*`、`PLUGIN_AUTH_PROXY_URL`、`SYSTEM_ADMIN_API_URL` 或 `MAIN_API_URL`。
