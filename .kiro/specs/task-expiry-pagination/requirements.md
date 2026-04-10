# 需求文档

## 简介

当前系统中，任务的过期时间是从 `output_url` 的签名参数中动态解析的（`urlExpiry.ts`），没有持久化到数据库。这导致每次查询都需要解析 URL，且无法高效地在数据库层面过滤已过期任务。本功能将过期时间持久化到 `tasks` 表，在列表接口中自动过滤已过期任务，并在前端展示过期倒计时。同时，后台需要提供两个接口：带分页的任务列表接口和单任务详情接口。

## 术语表

- **Task_Service**: 后端任务管理服务，负责任务的创建、查询、状态更新等操作
- **Task_List_API**: 任务列表接口 `GET /backend/tasks`，返回分页的任务列表
- **Task_Detail_API**: 任务详情接口 `GET /backend/tasks/:taskId`，返回单个任务的完整信息
- **expires_at**: `tasks` 表中新增的字段，存储任务输出 URL 的过期时间（UTC 时间戳）
- **URL_Expiry_Parser**: `urlExpiry.ts` 模块，负责从签名 URL 中解析过期时间
- **Expiry_Countdown**: 前端展示的过期倒计时，显示任务距离过期还剩多少时间
- **Frontend_Task_List**: 前端任务列表视图组件，展示用户的所有任务

## 需求

### 需求 1：过期时间持久化

**用户故事：** 作为开发者，我希望任务的过期时间保存在数据库中，以便系统能高效地查询和过滤过期任务，而不必每次都从 URL 签名中动态解析。

#### 验收标准

1. THE Task_Service SHALL 在 `tasks` 表中新增 `expires_at` 字段（DATETIME 类型，可为空）
2. WHEN 任务成功完成且 `output_url` 被写入时，THE Task_Service SHALL 调用 URL_Expiry_Parser 从 `output_url` 中解析过期时间，并将结果存储到 `expires_at` 字段
3. IF URL_Expiry_Parser 无法从 `output_url` 中解析出过期时间，THEN THE Task_Service SHALL 将 `expires_at` 设置为 `completed_at + 24小时` 作为回退值
4. WHEN `thumbnail_url` 存在且其过期时间早于 `output_url` 的过期时间时，THE Task_Service SHALL 以较早的过期时间作为 `expires_at` 的值
5. THE Task_Service SHALL 提供数据库迁移脚本，为 `tasks` 表添加 `expires_at` 字段并创建索引

### 需求 2：列表过滤已过期任务

**用户故事：** 作为用户，我希望任务列表中不显示已过期的任务，以便我只看到仍然可以下载的有效任务。

#### 验收标准

1. WHEN 用户请求任务列表时，THE Task_List_API SHALL 在查询中排除 `expires_at` 不为空且 `expires_at` 早于当前时间的已完成任务（status = 'success'）
2. THE Task_List_API SHALL 继续返回状态为 `queued`、`processing`、`failed`、`timeout` 的任务，无论其 `expires_at` 值如何
3. THE Task_List_API SHALL 继续返回 `expires_at` 为空的已完成任务（兼容历史数据）

### 需求 3：过期倒计时展示

**用户故事：** 作为用户，我希望在任务列表中看到每个任务还有多久过期，以便我及时下载模型文件。

#### 验收标准

1. THE Task_List_API SHALL 在每个任务的响应数据中包含 `expiresAt` 字段（ISO 8601 格式的时间字符串，可为 null）
2. THE Task_Detail_API SHALL 在任务的响应数据中包含 `expiresAt` 字段（ISO 8601 格式的时间字符串，可为 null）
3. WHEN 任务的 `expiresAt` 不为空且任务状态为 `success` 时，THE Frontend_Task_List SHALL 展示该任务距离过期的剩余时间（如"剩余 2小时30分"）
4. WHILE 任务的剩余过期时间少于 1 小时，THE Frontend_Task_List SHALL 以醒目样式（如红色文字）展示倒计时
5. WHEN 任务的 `expiresAt` 为空时，THE Frontend_Task_List SHALL 不展示过期倒计时信息

### 需求 4：分页功能

**用户故事：** 作为用户，我希望任务列表支持分页，以便在任务数量较多时能快速加载和浏览。

#### 验收标准

1. THE Task_List_API SHALL 接受 `page`（页码，默认 1）和 `pageSize`（每页条数，默认 20）查询参数
2. THE Task_List_API SHALL 在响应中返回 `total`（总条数）、`page`（当前页码）、`pageSize`（每页条数）字段
3. THE Task_List_API SHALL 将 `pageSize` 限制在 1 到 50 之间
4. WHEN `page` 参数小于 1 时，THE Task_List_API SHALL 将其修正为 1
5. THE Frontend_Task_List SHALL 在列表底部展示分页控件，允许用户切换页码
6. WHEN 总条数不超过一页时，THE Frontend_Task_List SHALL 隐藏分页控件

### 需求 5：后台接口规范

**用户故事：** 作为前端开发者，我希望后台提供清晰的任务列表接口和任务详情接口，以便前端能正确获取和展示任务数据。

#### 验收标准

1. THE Task_List_API（`GET /backend/tasks`）SHALL 返回格式为 `{ data: Task[], total: number, page: number, pageSize: number }` 的 JSON 响应
2. THE Task_Detail_API（`GET /backend/tasks/:taskId`）SHALL 返回单个 Task 对象的 JSON 响应，包含 `expiresAt` 字段
3. THE Task_List_API SHALL 按 `created_at` 降序排列任务
4. THE Task_Detail_API SHALL 验证任务归属于当前认证用户，IF 任务不存在或不属于当前用户，THEN THE Task_Detail_API SHALL 返回 HTTP 404 状态码
5. THE Task_List_API 和 THE Task_Detail_API SHALL 均需要通过认证中间件验证用户身份
