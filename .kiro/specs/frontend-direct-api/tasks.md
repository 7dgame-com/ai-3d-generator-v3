# 实施计划：前端直接调用第三方 API

## 概述

将 3D 生成任务的 Provider API 调用从后端代理模式迁移到前端直接调用模式。实施分为后端新增回调接口、前端 Provider 适配层、前端直调轮询器、模式切换集成四个阶段，逐步推进。

## 任务

- [x] 1. 后端：PrepareToken 工具与任务预扣接口
  - 进展：已完成 PrepareToken、`POST /tasks/prepare` 及对应测试。
  - [x] 1.1 实现 PrepareToken 签发与验证工具
    - 在 `backend/src/services/` 下新建 `prepareToken.ts`
    - 使用 `jsonwebtoken` 签发 JWT，payload 包含 `userId`、`providerId`、`tempTaskId`、`estimatedPower`
    - 使用独立的 `PREPARE_TOKEN_SECRET` 环境变量（与现有 JWT_SECRET 分开）
    - 过期时间 15 分钟
    - 实现 `signPrepareToken(payload)` 和 `verifyPrepareToken(token)` 两个函数
    - _需求: 1.1, 3.2, 8.4_

  - [x]* 1.2 编写 PrepareToken 属性测试
    - **Property 4: PrepareToken 与任务匹配验证**
    - 生成随机 userId/tempTaskId/taskId 组合，验证 token 中的 tempTaskId 与 taskId 不匹配时拒绝请求
    - 测试文件: `backend/src/__tests__/prepareToken.property.test.ts`
    - **验证: 需求 8.4**

  - [x]* 1.3 编写 PrepareToken 单元测试
    - 测试签发、验签、过期、篡改等场景
    - 测试文件: `backend/src/__tests__/prepareToken.test.ts`
    - _需求: 1.1, 8.4_

  - [x] 1.4 实现 `POST /tasks/prepare` 接口
    - 在 `backend/src/controllers/` 下新建 `directTask.ts`，实现 `prepareTask` 控制器
    - 验证用户身份（复用 `auth` 中间件）和权限（`requirePermission('generate-model')`）
    - 验证 `provider_id` 是否启用（复用 `providerRegistry.isEnabled`）
    - 读取账户快照，计算节流延迟（复用现有 `computeThrottleDelay`）
    - 执行积分预扣（复用 `creditManager.preDeduct`）
    - 解密 API Key（复用 `decrypt`）
    - 签发 `prepareToken`
    - 返回 `{ apiKey, prepareToken, providerId, estimatedPower, apiBaseUrl, modelVersion, mode }`
    - 响应头设置 `Cache-Control: no-store` 和 `Pragma: no-cache`
    - _需求: 1.1, 1.2, 1.3, 3.1, 3.2, 3.5, 5.1, 9.3_

  - [x]* 1.5 编写 prepareTask 单元测试
    - 测试预扣成功、积分不足、Provider 未配置、节流延迟等场景
    - 测试文件: `backend/src/__tests__/directTask.prepare.test.ts`
    - _需求: 3.1, 3.2, 3.5_

- [x] 2. 后端：任务注册、完成、失败回调接口
  - 进展：已完成回调控制器、所有权属性测试、单元测试及路由注册。
  - [x] 2.1 实现 `POST /tasks/register` 接口
    - 在 `directTask.ts` 中新增 `registerTask` 控制器
    - 验证 `prepareToken`（JWT 验签 + 过期检查）
    - 从 token 中提取 userId、providerId、tempTaskId
    - 写入 tasks 表（status='queued'）
    - 更新 `credit_ledger` 中的 task_id（从 tempTaskId 更新为真实 taskId）
    - _需求: 2.3, 5.2_

  - [x] 2.2 实现 `POST /tasks/:taskId/complete` 接口
    - 在 `directTask.ts` 中新增 `completeTask` 控制器
    - 验证 `prepareToken` 和任务所有权
    - 验证任务当前状态（防止重复回调，幂等处理）
    - 调用 `creditManager.finalizeTaskSuccess` 执行积分确认扣减
    - 更新任务状态为 `success`
    - _需求: 3.3, 4.3, 5.3, 5.5_

  - [x] 2.3 实现 `POST /tasks/:taskId/fail` 接口
    - 在 `directTask.ts` 中新增 `failTask` 控制器
    - 验证 `prepareToken` 和任务所有权
    - 调用 `creditManager.refund` 退还预扣积分
    - 更新任务状态为 `failed`
    - _需求: 2.4, 3.4, 4.4, 5.4, 5.5_

  - [x]* 2.4 编写任务所有权属性测试
    - **Property 3: 任务所有权验证**
    - 生成随机 userId/taskId 组合，验证非所有者无法操作任务
    - 测试文件: `backend/src/__tests__/taskOwnership.property.test.ts`
    - **验证: 需求 5.5**

  - [x]* 2.5 编写 register/complete/fail 单元测试
    - 测试 token 验签失败、任务不存在、所有者不匹配、幂等处理等场景
    - 测试文件: `backend/src/__tests__/directTask.callbacks.test.ts`
    - _需求: 5.2, 5.3, 5.4, 5.5_

  - [x] 2.6 注册后端新路由
    - 在 `backend/src/routes/` 下新建 `directTask.ts` 路由文件
    - 挂载 `POST /tasks/prepare`、`POST /tasks/register`、`POST /tasks/:taskId/complete`、`POST /tasks/:taskId/fail`
    - 所有路由使用 `auth` 中间件和 `requirePermission('generate-model')`
    - 在 `backend/src/index.ts` 中注册新路由
    - _需求: 5.1, 5.2, 5.3, 5.4_

- [x] 3. 检查点 - 确保后端所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。
  - 进展：已运行 `npm test -- --runInBand`，当前后端全量测试通过（`32/32 suites`, `215/215 tests`）。

- [x] 4. 后端：超时守护与模式开关
  - 进展：已实现 `timeoutGuardian`、守护器启动逻辑、模式开关迁移脚本，并完成对应测试。
  - [x] 4.1 实现超时守护机制
    - 在 `backend/src/services/` 下新建 `timeoutGuardian.ts`
    - 每 60 秒扫描 `credit_ledger` 中 `event_type='pre_deduct'` 且无对应 `confirm_deduct` 或 `refund` 记录的条目
    - 如果 `created_at` 距今超过 15 分钟，自动执行退款（复用 `creditManager.refund`）
    - 同时将对应 tasks 记录标记为 `timeout`
    - 在 `backend/src/index.ts` 中启动守护定时器
    - _需求: 3.6, 7.3, 8.3_

  - [x]* 4.2 编写超时守护属性测试
    - **Property 2: 超时守护退款完整性**
    - 生成随机预扣记录和时间戳，验证超时后必定存在退款记录
    - 测试文件: `backend/src/__tests__/timeoutGuardian.property.test.ts`
    - **验证: 需求 3.6, 7.3, 8.3**

  - [x]* 4.3 编写超时守护单元测试
    - 测试超时扫描、自动退款、已有退款记录跳过等场景
    - 测试文件: `backend/src/__tests__/timeoutGuardian.test.ts`
    - _需求: 3.6, 7.3, 8.3_

  - [x] 4.4 实现模式开关
    - 在 `system_config` 表中新增 `api_mode` 配置项（值为 `direct` 或 `proxy`）
    - 在 `backend/src/controllers/directTask.ts` 的 `prepareTask` 中读取模式配置并在响应中返回 `mode` 字段
    - 提供 SQL 迁移脚本 `backend/src/db/migrate_direct_api.sql`，插入默认配置
    - _需求: 10.1, 10.2, 10.3_

- [x] 5. 检查点 - 确保后端所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。
  - 进展：已运行 `npm run typecheck` 与 `npm test -- --runInBand`，当前后端全量通过（`34/34 suites`, `221/221 tests`）。

- [x] 6. 前端：Provider 适配层
  - 进展：已实现前端适配器接口、Tripo3D/Hyper3D 适配器、注册表，以及属性测试和单元测试。
  - [x] 6.1 定义前端 Provider 适配器接口
    - 新建 `frontend/src/adapters/IFrontendProviderAdapter.ts`
    - 定义 `CreateTaskInput`、`CreateTaskOutput`、`TaskStatusOutput`、`IFrontendProviderAdapter` 接口
    - _需求: 6.1_

  - [x] 6.2 实现 Tripo3D 前端适配器
    - 新建 `frontend/src/adapters/Tripo3DFrontendAdapter.ts`
    - 实现 `createTask`：text_to_model 直接 POST JSON；image_to_model 先上传图片获取 file_token 再创建任务
    - 实现 `getTaskStatus`：GET /task/{taskId}，解析状态、进度、outputUrl、thumbnailUrl
    - 参考后端 `Tripo3DAdapter.ts` 的 API 调用逻辑
    - _需求: 2.1, 2.2, 6.2_

  - [x] 6.3 实现 Hyper3D 前端适配器
    - 新建 `frontend/src/adapters/Hyper3DFrontendAdapter.ts`
    - 实现 `createTask`：POST multipart/form-data 到 /rodin
    - 实现 `getTaskStatus`：POST /status + POST /download，处理 render.jpg 等待逻辑
    - 参考后端 `Hyper3DAdapter.ts` 的 API 调用逻辑
    - _需求: 2.1, 2.2, 6.3_

  - [x] 6.4 实现前端 Provider 注册表
    - 新建 `frontend/src/adapters/FrontendProviderRegistry.ts`
    - 实现 `register`、`get` 方法
    - 默认注册 Tripo3D 和 Hyper3D 适配器
    - _需求: 6.1, 6.4_

  - [x]* 6.5 编写适配器请求构造属性测试
    - **Property 1: 适配器请求构造完整性**
    - 生成随机 prompt 和 File，验证适配器输出包含所有必要字段
    - 测试文件: `frontend/src/adapters/__tests__/adapter.property.test.ts`
    - **验证: 需求 2.1, 2.2**

  - [x]* 6.6 编写适配器单元测试
    - 测试 Tripo3D 和 Hyper3D 适配器的请求构造和响应解析
    - 测试文件: `frontend/src/adapters/__tests__/adapters.spec.ts`
    - _需求: 6.2, 6.3_

- [x] 7. 前端：直调轮询器与任务创建流程
  - 进展：已新增回调 API、`useDirectTaskPoller`、`useDirectTaskCreation`，并完成对应单测。
  - [x] 7.1 新增后端回调 API 函数
    - 在 `frontend/src/api/index.ts` 中新增 `prepareTask`、`registerTask`、`completeTask`、`failTask` API 函数
    - _需求: 5.1, 5.2, 5.3, 5.4_

  - [x] 7.2 实现 `useDirectTaskPoller` composable
    - 新建 `frontend/src/composables/useDirectTaskPoller.ts`
    - 每 3 秒通过 Provider 适配器直接轮询 Provider API
    - 10 分钟超时自动停止
    - 任务成功时调用 `POST /tasks/:taskId/complete`
    - 任务失败时调用 `POST /tasks/:taskId/fail`
    - 网络错误重试 3 次，间隔 2 秒
    - 组件卸载时自动清理（`onBeforeUnmount`）
    - API Key 仅存储在闭包变量中，流程结束后置为 null
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5, 8.1, 9.4_

  - [x] 7.3 实现 `useDirectTaskCreation` composable
    - 新建 `frontend/src/composables/useDirectTaskCreation.ts`
    - 完整流程：prepare → provider create → register → 启动轮询
    - 检查返回的 `mode`，如果是 `proxy` 则回退到旧流程
    - 任何步骤失败时调用 fail 接口退款
    - API Key 仅存储在内存中，不写入 localStorage/sessionStorage
    - _需求: 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 8.1, 8.2, 9.4, 10.4_

  - [x]* 7.4 编写 useDirectTaskPoller 单元测试
    - 测试轮询间隔、超时停止、回调触发、重试逻辑
    - 测试文件: `frontend/src/composables/__tests__/useDirectTaskPoller.spec.ts`
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x]* 7.5 编写 useDirectTaskCreation 单元测试
    - 测试完整流程、错误回退、模式切换
    - 测试文件: `frontend/src/composables/__tests__/useDirectTaskCreation.spec.ts`
    - _需求: 2.1, 2.2, 2.3, 2.4, 10.4_

- [x] 8. 检查点 - 确保前端所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。
  - 进展：已运行 `frontend npm test`，当前前端全量通过（`16/16 files`, `54/54 tests`）。

- [x] 9. 集成：CORS 代理与业务组件接入
  - 进展：已完成后端轻量代理、GeneratorView 直调接入、TaskPoller direct/proxy 兼容。
  - [x] 9.1 实现轻量级 CORS 代理（备用）
    - 在 `backend/src/controllers/` 下新建 `proxy.ts`，实现 `proxyProviderRequest` 控制器
    - 仅转发 HTTP 请求，不做业务逻辑处理
    - 前端通过 `X-Provider-Api-Key` 请求头传入 API Key
    - 在 `backend/src/routes/` 下新建 `proxy.ts` 路由，挂载 `POST /proxy/:providerId/*`
    - 在 `backend/src/index.ts` 中注册代理路由
    - _需求: 9.1, 9.2_

  - [x] 9.2 业务组件接入直调模式
    - 修改 `frontend/src/App.vue`（或任务创建相关组件），根据模式切换使用 `useDirectTaskCreation` 或现有创建流程
    - 确保 `useCreditCheck` 在直调模式下仍正常工作
    - 确保错误信息（积分不足、节流、Provider 错误）正确展示
    - _需求: 2.4, 3.1, 8.2, 10.4_

  - [x] 9.3 后端旧轮询器兼容处理
    - 修改 `backend/src/services/taskPoller.ts`，在 `startPoller` 中检查模式配置
    - 当模式为 `direct` 时，仅处理旧流程创建的未完成任务，不再为新任务启动轮询
    - 当所有旧任务完成后，停止 TaskPoller
    - _需求: 7.1, 7.2_

- [x] 10. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。
  - 进展：已运行 `backend npm run typecheck`、`backend npm test -- --runInBand`、`frontend npm test`、`frontend npm run build`，当前全量通过（后端 `36/36 suites`, `225/225 tests`；前端 `16/16 files`, `54/54 tests`）。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号，确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- CORS 代理为备用方案，仅在 Provider API 不支持浏览器端 CORS 时启用
