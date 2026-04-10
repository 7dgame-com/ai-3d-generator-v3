# 实施计划：任务过期时间持久化与分页

## 概述

基于需求和设计文档，将实施分为四个阶段：数据库迁移与工具函数、后端接口修改（过期过滤 + 分页元数据 + expiresAt 字段）、前端展示（倒计时 + 分页控件）、集成验证。每个阶段在前一阶段基础上递增构建，确保无孤立代码。

## 任务

- [x] 1. 数据库迁移与过期时间计算工具函数
  - 进展：已完成迁移脚本、`computeExpiresAt` 实现及必需接入；已补充单元测试，可选属性测试未执行。
  - [x] 1.1 创建数据库迁移脚本
    - 新建 `backend/src/db/migrate_task_expires_at.sql`
    - 为 `tasks` 表添加 `expires_at DATETIME NULL` 字段（位于 `completed_at` 之后）
    - 创建 `idx_expires_at` 索引
    - _需求: 1.1, 1.5_

  - [x] 1.2 实现 `computeExpiresAt` 工具函数
    - 在 `backend/src/utils/urlExpiry.ts` 中新增 `computeExpiresAt(outputUrl, thumbnailUrl, completedAt)` 函数
    - 调用已有的 `parseUrlExpiry` 分别解析 `outputUrl` 和 `thumbnailUrl` 的过期时间
    - 取两者中较早的过期时间；若均无法解析则回退到 `completedAt + 24小时`
    - 导出该函数供 TaskPoller 和 DirectTask 使用
    - _需求: 1.2, 1.3, 1.4_

  - [x]* 1.3 编写 `computeExpiresAt` 属性测试
    - **Property 1: 过期时间计算正确性**
    - 使用 `fast-check` 生成随机签名 URL 对（含 CloudFront Policy、S3 预签名、TOS 预签名、无签名等组合），验证 `computeExpiresAt` 输出等于可解析过期时间的较小值或 `completedAt + 24h`
    - 测试文件: `backend/src/__tests__/computeExpiresAt.property.test.ts`
    - **验证: 需求 1.2, 1.3, 1.4**

  - [x]* 1.4 编写 `computeExpiresAt` 单元测试
    - 测试各种 URL 格式组合：仅 outputUrl 可解析、仅 thumbnailUrl 可解析、两者均可解析（取较小值）、两者均不可解析（fallback）、null 输入
    - 测试文件: `backend/src/__tests__/computeExpiresAt.test.ts`
    - _需求: 1.2, 1.3, 1.4_

- [x] 2. 后端：任务成功时写入 `expires_at`
  - [x] 2.1 修改 TaskPoller 的 `handleSuccess` 函数
    - 在 `backend/src/services/taskPoller.ts` 的 `handleSuccess` 中，调用 `computeExpiresAt` 计算过期时间
    - 在 `creditManager.finalizeTaskSuccess` 调用之后，执行 `UPDATE tasks SET expires_at = ? WHERE task_id = ?` 写入 `expires_at`
    - _需求: 1.2, 1.3, 1.4_

  - [x] 2.2 修改 DirectTask 的 `completeTask` 函数
    - 在 `backend/src/controllers/directTask.ts` 的 `completeTask` 中，调用 `computeExpiresAt` 计算过期时间
    - 在 `finalizeTaskSuccess` 调用之后，执行 `UPDATE tasks SET expires_at = ? WHERE task_id = ?` 写入 `expires_at`
    - _需求: 1.2, 1.3, 1.4_

- [x] 3. 后端：任务列表接口添加过期过滤、分页元数据和 `expiresAt` 字段
  - [x] 3.1 修改 `listTasks` 控制器
    - 在 `backend/src/controllers/task.ts` 的 `listTasks` 中修改 SQL 查询条件
    - SELECT 中增加 `expires_at` 字段
    - WHERE 条件增加 `AND (status != 'success' OR expires_at IS NULL OR expires_at > NOW())`
    - COUNT 查询同样增加过期过滤条件
    - 响应中每个任务对象新增 `expiresAt` 字段（ISO 8601 格式或 null）
    - _需求: 2.1, 2.2, 2.3, 3.1, 5.1, 5.3_

  - [x] 3.2 修改 `getTask` 控制器
    - 在 `backend/src/controllers/task.ts` 的 `getTask` 中，SELECT 增加 `expires_at` 字段
    - 响应中新增 `expiresAt` 字段（ISO 8601 格式或 null）
    - _需求: 3.2, 5.2, 5.4, 5.5_

  - [x]* 3.3 编写列表过期过滤属性测试
    - **Property 2: 列表过期过滤正确性**
    - **Property 6: 列表排序正确性**
    - 使用 `fast-check` 生成随机任务集合（不同 status、expires_at 值），验证过滤逻辑和排序
    - 测试文件: `backend/src/__tests__/taskListFilter.property.test.ts`
    - **验证: 需求 2.1, 2.2, 2.3, 5.3**

  - [x]* 3.4 编写分页参数规范化属性测试
    - **Property 4: 分页参数规范化**
    - 使用 `fast-check` 生成随机 page/pageSize 整数，验证规范化后 page >= 1、1 <= pageSize <= 50、返回数据长度不超过 pageSize
    - 测试文件: `backend/src/__tests__/taskPagination.property.test.ts`
    - **验证: 需求 4.1, 4.2, 4.3, 4.4**

  - [x]* 3.5 编写响应序列化属性测试
    - **Property 3: 响应序列化完整性**
    - 使用 `fast-check` 生成随机任务记录（含各种 expires_at 值），验证 `expiresAt` 字段为 ISO 8601 字符串或 null
    - 测试文件: `backend/src/__tests__/taskResponseSerialization.property.test.ts`
    - **验证: 需求 3.1, 3.2**

- [x] 4. 检查点 - 确保后端所有测试通过
  - 进展：已运行 `npm run typecheck` 和后端相关定向测试集，当前通过（`8/8 suites`, `19/19 tests`）。

- [x] 5. 前端：API 类型更新与倒计时工具函数
  - [x] 5.1 更新前端 `Task` 接口和 `listTasks` API
    - 在 `frontend/src/api/index.ts` 中，`Task` 接口新增 `expiresAt: string | null` 字段
    - 修改 `listTasks` 函数签名，支持 `page` 和 `pageSize` 参数
    - 更新返回类型为 `{ data: Task[]; total: number; page: number; pageSize: number }`
    - _需求: 3.1, 4.1, 4.2, 5.1_

  - [x] 5.2 实现 `formatExpiryCountdown` 工具函数
    - 在 `frontend/src/views/generatorTaskMeta.ts` 中新增 `formatExpiryCountdown(expiresAt)` 函数
    - 输入 `expiresAt`（ISO 8601 字符串或 null），返回 `{ text: string; urgent: boolean } | null`
    - 当 `expiresAt` 为 null 或已过期时返回 null
    - 剩余时间 < 1 小时时 `urgent` 为 true
    - 格式化文本如 "剩余 2小时30分" 或 "剩余 15分"
    - _需求: 3.3, 3.4, 3.5_

  - [x]* 5.3 编写 `formatExpiryCountdown` 属性测试
    - **Property 5: 倒计时格式化正确性**
    - 使用 `fast-check` 生成随机未来时间戳，验证返回的小时/分钟数正确、urgent 标志正确；null 和过去时间戳返回 null
    - 测试文件: `frontend/src/views/__tests__/expiryCountdown.property.test.ts`
    - **验证: 需求 3.3, 3.4, 3.5**

  - [x]* 5.4 编写 `formatExpiryCountdown` 单元测试
    - 测试 null 输入、已过期时间、刚好 1 小时、远未来时间、边界情况
    - 测试文件: `frontend/src/views/__tests__/expiryCountdown.test.ts`
    - _需求: 3.3, 3.4, 3.5_

- [x] 6. 前端：GeneratorView 展示倒计时与分页控件
  - [x] 6.1 在 GeneratorView 中展示过期倒计时
    - 修改 `frontend/src/views/GeneratorView.vue`
    - 在任务卡片的 `task-meta` 区域，当任务 status 为 `success` 且 `expiresAt` 不为空时，调用 `formatExpiryCountdown` 展示倒计时文本
    - 当 `urgent` 为 true 时，使用红色文字样式（CSS class `expiry-urgent`）
    - 当 `expiresAt` 为空时不展示倒计时
    - _需求: 3.3, 3.4, 3.5_

  - [x] 6.2 在 GeneratorView 中添加分页控件
    - 在任务列表底部添加 `el-pagination` 组件
    - 新增 `currentPage`、`pageSize`、`total` 响应式变量
    - 修改 `loadTasks` 函数，传入 `page` 和 `pageSize` 参数
    - 当 `total` 不超过 `pageSize` 时隐藏分页控件（`v-if="total > pageSize"`）
    - 页码切换时重新加载任务列表
    - _需求: 4.5, 4.6, 5.1_

  - [x] 6.3 添加倒计时定时刷新
    - 在 GeneratorView 中设置每分钟刷新一次倒计时显示（使用 `setInterval`）
    - 组件卸载时清理定时器
    - _需求: 3.3_

- [x] 7. 最终检查点 - 确保所有测试通过
  - 进展：已运行后端 `npm run typecheck` 与相关定向测试、前端相关定向测试；当前通过（后端 `8/8 suites`, `19/19 tests`；前端 `4/4 files`, `12/12 tests`）。此前生产构建已通过，本轮未改动生产代码。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号，确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 现有的 `isDownloadExpired()` 运行时判断逻辑保持不变，`expires_at` 字段仅用于列表过滤和前端展示
