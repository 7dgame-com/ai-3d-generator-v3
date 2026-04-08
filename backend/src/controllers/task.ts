import { Request, Response } from 'express';
import { pool, query } from '../db/connection';
import { decrypt } from '../services/crypto';
import { addTaskToPoller } from '../services/taskPoller';
import { AuthenticatedRequest } from '../middleware/auth';
import { creditManager, computeThrottleDelay, sleep, DeductResult } from '../services/creditManager';
import { providerRegistry } from '../adapters/ProviderRegistry';
import { isDownloadExpired } from '../utils/urlExpiry';

const ESTIMATED_CREDIT_COST: Record<string, number> = {
  tripo3d: 30,
  hyper3d: 1,
};
const DEFAULT_MAX_THROTTLE_DELAY_MS = 30000;

interface AccountSnapshot {
  wallet_balance: string;
  pool_balance: string;
  pool_baseline: string;
  next_cycle_at: Date | null;
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

async function getLockedAccountSnapshot(userId: number, providerId: string): Promise<AccountSnapshot | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<any[]>(
      `SELECT wallet_balance, pool_balance, pool_baseline, next_cycle_at
       FROM user_accounts
       WHERE user_id = ? AND provider_id = ?
       FOR UPDATE`,
      [userId, providerId]
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

  const providerId = rawProviderId ?? 'tripo3d';

  // Validate provider_id
  if (!providerRegistry.isEnabled(providerId)) {
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
    accountSnapshot = await getLockedAccountSnapshot(userId, providerId);
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
  const estimatedCost = ESTIMATED_CREDIT_COST[providerId] ?? 30;
  if (totalBalance < estimatedCost) {
    res.status(422).json({ code: 'INSUFFICIENT_CREDITS', message: '额度不足' });
    return;
  }

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  // Use a temp taskId for pre-deduction; will be updated after provider returns real task_id
  const tempTaskId = `temp:${userId}:${Date.now()}`;
  try {
    preDeductResult = await creditManager.preDeduct(userId, providerId, estimatedCost, tempTaskId);
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
          await creditManager.refund(userId, providerId, tempTaskId);
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
        await creditManager.refund(userId, providerId, tempTaskId);
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
        "UPDATE credit_ledger SET task_id = ? WHERE task_id = ? AND user_id = ? AND event_type = 'pre_deduct'",
        [providerTaskId, tempTaskId, userId]
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
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10)));
  const offset = (page - 1) * pageSize;
  try {
    const rows = await query<Array<Record<string, unknown>>>(
      'SELECT task_id, provider_id, type, prompt, status, progress, credit_cost, output_url, thumbnail_url, resource_id, error_message, created_at, completed_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [userId, pageSize, offset]
    );
    const countRows = await query<Array<{ total: number }>>('SELECT COUNT(*) AS total FROM tasks WHERE user_id = ?', [userId]);
    res.json({
      data: rows.map((row) => {
        const downloadExpired = row.status === 'success'
          ? isDownloadExpired(row.output_url as string | null, row.completed_at as string | null)
          : false;
        const thumbnailExpired = row.status === 'success' && row.thumbnail_url
          ? isDownloadExpired(row.thumbnail_url as string | null, row.completed_at as string | null)
          : false;
        return {
          taskId: row.task_id,
          providerId: row.provider_id,
          type: row.type,
          prompt: row.prompt,
          status: row.status,
          progress: row.progress,
          creditCost: row.credit_cost,
          outputUrl: row.output_url,
          thumbnailUrl: row.thumbnail_url ?? null,
          thumbnailExpired,
          resourceId: row.resource_id,
          errorMessage: row.error_message,
          createdAt: row.created_at,
          completedAt: row.completed_at,
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
    const rows = await query<Array<Record<string, unknown>>>(
      'SELECT task_id, provider_id, type, prompt, status, progress, credit_cost, output_url, thumbnail_url, resource_id, error_message, created_at, completed_at FROM tasks WHERE task_id = ? AND user_id = ? LIMIT 1',
      [taskId, userId]
    );
    if (!rows || rows.length === 0) { res.status(404).json({ code: 4004, message: '任务不存在' }); return; }
    const row = rows[0];
    const downloadExpired = row.status === 'success'
      ? isDownloadExpired(row.output_url as string | null, row.completed_at as string | null)
      : false;
    const thumbnailExpired = row.status === 'success' && row.thumbnail_url
      ? isDownloadExpired(row.thumbnail_url as string | null, row.completed_at as string | null)
      : false;
    res.json({
      taskId: row.task_id,
      providerId: row.provider_id,
      type: row.type,
      prompt: row.prompt,
      status: row.status,
      progress: row.progress,
      creditCost: row.credit_cost,
      outputUrl: row.output_url,
      thumbnailUrl: row.thumbnail_url ?? null,
      thumbnailExpired,
      downloadExpired,
      resourceId: row.resource_id,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      completedAt: row.completed_at,
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
