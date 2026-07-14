# AI 3D 统一队列 - P2 上线、压测与回滚手册

本文面向 root 管理员和发布人员。它不保存 API Key、真实用户 ID、余额或供应商原始响应。

## 1. 灰度开关

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `UNIFIED_PROVIDER_QUEUE_ENABLED` | `false` | 默认保持旧直连创建逻辑；`true`/`all` 为全部用户接入；`canary` 为白名单接入；`false`/`disabled` 停止新队列受理。 |
| `UNIFIED_PROVIDER_QUEUE_USER_IDS` | 空 | 逗号分隔的数值用户 ID 白名单。只要该值非空，只有名单内用户走统一队列。 |
| `UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED` | `true` | `false` 时 Dispatcher 不再向供应商提交新任务；已接单任务仍由 State Coordinator 轮询、结算和释放名额。 |
| `PROVIDER_QUEUE_SCAN_MS` | `2000` | 兜底扫描间隔。课堂场景保持 2 秒，避免将唤醒事件丢失放大为长时间卡队。 |
| `AI3D_QUEUE_WAIT_ALERT_SECONDS` | `600` | 最老等待任务超过该值时告警。 |
| `AI3D_QUEUE_ADMISSION_MAX_RETRIES` | `6` | MySQL 死锁或锁等待超时时的入队重试上限；带随机抖动，范围 1–6。 |

使用 Docker 部署时，在 `driver/.env` 配置同名的 `AI3D_` 前缀变量（例如 `AI3D_UNIFIED_PROVIDER_QUEUE_ENABLED=canary`）；`driver/docker-compose.yml` 会把它们传入插件后端。修改开关后重启 AI 3D 后端容器即可生效。

灰度的互斥边界在服务端执行：白名单用户只能使用 `POST /tasks`，旧 `/tasks/prepare` 与 `/tasks/register` 会返回 `LEGACY_DIRECT_CREATION_DISABLED`；非白名单用户的 `POST /tasks` 会返回 `UNIFIED_QUEUE_NOT_ENABLED_FOR_USER`，不会预扣 Power。旧链路的临时预扣在 15 分钟有效期内也计入未结束任务，防止切换瞬间双重提交。

## 2. 推荐上线顺序

1. 在生产结构副本上备份并执行本手册第 5 节的迁移演练。
2. 部署包含新列和兼容读取逻辑的后端，先保持 `UNIFIED_PROVIDER_QUEUE_ENABLED=false` 和 `UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED=false`。
3. 检查 `/health`：数据库、schema、dispatcher、state coordinator 和 observability 必须分别可见；这一步不要求向供应商派发任务。
4. 设置 `UNIFIED_PROVIDER_QUEUE_ENABLED=canary` 与一个测试用户的 `UNIFIED_PROVIDER_QUEUE_USER_IDS`，并将 `UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED=true`。
5. 使用该测试用户完成文本、图片、取消、429 重试和清零前后各一次验证；观察至少一个扫描周期。
6. 扩大白名单后，再删除 `UNIFIED_PROVIDER_QUEUE_USER_IDS` 进入全量。前端队列状态应在后端稳定后再开放给全部课堂用户。

每一步只扩大一个变量；不要同时修改供应商 Key、并发上限、Power 上限和灰度范围。

## 3. 安全回滚

如果出现持续 429、供应商账户异常、异常等待时间或未知状态积压，先执行配置级回滚：

```text
UNIFIED_PROVIDER_QUEUE_ENABLED=false
UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED=false
```

重启后端容器或重新加载运行环境。回滚效果是：停止新队列受理和新的供应商派发；不会删除任务、不会把已接单任务改为取消、不会重复退款。State Coordinator 和结算继续运行，直到已接单任务达到终态。

回滚后检查：

- `/health` 的 dispatcher `dispatchEnabled=false`，进程仍是存活状态；
- 管理端告警显示“队列派发已暂停”；
- 已接单任务仍可在任务详情、下载、缩略图和额度流水中查询；
- 不执行数据库删表、删任务或手工修改 `used_power`。

恢复时先打开 `UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED=true`，确认队列开始下降后，再逐步恢复 `UNIFIED_PROVIDER_QUEUE_ENABLED` 的灰度范围。

## 4. 课堂容量基线和压测记录

目标课堂基线：30 名学员在 3 秒内提交 Tripo3D，Tripo 并发上限为 4；Hyper3D 从 1 并发起步。记录应使用脱敏的时间窗口和计数，不记录提示词、图片或 API Key。

| 检查项 | 预期结果 | 证据位置 |
| --- | --- | --- |
| Tripo 30 人突发提交 | 30 个任务立即可查询；最多 4 个有效占槽，其余为 `waiting_provider` | 管理端队列表、`provider_runtime_config`、结构化日志 |
| Hyper3D 打包 | 生成 Job 全部 Done 后释放生成槽；`packaging` 不占用下一项生成槽 | 任务事件与 Hyper3D 轮询记录 |
| 429 / 5xx / 慢响应 / 断网 | 429/可恢复错误进入 `retry_wait` 并带退避；超时提交进入未知状态，不重复预扣 | 任务事件、`next_attempt_at`、额度流水 |
| 余额/鉴权失败 | 相应 provider scope 自动暂停，管理员恢复前不再提交 | 管理端告警与审计日志 |
| 清零和上限设为 1 | 等待任务取消并退款；已接单任务保留旧 `quota_epoch`，不污染新周期 | 清零预览、`quota_usage_ledger`、任务详情 |
| 重启恢复 | 过期租约可重新领取；已提交或未知任务只核对/轮询，不盲目重复提交 | 任务事件和服务启动日志 |

基线记录至少包含：日期、环境、供应商、并发配置、任务数、最大 active count、最老等待、p50/p95 等待时间、成功/失败/429/未知计数、扫描间隔、轮询间隔、Worker 数量和结论。数据库应保留 `tasks(provider_id, credential_scope, status, queue_entered_at)`、租约和事件索引；若 p95 随队列长度线性恶化，先优化索引或扫描批次，再增加 Worker。

### 4.1 可重复的本地数据库验收

在第 5 节创建的**隔离副本**上可执行下列脚本。它注册一个进程内假的 Tripo3D Adapter，不访问真实供应商、不会使用真实 API Key；但会使用真实 MySQL 表、事务、预扣、Dispatcher、清零和结算代码。脚本拒绝非 `ai3d_p2_*` 或 `ai3d-p2-*` 的数据库名称。

```bash
cd plugins/ai-3d-generator-v3/backend
AI3D_QUEUE_P2_SCENARIOS=1 AI3D_QUEUE_P2_ISOLATED_DB=1 \
  DB_NAME=ai3d_p2_rehearsal_YYYYMMDD npm run verify:p2-scenarios
```

通过条件：输出 JSON 中容量场景 `submitted=30`、`maxActiveSlots=4`、`finalStatus=success`；`baseline` 必须记录入队耗时、队列排空耗时、P50/P95、扫描间隔、轮询间隔与 Worker 数；故障场景涵盖 429、5xx、慢响应、断网、余额和鉴权；清零场景保留已接单旧周期任务并拒绝第二次 1 Power 预留；恢复场景不重复提交或重复结算。保留 JSON 作为第 15 节验收证据。

2026-07-14 已在可丢弃隔离副本 `ai3d_p2_rehearsal_20260714b` 运行：30 个提交全部成功，最大有效槽位为 4；本地队列入队 441ms、排空 2.99s、P50 1.91s、P95 2.91s（1 Worker、扫描 2s、轮询 1s）。429、5xx、断网、未知提交、慢响应、余额不足与权限不足均按预期进入相应的重试、未知或暂停路径；清零后等待任务取消、已接单旧周期任务成功结算，上限为 1 时第二次预留被拒绝。此基线使用进程内假供应商，衡量的是平台队列与数据库路径，不代表供应商生成时长。

### 4.2 跨进程重启演练

下面命令会启动两个独立 Node 进程：第一个在 Dispatcher 领取、供应商任务 ID 已持久化、供应商终态结算前留下检查点并退出；第二个进程重新加载 Dispatcher 与 State Coordinator。通过条件是：领取前的过期租约进入 `provider_state_unknown` 而不盲目重提；已经创建的供应商任务保留原任务 ID 并成功结算；重启后供应商创建次数为 0；每项任务只有一笔预扣和一笔结算。

```bash
cd plugins/ai-3d-generator-v3/backend
AI3D_QUEUE_P2_SCENARIOS=1 AI3D_QUEUE_P2_ISOLATED_DB=1 \
  DB_NAME=ai3d_p2_rehearsal_YYYYMMDD npm run verify:p2-restart
```

2026-07-14 上述演练已通过；恢复进程的 `providerCreateCallsAfterRestart=0`，两项已提交任务均成功，且未发现重复预扣或结算。它验证应用进程恢复，不会重启或干扰生产容器。

## 5. 迁移和回滚演练

只可对可丢弃的生产结构副本执行。脚本会应用正常的增量 schema bootstrap，并比较迁移前后的历史任务、额度流水和未完成任务数；不会删除数据。

```bash
cd plugins/ai-3d-generator-v3/backend
AI3D_MIGRATION_REHEARSAL=1 npm run rehearse:migration
```

运行前必须指向副本 DB，并保存输出 JSON 作为发布证据。通过条件：`countsPreserved=true`、缺失表/列为空、`rollback.validated=true`。失败时停止发布，恢复副本快照并排查迁移；不得对真实生产库使用“反向删列”回滚。

2026-07-14 已从当前运行中的 `ai_3d_generator_v3` 创建隔离副本 `ai3d_p2_runtime_replica_20260714` 并完成演练。源库与副本创建时均为任务 3 条、额度流水 4 条；演练应用 `20260714_ai3d_p2_queue_admission_contention` 后，任务 3 条、额度流水 4 条、未完成任务 0 条保持不变，缺失表/列均为空，且回滚配置验证通过。这是本次 P2 的迁移发布证据；后续发布仍应按本节在目标环境的新鲜副本上重跑。

## 6. 日常故障处理

| 现象 | 首先检查 | 安全处理 |
| --- | --- | --- |
| 供应商繁忙 | `SUSTAINED_THROTTLING`、`retry_wait`、`Retry-After` | 保持自动重试；不要要求学生重复点生成。 |
| 余额不足或鉴权失败 | `PROVIDER_BALANCE_LOW`/`PROVIDER_AUTH_FAILED` 告警 | 补充余额或修复授权后在管理端恢复 provider scope。 |
| 未知提交 | `provider_state_unknown` 与内部/供应商 Trace ID | 先核对供应商后台；确认未接单前不得重试。 |
| 队列过久 | 最老等待、p50/p95、有效占槽 | 检查并发合同和暂停状态；提高上限不会中断已运行任务。 |
| 老师清零 | 先看预览中的等待和已接单数量 | 确认后等待任务会取消退款；已接单任务继续完成并归属旧周期。 |

## 7. 发布后观察窗口

灰度每次扩大后至少观察一个课堂高峰窗口。若出现连续未知状态、p95 等待超过阈值、余额/鉴权暂停或预扣流水异常，停止扩大范围并执行第 3 节回滚。生产全量开关需要发布负责人单独确认；本手册不授权自动扩量。
