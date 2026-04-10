# 需求文档：前端直接调用第三方 API

## 简介

当前系统中，所有对第三方 3D 生成服务（Hyper3D、Tripo3D）的 API 调用均通过后端代理进行。这种架构导致后端承担了大量的网络 I/O 和计算负担（包括图片上传中转、任务创建、状态轮询等）。本特性将这些 API 调用迁移到前端直接执行，后端仅负责积分管理（预扣、确认、退款）和任务记录，从而大幅降低后端负载。

## 术语表

- **Frontend**：基于 Vue.js 的前端应用，运行在用户浏览器中
- **Backend**：基于 Node.js/Express 的后端服务，负责积分管理和任务记录
- **Provider**：第三方 3D 生成服务提供商（如 Tripo3D、Hyper3D）
- **Provider_API**：Provider 提供的 HTTP REST API
- **API_Key**：用于认证 Provider_API 的密钥，存储在后端数据库中（AES-256-GCM 加密）
- **Temporary_API_Key**：后端签发的短期有效 API Key 或代理令牌，供前端在有限时间内直接调用 Provider_API
- **Credit_Manager**：后端积分管理服务，负责预扣、确认扣减和退款
- **Task_Record**：后端数据库中的任务记录，包含任务状态、消耗积分等信息
- **Pre_Deduct**：任务创建前的积分预扣操作
- **Confirm_Deduct**：任务完成后根据实际消耗确认扣减积分
- **Task_Poller**：轮询 Provider_API 获取任务状态的组件（重构后由前端承担）
- **Callback_API**：后端提供的回调接口，供前端在任务状态变更时通知后端记录

## 需求

### 需求 1：API Key 安全分发

**用户故事：** 作为平台运营者，我希望前端能安全地获取调用 Provider_API 所需的凭证，以便前端直接调用 Provider_API 而不暴露长期有效的 API Key。

#### 验收标准

1. WHEN 前端请求创建任务, THE Backend SHALL 返回一个 Temporary_API_Key 供前端在本次任务流程中使用
2. THE Backend SHALL 对存储在数据库中的 API_Key 保持 AES-256-GCM 加密，前端无法直接获取原始 API_Key
3. IF Provider 不支持短期令牌机制, THEN THE Backend SHALL 直接返回解密后的 API_Key 并在响应中标注该 Key 的使用范围限制
4. WHEN Temporary_API_Key 过期或任务流程结束, THE Frontend SHALL 丢弃该凭证并不再使用

### 需求 2：前端直接创建任务

**用户故事：** 作为用户，我希望前端直接向 Provider_API 发起任务创建请求，以减少后端中转带来的延迟。

#### 验收标准

1. WHEN 用户提交文本生成 3D 模型请求, THE Frontend SHALL 直接调用 Provider_API 创建 text_to_model 任务
2. WHEN 用户提交图片生成 3D 模型请求, THE Frontend SHALL 直接调用 Provider_API 上传图片并创建 image_to_model 任务
3. WHEN Provider_API 返回任务创建成功, THE Frontend SHALL 将任务 ID、Provider ID 和任务类型发送到 Backend 的 Callback_API 进行记录
4. IF Provider_API 返回错误, THEN THE Frontend SHALL 向用户展示错误信息并通知 Backend 释放预扣积分

### 需求 3：积分预扣与确认流程

**用户故事：** 作为平台运营者，我希望在前端直接调用 API 的模式下，积分管理仍然由后端控制，以确保计费准确性。

#### 验收标准

1. WHEN 用户发起任务创建, THE Frontend SHALL 先调用 Backend 的预扣接口完成积分预扣
2. THE Backend SHALL 在预扣成功后返回 Temporary_API_Key 和预扣凭证
3. WHEN 任务成功完成, THE Frontend SHALL 调用 Backend 的确认接口，提交实际消耗的 credit_cost
4. IF 任务失败或超时, THEN THE Frontend SHALL 调用 Backend 的退款接口释放预扣积分
5. THE Backend SHALL 在预扣接口中执行节流延迟计算，与当前逻辑保持一致
6. IF 前端未在规定时间内回调确认或退款, THEN THE Backend SHALL 自动执行超时退款

### 需求 4：前端任务状态轮询

**用户故事：** 作为用户，我希望在前端直接轮询任务状态，以获得更实时的进度反馈。

#### 验收标准

1. WHEN 任务创建成功, THE Frontend SHALL 直接轮询 Provider_API 获取任务状态
2. WHILE 任务处于 queued 或 processing 状态, THE Frontend SHALL 每 3 秒轮询一次 Provider_API
3. WHEN 任务状态变为 success, THE Frontend SHALL 调用 Backend 的 Callback_API 提交任务完成信息（包括 output_url、thumbnail_url、credit_cost）
4. WHEN 任务状态变为 failed, THE Frontend SHALL 调用 Backend 的 Callback_API 提交失败信息并触发退款
5. IF 轮询超过 10 分钟未完成, THEN THE Frontend SHALL 停止轮询并调用 Backend 的超时回调接口

### 需求 5：后端回调接口

**用户故事：** 作为开发者，我希望后端提供一组回调接口，供前端在任务生命周期的关键节点通知后端进行记录和积分结算。

#### 验收标准

1. THE Backend SHALL 提供任务预扣接口（POST /tasks/prepare），接收任务类型、Provider ID，执行积分预扣并返回 API Key
2. THE Backend SHALL 提供任务创建回调接口（POST /tasks/register），接收前端从 Provider 获取的 task_id 并创建 Task_Record
3. THE Backend SHALL 提供任务完成回调接口（POST /tasks/:taskId/complete），接收 output_url、thumbnail_url、credit_cost 并执行积分确认扣减
4. THE Backend SHALL 提供任务失败回调接口（POST /tasks/:taskId/fail），接收错误信息并执行积分退款
5. THE Backend SHALL 对所有回调接口执行用户身份验证，确保只有任务所有者能操作对应任务

### 需求 6：前端 Provider 适配层

**用户故事：** 作为开发者，我希望前端有一个统一的 Provider 适配层，以便支持多个 Provider 的 API 调用而不影响业务逻辑。

#### 验收标准

1. THE Frontend SHALL 实现一个 Provider 适配器接口，定义 createTask、getTaskStatus 方法
2. THE Frontend SHALL 实现 Tripo3DAdapter，封装 Tripo3D API 的任务创建和状态查询逻辑
3. THE Frontend SHALL 实现 Hyper3DAdapter，封装 Hyper3D API 的任务创建和状态查询逻辑
4. WHEN 新增 Provider 时, THE Frontend SHALL 只需实现新的适配器而无需修改业务逻辑代码

### 需求 7：后端轮询器退役

**用户故事：** 作为开发者，我希望在前端接管轮询后，后端的 TaskPoller 被安全移除，以减少后端资源消耗。

#### 验收标准

1. WHILE 存在通过旧流程创建的未完成任务, THE Backend SHALL 继续运行 TaskPoller 处理这些任务
2. WHEN 所有旧流程任务完成或超时, THE Backend SHALL 停止 TaskPoller
3. THE Backend SHALL 保留一个超时守护机制，对前端未及时回调的任务执行超时退款

### 需求 8：错误处理与容错

**用户故事：** 作为用户，我希望在前端直接调用 API 出错时，系统能正确处理错误并保护我的积分不被错误扣减。

#### 验收标准

1. IF 前端调用 Provider_API 时发生网络错误, THEN THE Frontend SHALL 重试最多 3 次，每次间隔 2 秒
2. IF 重试仍然失败, THEN THE Frontend SHALL 调用 Backend 的退款接口释放预扣积分并向用户展示错误信息
3. IF 前端在任务进行中意外关闭（如用户关闭浏览器）, THEN THE Backend SHALL 通过超时守护机制在 15 分钟后自动退款
4. IF 前端提交的回调数据与预扣记录不匹配, THEN THE Backend SHALL 拒绝该回调并返回错误信息

### 需求 9：CORS 与安全配置

**用户故事：** 作为平台运营者，我希望前端直接调用 Provider_API 时不会遇到跨域问题，同时确保安全性。

#### 验收标准

1. WHEN 前端直接调用 Provider_API, THE Frontend SHALL 验证 Provider_API 支持浏览器端 CORS 请求
2. IF Provider_API 不支持浏览器端 CORS, THEN THE Backend SHALL 提供一个轻量级代理端点仅转发该特定请求
3. THE Backend SHALL 在返回 API Key 时设置适当的响应头，防止 Key 被缓存或泄露到日志中
4. THE Frontend SHALL 将 API Key 仅存储在内存中，不写入 localStorage 或 sessionStorage

### 需求 10：向后兼容与渐进迁移

**用户故事：** 作为开发者，我希望新旧架构能共存一段时间，以便渐进式迁移而不影响现有用户。

#### 验收标准

1. THE Backend SHALL 同时支持旧的代理模式和新的回调模式，通过配置开关控制
2. WHEN 配置为新模式时, THE Backend SHALL 停止代理 API 调用，仅提供回调接口和积分管理
3. WHEN 配置为旧模式时, THE Backend SHALL 保持当前的代理调用行为不变
4. THE Frontend SHALL 根据后端返回的模式标识决定使用直接调用还是代理调用
