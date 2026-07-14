import { randomUUID } from 'node:crypto';
import { query } from '../db/connection';
import { creditToPower, getEstimatedCreditCost } from '../config/providers';
import { decrypt } from './crypto';
import { activeQuotaTool } from './quotaToolRegistry';
import { providerRegistry } from '../adapters/ProviderRegistry';
import { computeExpiresAt } from '../utils/urlExpiry';
import { releaseProviderSlot } from './providerQueue';
import { logQueueEvent } from './observability';

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const DIRECT_PROVIDER_STATUS_KEY_PREFIX = 'direct:';

const activePollers = new Set<string>();
let discoveryTimer: NodeJS.Timeout | null = null;

/** Tracks the last written progress per task for smooth interpolation */
const lastProgress = new Map<string, number>();

function schedulePoll(taskId: string, startTime: number, failureCount: number, delayMs: number): void {
  setTimeout(() => {
    void pollTask(taskId, startTime, failureCount).catch((error) => {
      console.error(`[TaskPoller] unhandled poll failure for ${taskId}:`, (error as Error)?.message ?? error);
    });
  }, delayMs);
}

/** Smoothly interpolate progress: advance toward target but don't jump */
export function smoothProgress(taskId: string, targetProgress: number): number {
  const current = lastProgress.get(taskId) ?? 0;
  if (targetProgress <= current) {
    // Target hasn't advanced (same job count), creep forward by 2% per poll
    const crept = Math.min(current + 2, targetProgress + 14, 95);
    lastProgress.set(taskId, crept);
    return crept;
  }
  // Target jumped (new job completed), advance halfway to close the gap smoothly
  const smoothed = Math.min(current + Math.ceil((targetProgress - current) / 2), 95);
  lastProgress.set(taskId, smoothed);
  return smoothed;
}

async function getApiKey(providerId: string): Promise<string> {
  const rows = await query<Array<{ value: string }>>(
    'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
    [`${providerId}_api_key`]
  );
  if (!rows || rows.length === 0) {
    throw new Error(`${providerId} API Key 未配置`);
  }
  return decrypt(rows[0].value);
}

interface TaskContext {
  user_id: number;
  provider_id: string;
  provider_status_key: string | null;
  provider_task_id: string | null;
  credential_scope: string;
  quota_epoch: number;
  provider_trace_id: string | null;
  status: string;
  poll_interval_seconds: number | null;
}

async function getTaskContext(taskId: string): Promise<TaskContext | null> {
  const rows = await query<TaskContext[]>(
    `SELECT t.user_id, t.provider_id, t.provider_task_id, t.provider_status_key, t.status,
            t.credential_scope, t.quota_epoch, t.provider_trace_id,
            COALESCE(c.poll_interval_seconds, 3) AS poll_interval_seconds
     FROM tasks t
     LEFT JOIN provider_runtime_config c
       ON c.provider_id = t.provider_id AND c.credential_scope = t.credential_scope
     WHERE t.task_id = ? LIMIT 1`,
    [taskId]
  );
  return rows?.[0] ?? null;
}

function getPollDelayMs(taskContext: TaskContext, packaging = false): number {
  const baseSeconds = Math.max(1, Number(taskContext.poll_interval_seconds ?? 3));
  return baseSeconds * 1000 * (packaging ? 3 : 1);
}

function normalizeProviderStatusKey(providerStatusKey: string | null, taskId: string): string {
  if (!providerStatusKey || providerStatusKey.length === 0) {
    return taskId;
  }

  if (providerStatusKey.startsWith(DIRECT_PROVIDER_STATUS_KEY_PREFIX)) {
    return providerStatusKey.slice(DIRECT_PROVIDER_STATUS_KEY_PREFIX.length) || taskId;
  }

  return providerStatusKey;
}

async function markTaskFailed(taskId: string, errorMessage: string): Promise<void> {
  lastProgress.delete(taskId);
  const taskContext = await getTaskContext(taskId);
  if (!taskContext) {
    return;
  }
  const result = await query<{ affectedRows: number }>(
    `UPDATE tasks
     SET status = 'failed', error_message = ?, completed_at = NOW(),
         provider_slot_released_at = COALESCE(provider_slot_released_at, NOW())
     WHERE task_id = ? AND status NOT IN ('success', 'failed', 'timeout', 'cancelled')`,
    [errorMessage, taskId]
  );
  if (Number(result.affectedRows ?? 0) === 0) {
    return;
  }

  try {
    await activeQuotaTool.refund(taskContext.user_id, taskContext.provider_id, taskId);
  } catch (error) {
    console.error(`[TaskPoller] refund failed for ${taskId}:`, (error as Error).message);
  }
}

async function markTaskTimeout(taskId: string): Promise<void> {
  lastProgress.delete(taskId);
  await query(
    `UPDATE tasks SET status = 'provider_state_unknown', error_message = '本地等待超时，正在核对供应商状态'
     WHERE task_id = ? AND status NOT IN ('success', 'failed', 'timeout', 'cancelled')`,
    [taskId]
  );
}

async function handleSuccess(
  taskId: string,
  userId: number,
  providerId: string,
  outputUrl: string,
  creditCost: number,
  thumbnailUrl?: string
): Promise<void> {
  lastProgress.delete(taskId);
  const powerCost = creditToPower(providerId, creditCost);
  const completedAt = new Date();

  // Try to get file size via HEAD request
  let fileSize: number | null = null;
  try {
    const headResp = await fetch(outputUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    const cl = headResp.headers.get('content-length');
    if (cl) fileSize = parseInt(cl, 10) || null;
  } catch {
    // Non-critical, skip
  }
  if (fileSize) {
    await query('UPDATE tasks SET file_size = ? WHERE task_id = ?', [fileSize, taskId]);
  }

  const result = await activeQuotaTool.finalizeTaskSuccess(
    userId,
    providerId,
    taskId,
    outputUrl,
    powerCost,
    creditCost,
    thumbnailUrl
  );
  if (result.billingStatus === 'undercharged') {
    console.warn(
      `[TaskPoller] task ${taskId} completed with undercharged billing: ${result.billingMessage ?? 'unknown'}`
    );
  }

  const expiresAt = computeExpiresAt(outputUrl, thumbnailUrl ?? null, completedAt);
  await query('UPDATE tasks SET expires_at = ? WHERE task_id = ?', [
    expiresAt.toISOString().slice(0, 19).replace('T', ' '),
    taskId,
  ]);
}

function retryTaskSuccessFinalization(
  taskId: string,
  userId: number,
  providerId: string,
  outputUrl: string,
  creditCost: number,
  thumbnailUrl?: string
): void {
  setTimeout(async () => {
    if (!activePollers.has(taskId)) {
      return;
    }
    try {
      await handleSuccess(taskId, userId, providerId, outputUrl, creditCost, thumbnailUrl);
      activePollers.delete(taskId);
    } catch (error) {
      console.error(
        `[TaskPoller] retry success finalization failed for ${taskId}:`,
        (error as Error).message
      );
      retryTaskSuccessFinalization(taskId, userId, providerId, outputUrl, creditCost, thumbnailUrl);
    }
  }, POLL_INTERVAL_MS);
}

async function pollTask(taskId: string, startTime: number, failureCount: number): Promise<void> {
  if (Date.now() - startTime > TIMEOUT_MS) {
    activePollers.delete(taskId);
    await markTaskTimeout(taskId);
    return;
  }

  const taskContext = await getTaskContext(taskId);
  if (!taskContext) {
    activePollers.delete(taskId);
    return;
  }

  if (['success', 'failed', 'timeout', 'cancelled'].includes(taskContext.status)) {
    lastProgress.delete(taskId);
    activePollers.delete(taskId);
    return;
  }

  const { provider_id: providerId, provider_status_key: providerStatusKey } = taskContext;
  const providerTaskId = taskContext.provider_task_id ?? taskId;
  if (!providerTaskId) {
    activePollers.delete(taskId);
    return;
  }
  const effectiveStatusKey = normalizeProviderStatusKey(providerStatusKey, providerTaskId);
  const adapter = providerRegistry.get(providerId);
  if (!adapter) {
    activePollers.delete(taskId);
    await markTaskFailed(taskId, `未启用的 Provider: ${providerId}`);
    return;
  }

  let apiKey: string;
  try {
    apiKey = await getApiKey(providerId);
  } catch (error) {
    const nextFailures = failureCount + 1;
    if (nextFailures >= MAX_CONSECUTIVE_FAILURES) {
      activePollers.delete(taskId);
      await markTaskFailed(taskId, '轮询失败');
      return;
    }
    schedulePoll(taskId, startTime, nextFailures, getPollDelayMs(taskContext));
    return;
  }

  try {
    const status = await adapter.getTaskStatus(apiKey, providerTaskId, effectiveStatusKey);

    if (status.providerTraceId || status.providerErrorCode) {
      await query(
        `UPDATE tasks
         SET provider_trace_id = COALESCE(?, provider_trace_id),
             provider_error_code = COALESCE(?, provider_error_code)
         WHERE task_id = ?`,
        [status.providerTraceId ?? null, status.providerErrorCode ?? null, taskId]
      );
    }

    logQueueEvent({
      event: 'provider_status_observed', localTaskId: taskId, providerTaskId, providerId,
      credentialScope: taskContext.credential_scope, quotaEpoch: Number(taskContext.quota_epoch ?? 1),
      taskStatus: status.status, providerCategory: status.providerErrorCode ? 'PROVIDER_RESPONSE' : null,
      providerCode: status.providerErrorCode ?? null, internalTraceId: randomUUID(),
      providerTraceId: status.providerTraceId ?? taskContext.provider_trace_id,
    });

    if (status.providerWorkFinished) {
      await releaseProviderSlot(taskId);
    }

    if (status.status === 'success') {
      if (!status.outputUrl || status.outputUrl.trim().length === 0) {
        await query('UPDATE tasks SET progress = ? WHERE task_id = ?', [status.progress ?? 99, taskId]);
        schedulePoll(taskId, startTime, 0, getPollDelayMs(taskContext));
        return;
      }
      const actualCost = status.creditCost ?? getEstimatedCreditCost(providerId);
      try {
        await handleSuccess(
          taskId,
          taskContext.user_id,
          providerId,
          status.outputUrl,
          actualCost,
          status.thumbnailUrl
        );
        await releaseProviderSlot(taskId);
        activePollers.delete(taskId);
        return;
      } catch (error) {
        console.error(`[TaskPoller] success finalization failed for ${taskId}:`, (error as Error).message);
        retryTaskSuccessFinalization(
          taskId,
          taskContext.user_id,
          providerId,
          status.outputUrl,
          actualCost,
          status.thumbnailUrl
        );
        return;
      }
    }

    if (status.status === 'failed') {
      activePollers.delete(taskId);
      await markTaskFailed(taskId, status.errorMessage ?? '任务生成失败');
      await releaseProviderSlot(taskId);
      return;
    }

    await query('UPDATE tasks SET progress = ? WHERE task_id = ?', [smoothProgress(taskId, status.progress ?? 0), taskId]);
    if (status.status === 'processing') {
      await query("UPDATE tasks SET status = 'processing' WHERE task_id = ? AND status = 'queued'", [taskId]);
    } else if (status.status === 'packaging') {
      await query("UPDATE tasks SET status = 'packaging' WHERE task_id = ? AND status IN ('queued', 'processing', 'packaging')", [taskId]);
    }

    schedulePoll(taskId, startTime, 0, getPollDelayMs(taskContext, status.status === 'packaging'));
  } catch (error) {
    const nextFailures = failureCount + 1;
    if (nextFailures >= MAX_CONSECUTIVE_FAILURES) {
      activePollers.delete(taskId);
      await query(
        "UPDATE tasks SET status = 'provider_state_unknown', error_message = '供应商状态暂时无法确认' WHERE task_id = ?",
        [taskId]
      );
      return;
    }
    schedulePoll(taskId, startTime, nextFailures, getPollDelayMs(taskContext));
  }
}

function addTaskToPollerInternal(taskId: string): void {
  if (activePollers.has(taskId)) {
    return;
  }
  activePollers.add(taskId);
  schedulePoll(taskId, Date.now(), 0, POLL_INTERVAL_MS);
}

export function addTaskToPoller(taskId: string): void {
  addTaskToPollerInternal(taskId);
}

export async function startPoller(): Promise<void> {
  const discover = async (): Promise<void> => {
    try {
    const pendingTasks = await query<Array<{ task_id: string }>>(
      "SELECT task_id FROM tasks WHERE provider_task_id IS NOT NULL AND status IN ('queued', 'processing', 'packaging', 'provider_state_unknown')"
    );

    for (const { task_id } of pendingTasks ?? []) {
      addTaskToPollerInternal(task_id);
    }
    } catch (error) {
      console.error('[TaskPoller] discovery failed:', (error as Error).message);
    }
  };
  await discover();
  if (!discoveryTimer) {
    discoveryTimer = setInterval(() => void discover(), POLL_INTERVAL_MS);
  }
}

export function stopPoller(): void {
  if (discoveryTimer) clearInterval(discoveryTimer);
  discoveryTimer = null;
}

export function getStateCoordinatorHealth(): { running: boolean; activePollers: number } {
  return { running: discoveryTimer !== null, activePollers: activePollers.size };
}
