import { randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { pool, query } from '../db/connection';
import type { CreateTaskInput } from '../adapters/IProviderAdapter';
import { providerRegistry } from '../adapters/ProviderRegistry';
import { decrypt } from './crypto';
import { activeQuotaTool } from './quotaToolRegistry';
import { logQueueEvent } from './observability';
import { isQueueDispatchEnabled } from './queueRollout';

const DISPATCH_SCAN_MS = Math.max(500, Number(process.env.PROVIDER_QUEUE_SCAN_MS ?? 2000));
const LEASE_SECONDS = Math.max(15, Number(process.env.PROVIDER_QUEUE_LEASE_SECONDS ?? 60));
const workerId = `${process.pid}:${randomUUID()}`;

let scanTimer: NodeJS.Timeout | null = null;
let dispatching = false;
let wakeScheduled = false;
let dispatcherStarted = false;
let lastScanAt: Date | null = null;
let lastScanError: string | null = null;

interface RuntimeRow extends RowDataPacket {
  provider_id: string;
  credential_scope: string;
  max_concurrency: number;
  paused: number;
  retry_limit: number;
}

interface QueueTaskRow extends RowDataPacket {
  task_id: string;
  user_id: number;
  provider_id: string;
  credential_scope: string;
  request_payload: string;
  attempt_count: number;
  retry_limit: number;
  quota_epoch: number;
}

interface ActiveCountRow extends RowDataPacket {
  active_count: number | string;
}

export type ProviderErrorCategory =
  | 'THROTTLED'
  | 'TEMPORARY'
  | 'SUBMISSION_UNKNOWN'
  | 'NO_BALANCE'
  | 'NO_ACCESS'
  | 'INVALID_INPUT'
  | 'CONTENT_REJECTED'
  | 'PROVIDER_FAILED';

export function classifyProviderError(error: unknown): {
  category: ProviderErrorCategory;
  code: string | null;
  message: string;
  retryAfterSeconds: number | null;
} {
  const raw = error as {
    code?: string | number;
    message?: string;
    response?: {
      status?: number;
      data?: { code?: string | number; message?: string };
      headers?: Record<string, string | number | undefined>;
    };
  };
  const status = Number(raw?.response?.status ?? 0);
  const providerCode = raw?.response?.data?.code ?? raw?.code;
  const message = String(raw?.response?.data?.message ?? raw?.message ?? 'Provider request failed').slice(0, 500);
  const normalized = message.toLowerCase();
  const retryAfterRaw = raw?.response?.headers?.['retry-after'];
  const retryAfterParsed = Number(retryAfterRaw);
  const retryAfterSeconds = Number.isFinite(retryAfterParsed) && retryAfterParsed >= 0
    ? Math.min(3600, Math.ceil(retryAfterParsed))
    : null;

  if (status === 429 || String(providerCode) === '2000' || normalized.includes('rate limit') || normalized.includes('concurr')) {
    return { category: 'THROTTLED', code: String(providerCode || status || '') || null, message, retryAfterSeconds };
  }
  if (raw?.code === 'ECONNABORTED' || normalized.includes('timeout') || normalized.includes('timed out')) {
    return { category: 'SUBMISSION_UNKNOWN', code: String(raw.code ?? '') || null, message, retryAfterSeconds };
  }
  if (status === 401 || status === 403) {
    return { category: 'NO_ACCESS', code: String(status), message, retryAfterSeconds };
  }
  if (normalized.includes('balance') || normalized.includes('credit')) {
    return { category: 'NO_BALANCE', code: String(providerCode ?? '') || null, message, retryAfterSeconds };
  }
  if (normalized.includes('content') && (normalized.includes('reject') || normalized.includes('moderation'))) {
    return { category: 'CONTENT_REJECTED', code: String(providerCode ?? '') || null, message, retryAfterSeconds };
  }
  if (status === 400 || status === 422) {
    return { category: 'INVALID_INPUT', code: String(status), message, retryAfterSeconds };
  }
  if (status >= 500 || raw?.code === 'ECONNRESET' || raw?.code === 'ENOTFOUND') {
    return { category: 'TEMPORARY', code: String(providerCode || status || '') || null, message, retryAfterSeconds };
  }
  return { category: 'PROVIDER_FAILED', code: String(providerCode ?? '') || null, message, retryAfterSeconds };
}

export function calculateRetryDelaySeconds(attemptCount: number, randomValue = Math.random()): number {
  return Math.min(300, 2 ** Math.min(Math.max(1, attemptCount), 7) + Math.floor(Math.max(0, randomValue) * 3));
}

export function hasProviderCapacity(activeCount: number, maxConcurrency: number, paused: boolean): boolean {
  return !paused && maxConcurrency > 0 && activeCount < maxConcurrency;
}

async function getApiKey(providerId: string): Promise<string> {
  const rows = await query<Array<{ value: string }>>(
    'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
    [`${providerId}_api_key`]
  );
  if (!rows?.[0]?.value) {
    throw Object.assign(new Error(`${providerId} API Key 未配置`), { response: { status: 403 } });
  }
  return decrypt(rows[0].value);
}

async function event(
  task: Pick<QueueTaskRow, 'task_id' | 'provider_id' | 'attempt_count'>,
  eventType: string,
  fromStatus: string | null,
  toStatus: string | null,
  detail?: unknown,
  internalTraceId?: string
): Promise<void> {
  await query(
    `INSERT INTO provider_task_events
      (task_id, provider_id, event_type, from_status, to_status, attempt_count, trace_id, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.task_id, task.provider_id, eventType, fromStatus, toStatus, task.attempt_count, internalTraceId ?? null, detail ? JSON.stringify(detail) : null]
  );
}

async function claimOne(runtime: RuntimeRow): Promise<QueueTaskRow | null> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [lockedRuntime] = await connection.query<RuntimeRow[]>(
      `SELECT provider_id, credential_scope, max_concurrency, paused, retry_limit
       FROM provider_runtime_config
       WHERE provider_id = ? AND credential_scope = ?
       FOR UPDATE`,
      [runtime.provider_id, runtime.credential_scope]
    );
    const current = lockedRuntime[0];
    if (!current || Number(current.paused) === 1) {
      await connection.commit();
      return null;
    }

    const [countRows] = await connection.query<ActiveCountRow[]>(
      `SELECT COUNT(*) AS active_count
       FROM tasks
       WHERE provider_id = ?
         AND credential_scope = ?
         AND provider_slot_acquired_at IS NOT NULL
         AND provider_slot_released_at IS NULL
         AND status IN ('submitting', 'queued', 'processing', 'provider_state_unknown')`,
      [runtime.provider_id, runtime.credential_scope]
    );
    if (!hasProviderCapacity(
      Number(countRows[0]?.active_count ?? 0),
      Number(current.max_concurrency),
      Number(current.paused) === 1
    )) {
      await connection.commit();
      return null;
    }

    const [rows] = await connection.query<QueueTaskRow[]>(
      `SELECT task_id, user_id, provider_id, credential_scope, request_payload, attempt_count, quota_epoch
       FROM tasks t
       WHERE t.provider_id = ?
         AND t.credential_scope = ?
         AND t.status IN ('waiting_provider', 'retry_wait')
         AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= NOW())
         AND (t.lease_expires_at IS NULL OR t.lease_expires_at <= NOW())
       ORDER BY (
         SELECT COUNT(*) FROM tasks active_user
         WHERE active_user.user_id = t.user_id
           AND active_user.provider_id = t.provider_id
           AND active_user.provider_slot_acquired_at IS NOT NULL
           AND active_user.provider_slot_released_at IS NULL
       ) ASC,
       t.priority DESC, t.queue_entered_at ASC, t.task_id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [runtime.provider_id, runtime.credential_scope]
    );
    const task = rows[0];
    if (!task) {
      await connection.commit();
      return null;
    }

    await connection.query(
      `UPDATE tasks
       SET status = 'submitting',
           lease_owner = ?,
           lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
           provider_slot_acquired_at = COALESCE(provider_slot_acquired_at, NOW()),
           provider_slot_released_at = NULL,
           attempt_count = attempt_count + 1,
           provider_error_category = NULL,
           provider_error_code = NULL,
           error_message = NULL
       WHERE task_id = ? AND status IN ('waiting_provider', 'retry_wait')`,
      [workerId, LEASE_SECONDS, task.task_id]
    );
    await connection.commit();
    return {
      ...task,
      attempt_count: Number(task.attempt_count) + 1,
      retry_limit: Number(current.retry_limit),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function pauseScope(task: QueueTaskRow, reason: string, internalTraceId: string): Promise<void> {
  await query(
    `UPDATE provider_runtime_config
     SET paused = 1, pause_reason = ?, config_version = config_version + 1
     WHERE provider_id = ? AND credential_scope = ?`,
    [reason.slice(0, 256), task.provider_id, task.credential_scope]
  );
  logQueueEvent({
    event: 'provider_scope_auto_paused', localTaskId: task.task_id, providerId: task.provider_id,
    credentialScope: task.credential_scope, quotaEpoch: task.quota_epoch, attemptCount: task.attempt_count,
    internalTraceId, providerCategory: reason.split(':')[0] ?? null,
  });
}

async function dispatchTask(task: QueueTaskRow): Promise<void> {
  const dispatchTraceId = randomUUID();
  const adapter = providerRegistry.get(task.provider_id);
  if (!adapter) {
    await failBeforeSubmission(task, 'PROVIDER_FAILED', 'Provider 未启用', null, dispatchTraceId);
    return;
  }

  try {
    const input = JSON.parse(task.request_payload) as CreateTaskInput;
    const apiKey = await getApiKey(task.provider_id);
    const result = await adapter.createTask(apiKey, input);
    await query(
      `UPDATE tasks
       SET provider_task_id = ?,
           provider_status_key = ?,
           status = 'queued',
           lease_owner = NULL,
           lease_expires_at = NULL,
           next_attempt_at = NULL
       WHERE task_id = ? AND status = 'submitting' AND lease_owner = ?`,
      [result.taskId, result.pollingKey ?? result.taskId, task.task_id, workerId]
    );
    await event(task, 'provider_submitted', 'submitting', 'queued', { providerTaskId: result.taskId }, dispatchTraceId);
    logQueueEvent({
      event: 'provider_submitted', localTaskId: task.task_id, providerTaskId: result.taskId,
      providerId: task.provider_id, credentialScope: task.credential_scope, quotaEpoch: task.quota_epoch, attemptCount: task.attempt_count,
      internalTraceId: dispatchTraceId,
    });
  } catch (error) {
    const details = classifyProviderError(error);
    if (details.category === 'SUBMISSION_UNKNOWN') {
      await query(
        `UPDATE tasks
         SET status = 'provider_state_unknown', lease_owner = NULL, lease_expires_at = NULL,
             provider_error_category = ?, provider_error_code = ?, error_message = ?
         WHERE task_id = ? AND status = 'submitting'`,
        [details.category, details.code, '供应商提交结果待核对，请勿重复提交', task.task_id]
      );
      await event(task, 'submission_unknown', 'submitting', 'provider_state_unknown', details, dispatchTraceId);
      logQueueEvent({
        event: 'provider_submission_unknown', localTaskId: task.task_id, providerId: task.provider_id,
        credentialScope: task.credential_scope, attemptCount: task.attempt_count,
        quotaEpoch: task.quota_epoch, internalTraceId: dispatchTraceId, providerCategory: details.category, providerCode: details.code,
      });
      return;
    }

    if (details.category === 'THROTTLED' || details.category === 'TEMPORARY') {
      if (task.attempt_count >= task.retry_limit) {
        await failBeforeSubmission(task, details.category, `超过最大重试次数：${details.message}`, details.code, dispatchTraceId);
        return;
      }
      const retrySeconds = Math.max(
        details.retryAfterSeconds ?? 0,
        calculateRetryDelaySeconds(task.attempt_count)
      );
      await query(
        `UPDATE tasks
         SET status = 'retry_wait', lease_owner = NULL, lease_expires_at = NULL,
             provider_slot_released_at = NOW(), next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
             retry_after_seconds = ?, provider_error_category = ?, provider_error_code = ?, error_message = ?
         WHERE task_id = ? AND status = 'submitting'`,
        [retrySeconds, retrySeconds, details.category, details.code, '供应商繁忙，平台将自动重试', task.task_id]
      );
      await event(task, 'dispatch_retry_scheduled', 'submitting', 'retry_wait', details, dispatchTraceId);
      logQueueEvent({
        event: 'provider_retry_scheduled', localTaskId: task.task_id, providerId: task.provider_id,
        credentialScope: task.credential_scope, attemptCount: task.attempt_count,
        quotaEpoch: task.quota_epoch, internalTraceId: dispatchTraceId, providerCategory: details.category, providerCode: details.code,
      });
      wakeProviderDispatcher();
      return;
    }

    if (details.category === 'NO_ACCESS' || details.category === 'NO_BALANCE') {
      await pauseScope(task, `${details.category}: ${details.message}`, dispatchTraceId);
      await query(
        `UPDATE tasks
         SET status = 'retry_wait', lease_owner = NULL, lease_expires_at = NULL,
             provider_slot_released_at = NOW(), next_attempt_at = NULL,
             provider_error_category = ?, provider_error_code = ?, error_message = ?
         WHERE task_id = ? AND status = 'submitting'`,
        [details.category, details.code, '供应商账号暂不可用，管理员处理后将继续', task.task_id]
      );
      await event(task, 'provider_scope_paused', 'submitting', 'retry_wait', details, dispatchTraceId);
      return;
    }

    await failBeforeSubmission(task, details.category, details.message, details.code);
  }
}

async function failBeforeSubmission(
  task: QueueTaskRow,
  category: ProviderErrorCategory,
  message: string,
  code: string | null = null,
  internalTraceId = randomUUID()
): Promise<void> {
  await query(
    `UPDATE tasks
     SET status = 'failed', completed_at = NOW(), provider_slot_released_at = NOW(),
         lease_owner = NULL, lease_expires_at = NULL,
         provider_error_category = ?, provider_error_code = ?, error_message = ?
     WHERE task_id = ? AND status = 'submitting'`,
    [category, code, message.slice(0, 500), task.task_id]
  );
  await activeQuotaTool.refund(task.user_id, task.provider_id, task.task_id);
  await event(task, 'dispatch_failed', 'submitting', 'failed', { category, code, message }, internalTraceId);
  logQueueEvent({
    event: 'provider_dispatch_failed', localTaskId: task.task_id, providerId: task.provider_id,
    credentialScope: task.credential_scope, quotaEpoch: task.quota_epoch, attemptCount: task.attempt_count, internalTraceId,
    providerCategory: category, providerCode: code,
  });
  wakeProviderDispatcher();
}

async function dispatchAvailable(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  lastScanAt = new Date();
  try {
    // Rollback deliberately pauses new provider submissions but leaves the
    // poller/state coordinator running so accepted work can settle safely.
    if (!isQueueDispatchEnabled()) return;
    await query(
      `UPDATE tasks
       SET status = 'provider_state_unknown', lease_owner = NULL, lease_expires_at = NULL,
           provider_error_category = 'SUBMISSION_UNKNOWN',
           error_message = '派发进程中断，正在核对供应商是否已接单'
       WHERE status = 'submitting' AND provider_task_id IS NULL
         AND lease_expires_at IS NOT NULL AND lease_expires_at <= NOW()`
    );
    const runtimes = await query<RuntimeRow[]>(
      `SELECT provider_id, credential_scope, max_concurrency, paused, retry_limit
       FROM provider_runtime_config`
    );
    for (const runtime of runtimes) {
      if (!providerRegistry.isEnabled(runtime.provider_id) || Number(runtime.paused) === 1) continue;
      for (let claimed = 0; claimed < Number(runtime.max_concurrency); claimed += 1) {
        const task = await claimOne(runtime);
        if (!task) break;
        void dispatchTask(task).catch((error) => {
          console.error(`[ProviderQueue] dispatch ${task.task_id} failed:`, error);
        });
      }
    }
  } catch (error) {
    lastScanError = (error as Error).message;
    throw error;
  } finally {
    dispatching = false;
  }
}

/**
 * Runs one durable queue scan. This is intentionally not an HTTP endpoint:
 * it is used by the isolated P2 verification tool and by focused integration
 * checks to exercise the same claim-and-dispatch path as the live worker.
 */
export async function runProviderDispatcherOnce(): Promise<void> {
  await dispatchAvailable();
}

export function wakeProviderDispatcher(): void {
  if (!dispatcherStarted) return;
  if (wakeScheduled) return;
  wakeScheduled = true;
  setImmediate(() => {
    wakeScheduled = false;
    void dispatchAvailable().catch((error) => console.error('[ProviderQueue] wake failed:', error));
  });
}

export function startProviderDispatcher(): void {
  if (scanTimer) return;
  dispatcherStarted = true;
  wakeProviderDispatcher();
  scanTimer = setInterval(wakeProviderDispatcher, DISPATCH_SCAN_MS);
  console.log(`[ProviderQueue] dispatcher started (${workerId})`);
}

export function stopProviderDispatcher(): void {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  dispatcherStarted = false;
}

export function getProviderDispatcherHealth(): {
  running: boolean;
  dispatchEnabled: boolean;
  workerId: string;
  scanMs: number;
  lastScanAt: string | null;
  lastScanError: string | null;
} {
  return {
    running: dispatcherStarted,
    dispatchEnabled: isQueueDispatchEnabled(),
    workerId,
    scanMs: DISPATCH_SCAN_MS,
    lastScanAt: lastScanAt?.toISOString() ?? null,
    lastScanError,
  };
}

export async function getQueuePosition(taskId: string, providerId: string): Promise<number | null> {
  const rows = await query<Array<{ position: number | string }>>(
    `SELECT COUNT(*) + 1 AS position
     FROM tasks target
     WHERE target.provider_id = ?
       AND target.credential_scope = (SELECT credential_scope FROM tasks WHERE task_id = ?)
       AND target.status IN ('waiting_provider', 'retry_wait')
       AND (target.priority > (SELECT priority FROM tasks WHERE task_id = ?)
         OR (target.priority = (SELECT priority FROM tasks WHERE task_id = ?)
           AND (target.queue_entered_at < (SELECT queue_entered_at FROM tasks WHERE task_id = ?)
             OR (target.queue_entered_at = (SELECT queue_entered_at FROM tasks WHERE task_id = ?)
               AND target.task_id < ?))))`,
    [providerId, taskId, taskId, taskId, taskId, taskId, taskId]
  );
  return rows[0] ? Number(rows[0].position) : null;
}

export async function getEstimatedWaitSeconds(taskId: string, providerId: string): Promise<number | null> {
  const position = await getQueuePosition(taskId, providerId);
  if (position === null) return null;
  const rows = await query<Array<{ max_concurrency: number | string }>>(
    `SELECT c.max_concurrency
     FROM provider_runtime_config c
     INNER JOIN tasks t ON t.provider_id = c.provider_id AND t.credential_scope = c.credential_scope
     WHERE t.task_id = ? AND c.provider_id = ? LIMIT 1`,
    [taskId, providerId]
  );
  const concurrency = Math.max(1, Number(rows[0]?.max_concurrency ?? 1));
  const averageGenerationSeconds = Math.max(15, Number(process.env.PROVIDER_QUEUE_ESTIMATED_TASK_SECONDS ?? 45));
  return Math.max(0, Math.ceil((Math.max(0, position - 1) / concurrency) * averageGenerationSeconds));
}

export async function releaseProviderSlot(taskId: string): Promise<void> {
  await query(
    `UPDATE tasks SET provider_slot_released_at = COALESCE(provider_slot_released_at, NOW())
     WHERE task_id = ?`,
    [taskId]
  );
  wakeProviderDispatcher();
}
