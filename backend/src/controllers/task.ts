import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { query } from '../db/connection';
import { creditToPower, getEstimatedCreditCost } from '../config/providers';
import { AuthenticatedRequest } from '../middleware/auth';
import { activeQuotaTool } from '../services/quotaToolRegistry';
import { buildQuotaUserSnapshot } from '../services/quotaUserSnapshot';
import { providerRegistry } from '../adapters/ProviderRegistry';
import { getEstimatedWaitSeconds, getQueuePosition, wakeProviderDispatcher } from '../services/providerQueue';
import { isQueueDispatchEnabled, isUnifiedQueueEnabledForUser } from '../services/queueRollout';
import { computeExpiresAt, isDownloadExpired } from '../utils/urlExpiry';
import { normalizeTaskBilling } from '../utils/taskBilling';
const DIRECT_PROVIDER_STATUS_KEY_PREFIX = 'direct:';
const LIST_VISIBLE_TASKS_PREDICATE = `
status != 'success'
OR expires_at > NOW()
OR (
  expires_at IS NULL
  AND (
    completed_at IS NULL
    OR completed_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  )
)`;

interface MissingExpiresAtRow {
  task_id: string;
  output_url: string | null;
  thumbnail_url: string | null;
  completed_at: string | Date | null;
}

function normalizePaginationInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function serializeOptionalDate(value: unknown): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toMysqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function safeStudentErrorMessage(category: unknown, fallback: unknown): string | null {
  const safeMessages: Record<string, string> = {
    THROTTLED: '供应商繁忙，平台将自动重试',
    TEMPORARY: '供应商暂时不可用，平台将自动重试',
    SUBMISSION_UNKNOWN: '正在核对供应商任务状态，请勿重复提交',
    NO_BALANCE: '供应商账号暂不可用，管理员处理后将继续',
    NO_ACCESS: '供应商账号暂不可用，管理员处理后将继续',
    INVALID_INPUT: '任务参数无法被供应商处理，请修改后重试',
    CONTENT_REJECTED: '任务内容未通过供应商检查，请修改后重试',
    PROVIDER_FAILED: '生成失败，请稍后重试',
  };
  if (typeof category === 'string' && safeMessages[category]) {
    return safeMessages[category];
  }
  return typeof fallback === 'string' ? fallback.slice(0, 256) : null;
}

function buildEnabledProviderFilter(): { clause: string; params: string[] } | null {
  const providerIds = providerRegistry.getEnabledIds();
  if (providerIds.length === 0) {
    return null;
  }

  return {
    clause: `provider_id IN (${providerIds.map(() => '?').join(', ')})`,
    params: providerIds,
  };
}

async function backfillMissingExpiresAtForUser(userId: number): Promise<void> {
  const rows = await query<MissingExpiresAtRow[]>(
    `SELECT task_id, output_url, thumbnail_url, completed_at
     FROM tasks
     WHERE user_id = ?
       AND status = 'success'
       AND expires_at IS NULL
       AND completed_at IS NOT NULL`,
    [userId]
  );

  for (const row of rows) {
    const completedAt = row.completed_at instanceof Date ? row.completed_at : new Date(String(row.completed_at));
    if (Number.isNaN(completedAt.getTime())) {
      continue;
    }

    const expiresAt = computeExpiresAt(row.output_url ?? null, row.thumbnail_url ?? null, completedAt);
    await query(
      'UPDATE tasks SET expires_at = ? WHERE task_id = ? AND user_id = ? AND expires_at IS NULL',
      [toMysqlDateTime(expiresAt), row.task_id, userId]
    );
  }
}

export async function createTask(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const { type, prompt, imageBase64, mimeType, provider_id: rawProviderId } = req.body as {
    type?: string; prompt?: string; imageBase64?: string; mimeType?: string; provider_id?: string;
  };

  const providerId = rawProviderId ?? providerRegistry.getDefaultId();

  if (!isUnifiedQueueEnabledForUser(userId)) {
    res.status(409).json({
      code: 'UNIFIED_QUEUE_NOT_ENABLED_FOR_USER',
      message: '当前账号尚未开启统一队列，请使用当前发布版本的创建入口',
    });
    return;
  }
  if (!isQueueDispatchEnabled()) {
    res.status(503).json({
      code: 'UNIFIED_QUEUE_DISPATCH_PAUSED',
      message: '统一队列正在维护，暂不接收新任务',
    });
    return;
  }

  // Validate provider_id
  if (!providerId || !providerRegistry.isEnabled(providerId)) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }

  if (!type || !['text_to_model', 'image_to_model'].includes(type)) {
    res.status(422).json({ code: 4001, message: '参数错误', errors: ['type 无效'] });
    return;
  }
  if (type === 'text_to_model') {
    if (!prompt || typeof prompt !== 'string' || prompt.length < 1 || prompt.length > 500) {
      res.status(422).json({ code: 4001, message: '参数错误', errors: ['prompt 长度须在 1-500 字符之间'] });
      return;
    }
  }
  if (type === 'image_to_model' && (!imageBase64 || !mimeType)) {
    res.status(422).json({ code: 4001, message: '参数错误', errors: ['imageBase64 和 mimeType 不能为空'] });
    return;
  }

  const outstandingLimit = Math.max(1, Number(process.env.USER_PROVIDER_OUTSTANDING_LIMIT ?? 1));
  const estimatedCreditCost = getEstimatedCreditCost(providerId);
  const estimatedPower = creditToPower(providerId, estimatedCreditCost);
  const localTaskId = randomUUID();
  try {
    const reserveResult = await activeQuotaTool.enqueueWithReservation({
      taskId: localTaskId,
      userId,
      providerId,
      type: type as 'text_to_model' | 'image_to_model',
      prompt: prompt ?? null,
      requestPayload: JSON.stringify({ type, prompt, imageBase64, mimeType }),
      reservedPower: estimatedPower,
      outstandingLimit,
      userSnapshot: buildQuotaUserSnapshot((req as AuthenticatedRequest).user),
    });
    if (!reserveResult.success) {
      if (reserveResult.errorCode === 'INSUFFICIENT_CREDITS') {
        res.status(422).json({ code: 'INSUFFICIENT_CREDITS', message: '额度不足' });
      } else if (reserveResult.errorCode === 'CONCURRENT_CONFLICT') {
        res.status(409).json({ code: 'OUTSTANDING_TASK_LIMIT', message: '已有任务正在排队或生成，请勿重复提交' });
      } else {
        res.status(422).json({ code: 'INSUFFICIENT_CREDITS', message: '额度不足' });
      }
      return;
    }
  } catch (err) {
    console.error('[TaskController] 原子入队失败:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
    return;
  }

  const queuePosition = await getQueuePosition(localTaskId, providerId).catch(() => null);
  wakeProviderDispatcher();
  res.status(202).json({
    taskId: localTaskId,
    status: 'waiting_provider',
    providerId,
    queuePosition,
  });
}

export async function listTasks(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const page = Math.max(1, normalizePaginationInt(req.query.page, 1));
  const pageSize = Math.min(50, Math.max(1, normalizePaginationInt(req.query.pageSize, 20)));
  const offset = (page - 1) * pageSize;
  try {
    await backfillMissingExpiresAtForUser(userId);
    const providerFilter = buildEnabledProviderFilter();

    if (!providerFilter) {
      res.json({ data: [], total: 0, page, pageSize });
      return;
    }

    const rows = await query<Array<Record<string, unknown>>>(
      `SELECT task_id, provider_id, provider_status_key, type, prompt, status, progress, credit_cost, power_cost, file_size, output_url, thumbnail_url, resource_id, error_message, provider_error_category, queue_entered_at, next_attempt_at, created_at, completed_at, expires_at
       FROM tasks
       WHERE user_id = ?
         AND ${providerFilter.clause}
         AND (${LIST_VISIBLE_TASKS_PREDICATE})
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, ...providerFilter.params, pageSize, offset]
    );
    const countRows = await query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total
       FROM tasks
       WHERE user_id = ?
         AND ${providerFilter.clause}
         AND (${LIST_VISIBLE_TASKS_PREDICATE})`,
      [userId, ...providerFilter.params]
    );
    const data = await Promise.all(rows.map(async (row) => {
        const downloadExpired = row.status === 'success'
          ? isDownloadExpired(row.output_url as string | null, row.completed_at as string | null)
          : false;
        const thumbnailExpired = row.status === 'success' && row.thumbnail_url
          ? isDownloadExpired(row.thumbnail_url as string | null, row.completed_at as string | null)
          : false;
        const billing = normalizeTaskBilling({
          providerId: String(row.provider_id),
          creditCost: row.credit_cost,
          powerCost: row.power_cost,
          status: String(row.status),
        });
        const waiting = row.status === 'waiting_provider' || row.status === 'retry_wait';
        return {
          taskId: row.task_id,
          providerId: row.provider_id,
          type: row.type,
          prompt: row.prompt,
          status: row.status,
          progress: row.progress,
          creditCost: billing.creditCost,
          powerCost: billing.powerCost,
          fileSize: row.file_size ? Number(row.file_size) : null,
          outputUrl: row.output_url,
          thumbnailUrl: row.thumbnail_url ?? null,
          thumbnailExpired,
          directModeTask: typeof row.provider_status_key === 'string' && row.provider_status_key.startsWith(DIRECT_PROVIDER_STATUS_KEY_PREFIX),
          resourceId: row.resource_id,
          errorMessage: safeStudentErrorMessage(row.provider_error_category, row.error_message),
          errorCategory: row.provider_error_category ?? null,
          queuePosition: waiting
            ? await getQueuePosition(String(row.task_id), String(row.provider_id)).catch(() => null)
            : null,
          estimatedWaitSeconds: waiting
            ? await getEstimatedWaitSeconds(String(row.task_id), String(row.provider_id)).catch(() => null)
            : null,
          nextAttemptAt: serializeOptionalDate(row.next_attempt_at),
          canCancel: waiting,
          queueEnteredAt: serializeOptionalDate(row.queue_entered_at),
          createdAt: row.created_at,
          completedAt: row.completed_at,
          expiresAt: serializeOptionalDate(row.expires_at),
          downloadExpired,
        };
      }));
    res.json({
      data,
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    });
  } catch (err) {
    console.error('[TaskController] listTasks error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function getTask(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const { taskId } = req.params;
  try {
    const providerFilter = buildEnabledProviderFilter();
    if (!providerFilter) {
      res.status(404).json({ code: 4004, message: '任务不存在' });
      return;
    }

    const rows = await query<Array<Record<string, unknown>>>(
      `SELECT task_id, provider_id, provider_status_key, type, prompt, status, progress, credit_cost, power_cost, file_size, output_url, thumbnail_url, resource_id, error_message, provider_error_category, queue_entered_at, next_attempt_at, created_at, completed_at, expires_at
       FROM tasks
       WHERE task_id = ?
         AND user_id = ?
         AND ${providerFilter.clause}
       LIMIT 1`,
      [taskId, userId, ...providerFilter.params]
    );
    if (!rows || rows.length === 0) { res.status(404).json({ code: 4004, message: '任务不存在' }); return; }
    const row = rows[0];
    const downloadExpired = row.status === 'success'
      ? isDownloadExpired(row.output_url as string | null, row.completed_at as string | null)
      : false;
    const thumbnailExpired = row.status === 'success' && row.thumbnail_url
      ? isDownloadExpired(row.thumbnail_url as string | null, row.completed_at as string | null)
      : false;
    const billing = normalizeTaskBilling({
      providerId: String(row.provider_id),
      creditCost: row.credit_cost,
      powerCost: row.power_cost,
      status: String(row.status),
    });
    const waiting = row.status === 'waiting_provider' || row.status === 'retry_wait';
    res.json({
      taskId: row.task_id,
      providerId: row.provider_id,
      type: row.type,
      prompt: row.prompt,
      status: row.status,
      progress: row.progress,
      creditCost: billing.creditCost,
      powerCost: billing.powerCost,
      fileSize: row.file_size ? Number(row.file_size) : null,
      outputUrl: row.output_url,
      thumbnailUrl: row.thumbnail_url ?? null,
      thumbnailExpired,
      directModeTask: typeof row.provider_status_key === 'string' && row.provider_status_key.startsWith(DIRECT_PROVIDER_STATUS_KEY_PREFIX),
      downloadExpired,
      resourceId: row.resource_id,
      errorMessage: safeStudentErrorMessage(row.provider_error_category, row.error_message),
      errorCategory: row.provider_error_category ?? null,
      queuePosition: waiting
        ? await getQueuePosition(String(row.task_id), String(row.provider_id)).catch(() => null)
        : null,
      estimatedWaitSeconds: waiting
        ? await getEstimatedWaitSeconds(String(row.task_id), String(row.provider_id)).catch(() => null)
        : null,
      nextAttemptAt: serializeOptionalDate(row.next_attempt_at),
      canCancel: waiting,
      queueEnteredAt: serializeOptionalDate(row.queue_entered_at),
      createdAt: row.created_at,
      completedAt: row.completed_at,
      expiresAt: serializeOptionalDate(row.expires_at),
    });
  } catch (err) {
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function cancelTask(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const taskId = String(req.params.taskId);
  try {
    const rows = await query<Array<{ provider_id: string; status: string }>>(
      'SELECT provider_id, status FROM tasks WHERE task_id = ? AND user_id = ? LIMIT 1',
      [taskId, userId]
    );
    const task = rows[0];
    if (!task) {
      res.status(404).json({ code: 4004, message: '任务不存在' });
      return;
    }
    if (task.status === 'cancelled') {
      res.json({ success: true, taskId, status: 'cancelled', alreadyCancelled: true });
      return;
    }
    if (!['waiting_provider', 'retry_wait'].includes(task.status)) {
      res.status(409).json({ code: 'TASK_NOT_CANCELLABLE', message: '任务已提交供应商，当前无法安全取消' });
      return;
    }
    const result = await query<{ affectedRows: number }>(
      `UPDATE tasks
       SET status = 'cancelled', completed_at = NOW(), cancellation_reason = 'cancelled_by_user',
           provider_slot_released_at = COALESCE(provider_slot_released_at, NOW()),
           lease_owner = NULL, lease_expires_at = NULL
       WHERE task_id = ? AND user_id = ? AND status IN ('waiting_provider', 'retry_wait')`,
      [taskId, userId]
    );
    if (Number(result.affectedRows ?? 0) === 0) {
      res.status(409).json({ code: 'TASK_STATE_CHANGED', message: '任务状态已变化，请刷新后重试' });
      return;
    }
    await activeQuotaTool.refund(userId, task.provider_id, taskId);
    await query(
      `INSERT INTO provider_task_events (task_id, provider_id, event_type, from_status, to_status)
       VALUES (?, ?, 'task_cancelled', ?, 'cancelled')`,
      [taskId, task.provider_id, task.status]
    );
    wakeProviderDispatcher();
    res.json({ success: true, taskId, status: 'cancelled' });
  } catch (err) {
    console.error('[TaskController] cancelTask error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function getDownloadUrl(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const { taskId } = req.params;
  try {
    const rows = await query<Array<{ output_url: string | null }>>(
      'SELECT output_url FROM tasks WHERE task_id = ? AND user_id = ? LIMIT 1',
      [taskId, userId]
    );
    if (!rows || rows.length === 0) { res.status(404).json({ code: 4004, message: '任务不存在' }); return; }
    const outputUrl = rows[0].output_url;
    if (!outputUrl) { res.status(422).json({ code: 4001, message: '任务尚未完成或无输出文件' }); return; }
    res.json({ url: outputUrl });
  } catch (err) {
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function updateTaskResource(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const { taskId } = req.params;
  const { resource_id } = req.body as { resource_id?: number };
  if (!resource_id || typeof resource_id !== 'number') {
    res.status(422).json({ code: 4001, message: '参数错误', errors: ['resource_id 不能为空'] });
    return;
  }
  try {
    const result = await query<{ affectedRows: number }>(
      'UPDATE tasks SET resource_id = ? WHERE task_id = ? AND user_id = ?',
      [resource_id, taskId, userId]
    );
    if (result.affectedRows === 0) { res.status(404).json({ code: 4004, message: '任务不存在' }); return; }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}
