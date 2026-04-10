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
- `/tripo/` -> `https://api.tripo3d.ai/v2/openapi`
- `/hyper/` -> `https://api.hyper3d.com/api/v2`

如果你想把插件后端也切到本地开发，可以单独运行：

```bash
cd backend
npm install
npm run dev
```
