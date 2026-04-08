import { query } from '../db/connection';
import { decrypt } from './crypto';
import { creditManager } from './creditManager';
import { providerRegistry } from '../adapters/ProviderRegistry';

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;

/** Fallback credit cost per provider when the API doesn't return one */
const PROVIDER_DEFAULT_COST: Record<string, number> = {
  tripo3d: 30,
  hyper3d: 0.5,
};

const activePollers = new Set<string>();

/** Tracks the last written progress per task for smooth interpolation */
const lastProgress = new Map<string, number>();

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
}

async function getTaskContext(taskId: string): Promise<TaskContext | null> {
  const rows = await query<TaskContext[]>(
    'SELECT user_id, provider_id, provider_status_key FROM tasks WHERE task_id = ? LIMIT 1',
    [taskId]
  );
  return rows?.[0] ?? null;
}

async function markTaskFailed(taskId: string, errorMessage: string): Promise<void> {
  lastProgress.delete(taskId);
  await query(
    "UPDATE tasks SET status = 'failed', error_message = ?, completed_at = NOW() WHERE task_id = ?",
    [errorMessage, taskId]
  );

  const taskContext = await getTaskContext(taskId);
  if (!taskContext) {
    return;
  }

  try {
    await creditManager.refund(taskContext.user_id, taskContext.provider_id, taskId);
  } catch (error) {
    console.error(`[TaskPoller] refund failed for ${taskId}:`, (error as Error).message);
  }
}

async function markTaskTimeout(taskId: string): Promise<void> {
  lastProgress.delete(taskId);
  await query(
    "UPDATE tasks SET status = 'timeout', error_message = '生成超时', completed_at = NOW() WHERE task_id = ?",
    [taskId]
  );

  const taskContext = await getTaskContext(taskId);
  if (!taskContext) {
    return;
  }

  try {
    await creditManager.refund(taskContext.user_id, taskContext.provider_id, taskId);
  } catch (error) {
    console.error(`[TaskPoller] timeout refund failed for ${taskId}:`, (error as Error).message);
  }
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
  const result = await creditManager.finalizeTaskSuccess(
    userId,
    providerId,
    taskId,
    outputUrl,
    creditCost,
    thumbnailUrl
  );
  if (result.billingStatus === 'undercharged') {
    console.warn(
      `[TaskPoller] task ${taskId} completed with undercharged billing: ${result.billingMessage ?? 'unknown'}`
    );
  }
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

  const { user_id: userId, provider_id: providerId, provider_status_key: providerStatusKey } = taskContext;
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
    setTimeout(() => pollTask(taskId, startTime, nextFailures), POLL_INTERVAL_MS);
    return;
  }

  try {
    const status = await adapter.getTaskStatus(apiKey, taskId, providerStatusKey ?? undefined);

    if (status.status === 'success') {
      if (!status.outputUrl || status.outputUrl.trim().length === 0) {
        await query('UPDATE tasks SET progress = ? WHERE task_id = ?', [status.progress ?? 99, taskId]);
        setTimeout(() => pollTask(taskId, startTime, 0), POLL_INTERVAL_MS);
        return;
      }
      const actualCost = status.creditCost ?? PROVIDER_DEFAULT_COST[providerId] ?? 0;
      try {
        await handleSuccess(
          taskId,
          userId,
          providerId,
          status.outputUrl,
          actualCost,
          status.thumbnailUrl
        );
        activePollers.delete(taskId);
        return;
      } catch (error) {
        console.error(`[TaskPoller] success finalization failed for ${taskId}:`, (error as Error).message);
        retryTaskSuccessFinalization(
          taskId,
          userId,
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
      return;
    }

    await query('UPDATE tasks SET progress = ? WHERE task_id = ?', [smoothProgress(taskId, status.progress ?? 0), taskId]);
    if (status.status === 'processing') {
      await query("UPDATE tasks SET status = 'processing' WHERE task_id = ? AND status = 'queued'", [taskId]);
    }

    setTimeout(() => pollTask(taskId, startTime, 0), POLL_INTERVAL_MS);
  } catch (error) {
    const nextFailures = failureCount + 1;
    if (nextFailures >= MAX_CONSECUTIVE_FAILURES) {
      activePollers.delete(taskId);
      await markTaskFailed(taskId, '轮询失败');
      return;
    }
    setTimeout(() => pollTask(taskId, startTime, nextFailures), POLL_INTERVAL_MS);
  }
}

export function addTaskToPoller(taskId: string): void {
  if (activePollers.has(taskId)) {
    return;
  }
  activePollers.add(taskId);
  setTimeout(() => pollTask(taskId, Date.now(), 0), POLL_INTERVAL_MS);
}

export async function startPoller(): Promise<void> {
  try {
    const pendingTasks = await query<Array<{ task_id: string }>>(
      "SELECT task_id FROM tasks WHERE status IN ('queued', 'processing')"
    );
    for (const { task_id } of pendingTasks ?? []) {
      addTaskToPoller(task_id);
    }
  } catch (error) {
    console.error('[TaskPoller] failed to start:', (error as Error).message);
  }
}
