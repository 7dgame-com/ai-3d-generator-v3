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
