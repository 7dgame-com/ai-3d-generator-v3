import { Request, Response } from 'express';
import { pool, query } from '../db/connection';
import { creditToPower, getEstimatedCreditCost } from '../config/providers';
import { decrypt } from '../services/crypto';
import { addTaskToPoller } from '../services/taskPoller';
import { AuthenticatedRequest } from '../middleware/auth';
import { computeThrottleDelay, sleep } from '../services/creditManager';
import { type DeductResult } from '../services/powerManager';
import { sitePowerManager } from '../services/sitePowerManager';
import { providerRegistry } from '../adapters/ProviderRegistry';
import { computeExpiresAt, isDownloadExpired } from '../utils/urlExpiry';
import { normalizeTaskBilling } from '../utils/taskBilling';
const DEFAULT_MAX_THROTTLE_DELAY_MS = 30000;
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

interface AccountSnapshot {
  wallet_balance: string;
  pool_balance: string;
  pool_baseline: string;
  next_cycle_at: Date | null;
}

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

async function getApiKey(providerId: string): Promise<string> {
  const configKey = `${providerId}_api_key`;
  const rows = await query<Array<{ value: string }>>(
    'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
    [configKey]
  );
  if (!rows || rows.length === 0) {
    throw Object.assign(new Error('API Key 未配置'), { code: 'PROVIDER_NOT_CONFIGURED', status: 503 });
  }
  return decrypt(rows[0].value);
}

async function getMaxThrottleDelayMs(): Promise<number> {
  const rows = await query<Array<{ value: string }>>(
    'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
    ['max_delay_ms']
  );
  const parsed = Number(rows?.[0]?.value ?? DEFAULT_MAX_THROTTLE_DELAY_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_THROTTLE_DELAY_MS;
}

async function getLockedSiteAccountSnapshot(): Promise<AccountSnapshot | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<any[]>(
      `SELECT wallet_balance, pool_balance, pool_baseline, next_cycle_at
       FROM site_power_accounts
       WHERE id = 1
       FOR UPDATE`,
      []
    );
    await conn.commit();
    return rows?.[0] ?? null;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function createTask(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const { type, prompt, imageBase64, mimeType, provider_id: rawProviderId } = req.body as {
    type?: string; prompt?: string; imageBase64?: string; mimeType?: string; provider_id?: string;
  };

  const providerId = rawProviderId ?? providerRegistry.getDefaultId();

  // Validate provider_id
  if (!providerId || !providerRegistry.isEnabled(providerId)) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }

  const adapter = providerRegistry.get(providerId)!;

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

  let apiKey: string;
  try {
    apiKey = await getApiKey(providerId);
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string };
    res.status(e.status ?? 503).json({ code: e.code ?? 'PROVIDER_NOT_CONFIGURED', message: e.message ?? 'API Key 未配置' });
    return;
  }

  // Step 1: Lock account snapshot and evaluate throttle/available balance
  let accountSnapshot: AccountSnapshot | null;
  try {
    accountSnapshot = await getLockedSiteAccountSnapshot();
  } catch (err) {
    console.error('[TaskController] 读取额度账户失败:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
    return;
  }

  if (!accountSnapshot) {
    res.status(422).json({ code: 'INSUFFICIENT_CREDITS', message: '额度不足' });
    return;
  }

  const poolCurrent = Number(accountSnapshot.pool_balance);
  const poolBaseline = Number(accountSnapshot.pool_baseline);
  const totalBalance = Number(accountSnapshot.wallet_balance) + poolCurrent;
  const maxThrottleDelayMs = await getMaxThrottleDelayMs();
  const delayMs = computeThrottleDelay(poolCurrent, poolBaseline, maxThrottleDelayMs);

  if (delayMs === -1) {
    const nextCycleAt = accountSnapshot.next_cycle_at;
    const suggestedWaitSeconds = nextCycleAt
      ? Math.max(0, Math.floor((nextCycleAt.getTime() - Date.now()) / 1000))
      : 3600;
    res.status(429).json({
      code: 'POOL_EXHAUSTED',
      message: '池塘额度已耗尽',
      data: { provider_id: providerId, poolCurrent, poolBaseline, nextCycleAt, suggestedWaitSeconds },
    });
    return;
  }

  // Step 2: Pre-deduct credits BEFORE calling provider API
  let preDeductResult: DeductResult | null = null;
  const estimatedCreditCost = getEstimatedCreditCost(providerId);
  const estimatedPower = creditToPower(providerId, estimatedCreditCost);
  if (totalBalance < estimatedPower) {
    res.status(422).json({ code: 'INSUFFICIENT_CREDITS', message: '额度不足' });
    return;
  }

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  // Use a temp taskId for pre-deduction; will be updated after provider returns real task_id
  const tempTaskId = `temp:${userId}:${Date.now()}`;
  try {
    preDeductResult = await sitePowerManager.preDeduct(providerId, estimatedPower, tempTaskId);
    if (!preDeductResult.success) {
      if (preDeductResult.errorCode === 'INSUFFICIENT_CREDITS') {
        res.status(422).json({ code: 'INSUFFICIENT_CREDITS', message: '额度不足' });
      } else if (preDeductResult.errorCode === 'CONCURRENT_CONFLICT') {
        res.status(409).json({ code: 'CONCURRENT_CONFLICT', message: '并发冲突，请重试' });
      } else {
        res.status(422).json({ code: 'INSUFFICIENT_CREDITS', message: '额度不足' });
      }
      return;
    }
  } catch (err) {
    console.error('[TaskController] 预扣额度失败:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
    return;
  }

  let providerTaskId: string;
  try {
    const result = await adapter.createTask(apiKey, { type: type as 'text_to_model' | 'image_to_model', prompt, imageBase64, mimeType });
    providerTaskId = result.taskId;
    const providerStatusKey = result.pollingKey ?? providerTaskId;

    try {
      await query(
        "INSERT INTO tasks (task_id, provider_status_key, user_id, provider_id, type, prompt, status, progress) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0)",
        [providerTaskId, providerStatusKey, userId, providerId, type, prompt ?? null]
      );
    } catch (err) {
      console.error('[TaskController] DB insert error:', err);
      if (preDeductResult?.success) {
        try {
          await sitePowerManager.refund(providerId, tempTaskId);
        } catch (refundErr) {
          console.error('[TaskController] DB insert 失败后的退款失败:', (refundErr as Error).message);
        }
      }
      res.status(500).json({ code: 5001, message: '服务器内部错误' });
      return;
    }
  } catch (err) {
    // Provider call failed — refund the pre-deduction if it was made
    if (preDeductResult?.success) {
      try {
        await sitePowerManager.refund(providerId, tempTaskId);
      } catch (refundErr) {
        console.error('[TaskController] 退款失败 (tempTaskId):', (refundErr as Error).message);
      }
    }
    const e = err as { message?: string };
    res.status(502).json({ code: 'PROVIDER_UNAVAILABLE', message: 'AI 服务暂时不可用', detail: e.message ?? String(err) });
    return;
  }

  // Update the ledger record's task_id from tempTaskId to the real provider task_id
  if (preDeductResult?.success) {
    try {
      await query(
        "UPDATE site_power_ledger SET task_id = ? WHERE task_id = ? AND provider_id = ? AND event_type = 'pre_deduct'",
        [providerTaskId, tempTaskId, providerId]
      );
    } catch (err) {
      console.error('[TaskController] 更新 ledger task_id 失败:', (err as Error).message);
    }
  }

  addTaskToPoller(providerTaskId);
  res.status(201).json({ taskId: providerTaskId, status: 'queued' });
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
      `SELECT task_id, provider_id, provider_status_key, type, prompt, status, progress, credit_cost, power_cost, file_size, output_url, thumbnail_url, resource_id, error_message, created_at, completed_at, expires_at
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
    res.json({
      data: rows.map((row) => {
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
          errorMessage: row.error_message,
          createdAt: row.created_at,
          completedAt: row.completed_at,
          expiresAt: serializeOptionalDate(row.expires_at),
          downloadExpired,
        };
      }),
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
      `SELECT task_id, provider_id, provider_status_key, type, prompt, status, progress, credit_cost, power_cost, file_size, output_url, thumbnail_url, resource_id, error_message, created_at, completed_at, expires_at
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
      errorMessage: row.error_message,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      expiresAt: serializeOptionalDate(row.expires_at),
    });
  } catch (err) {
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
