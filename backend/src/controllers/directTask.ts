import { Request, Response } from 'express';
import { pool, query } from '../db/connection';
import { creditToPower, getEstimatedCreditCost } from '../config/providers';
import { decrypt } from '../services/crypto';
import { AuthenticatedRequest } from '../middleware/auth';
import { computeThrottleDelay, sleep } from '../services/creditManager';
import { type DeductResult } from '../services/powerManager';
import { sitePowerManager } from '../services/sitePowerManager';
import { providerRegistry } from '../adapters/ProviderRegistry';
import { addTaskToPoller } from '../services/taskPoller';
import {
  signPrepareToken,
  verifyPrepareToken,
  type VerifiedPrepareTokenPayload,
} from '../services/prepareToken';
import { computeExpiresAt } from '../utils/urlExpiry';
import { getProviderDefaultCreditCost } from '../utils/taskBilling';

const DEFAULT_MAX_THROTTLE_DELAY_MS = 30000;
const TRIPO_API_PROXY_BASE = '/tripo';
const HYPER3D_API_PROXY_BASE = '/hyper';
const TRIPO_MODEL_VERSION = process.env.TRIPO_MODEL_VERSION || 'P1-20260311';
const DIRECT_PROVIDER_STATUS_KEY_PREFIX = 'direct:';

interface AccountSnapshot {
  wallet_balance: string;
  pool_balance: string;
  pool_baseline: string;
  next_cycle_at: Date | null;
}

interface TaskOwnershipRow {
  task_id: string;
  user_id: number;
  provider_id: string;
  provider_status_key: string | null;
  status: string;
  error_message: string | null;
}

export function isTaskOwner(ownerUserId: number, actorUserId: number): boolean {
  return ownerUserId === actorUserId;
}

function getTaskIdParam(req: Request): string | null {
  const { taskId } = req.params;
  return typeof taskId === 'string' && taskId.length > 0 ? taskId : null;
}

function getProviderApiConfig(providerId: string): { apiBaseUrl: string; modelVersion?: string } {
  if (providerId === 'hyper3d') {
    return { apiBaseUrl: HYPER3D_API_PROXY_BASE };
  }

  return {
    apiBaseUrl: TRIPO_API_PROXY_BASE,
    modelVersion: TRIPO_MODEL_VERSION,
  };
}

async function getApiKey(providerId: string): Promise<string> {
  const rows = await query<Array<{ value: string }>>(
    'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
    [`${providerId}_api_key`]
  );

  if (!rows || rows.length === 0) {
    throw Object.assign(new Error('API Key 未配置'), {
      code: 'PROVIDER_NOT_CONFIGURED',
      status: 503,
    });
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

async function getApiMode(): Promise<'direct' | 'proxy'> {
  const rows = await query<Array<{ value: string }>>(
    'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
    ['api_mode']
  );
  return rows?.[0]?.value === 'proxy' ? 'proxy' : 'direct';
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
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function getTaskOwnershipRow(taskId: string): Promise<TaskOwnershipRow | null> {
  const rows = await query<TaskOwnershipRow[]>(
    `SELECT task_id, user_id, provider_id, provider_status_key, status, error_message
     FROM tasks
     WHERE task_id = ?
     LIMIT 1`,
    [taskId]
  );

  return rows?.[0] ?? null;
}

function respondPrepareTokenError(res: Response, error: unknown): boolean {
  const typedError = error as { code?: string; status?: number; message?: string };
  if (!typedError.code && !typedError.status) {
    return false;
  }

  res.status(typedError.status ?? 401).json({
    code: typedError.code ?? 'INVALID_PREPARE_TOKEN',
    message: typedError.message ?? 'prepareToken 无效',
  });
  return true;
}

function resolveVerifiedPrepareToken(req: Request, res: Response): VerifiedPrepareTokenPayload | null {
  const { prepareToken } = req.body as { prepareToken?: string };

  if (!prepareToken || typeof prepareToken !== 'string') {
    res.status(401).json({ code: 'INVALID_PREPARE_TOKEN', message: 'prepareToken 无效' });
    return null;
  }

  try {
    return verifyPrepareToken(prepareToken);
  } catch (error) {
    if (respondPrepareTokenError(res, error)) {
      return null;
    }
    throw error;
  }
}

function ensureTaskOwnership(
  reqUserId: number,
  tokenPayload: VerifiedPrepareTokenPayload,
  task: TaskOwnershipRow,
  res: Response
): boolean {
  if (!isTaskOwner(tokenPayload.userId, reqUserId)) {
    res.status(403).json({ code: 'TASK_OWNER_MISMATCH', message: '没有权限操作该任务' });
    return false;
  }

  if (!isTaskOwner(task.user_id, reqUserId) || task.provider_id !== tokenPayload.providerId) {
    res.status(403).json({ code: 'TASK_OWNER_MISMATCH', message: '没有权限操作该任务' });
    return false;
  }

  return true;
}

function toMysqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeProviderStatusKey(providerStatusKey: string | null, taskId: string): string {
  if (!providerStatusKey || providerStatusKey.length === 0) {
    return taskId;
  }

  return providerStatusKey.startsWith(DIRECT_PROVIDER_STATUS_KEY_PREFIX)
    ? providerStatusKey.slice(DIRECT_PROVIDER_STATUS_KEY_PREFIX.length) || taskId
    : providerStatusKey;
}

async function resolveCompletionBilling(
  task: TaskOwnershipRow,
  clientOutputUrl: string,
  clientThumbnailUrl?: string
): Promise<{ outputUrl: string; thumbnailUrl?: string; creditCost: number }> {
  const fallbackCreditCost = getProviderDefaultCreditCost(task.provider_id);
  const adapter = providerRegistry.get(task.provider_id);
  if (!adapter) {
    return {
      outputUrl: clientOutputUrl,
      thumbnailUrl: clientThumbnailUrl,
      creditCost: fallbackCreditCost,
    };
  }

  try {
    const apiKey = await getApiKey(task.provider_id);
    const status = await adapter.getTaskStatus(
      apiKey,
      task.task_id,
      normalizeProviderStatusKey(task.provider_status_key, task.task_id)
    );

    if (status.status === 'success' && status.outputUrl) {
      return {
        outputUrl: status.outputUrl,
        thumbnailUrl: status.thumbnailUrl ?? clientThumbnailUrl,
        creditCost: status.creditCost ?? fallbackCreditCost,
      };
    }
  } catch (error) {
    console.warn(
      `[DirectTaskController] provider billing verification fallback for ${task.task_id}:`,
      (error as Error).message
    );
  }

  return {
    outputUrl: clientOutputUrl,
    thumbnailUrl: clientThumbnailUrl,
    creditCost: fallbackCreditCost,
  };
}

export async function prepareTask(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const { type, provider_id: rawProviderId } = req.body as {
    type?: string;
    provider_id?: string;
  };
  const providerId = rawProviderId ?? 'tripo3d';

  if (!providerRegistry.isEnabled(providerId)) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }

  if (!type || !['text_to_model', 'image_to_model'].includes(type)) {
    res.status(422).json({ code: 4001, message: '参数错误', errors: ['type 无效'] });
    return;
  }

  let apiKey: string;
  try {
    apiKey = await getApiKey(providerId);
  } catch (error) {
    const typedError = error as { code?: string; status?: number; message?: string };
    res.status(typedError.status ?? 503).json({
      code: typedError.code ?? 'PROVIDER_NOT_CONFIGURED',
      message: typedError.message ?? 'API Key 未配置',
    });
    return;
  }

  let accountSnapshot: AccountSnapshot | null;
  try {
    accountSnapshot = await getLockedSiteAccountSnapshot();
  } catch (error) {
    console.error('[DirectTaskController] 读取额度账户失败:', error);
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

  const estimatedCreditCost = getEstimatedCreditCost(providerId);
  const estimatedPower = creditToPower(providerId, estimatedCreditCost);

  if (totalBalance < estimatedPower) {
    res.status(422).json({ code: 'INSUFFICIENT_CREDITS', message: '额度不足' });
    return;
  }

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  const tempTaskId = `temp:${userId}:${Date.now()}`;

  let preDeductResult: DeductResult;
  try {
    preDeductResult = await sitePowerManager.preDeduct(providerId, estimatedPower, tempTaskId);
  } catch (error) {
    console.error('[DirectTaskController] 预扣额度失败:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
    return;
  }

  if (!preDeductResult.success) {
    if (preDeductResult.errorCode === 'CONCURRENT_CONFLICT') {
      res.status(409).json({ code: 'CONCURRENT_CONFLICT', message: '并发冲突，请重试' });
      return;
    }

    res.status(422).json({ code: 'INSUFFICIENT_CREDITS', message: '额度不足' });
    return;
  }

  const prepareToken = signPrepareToken({
    userId,
    providerId,
    tempTaskId,
    estimatedPower,
  });
  const providerApiConfig = getProviderApiConfig(providerId);
  const mode = await getApiMode();

  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.status(200).json({
    apiKey,
    prepareToken,
    providerId,
    estimatedPower,
    apiBaseUrl: providerApiConfig.apiBaseUrl,
    modelVersion: providerApiConfig.modelVersion,
    mode,
  });
}

export async function registerTask(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const tokenPayload = resolveVerifiedPrepareToken(req, res);
  if (!tokenPayload) {
    return;
  }

  if (!isTaskOwner(tokenPayload.userId, userId)) {
    res.status(403).json({ code: 'TASK_OWNER_MISMATCH', message: '没有权限操作该任务' });
    return;
  }

  const { taskId, type, prompt, pollingKey } = req.body as {
    taskId?: string;
    type?: string;
    prompt?: string;
    pollingKey?: string;
  };

  if (!taskId || typeof taskId !== 'string' || !type || !['text_to_model', 'image_to_model'].includes(type)) {
    res.status(422).json({ code: 4001, message: '参数错误' });
    return;
  }

  try {
    await query(
      "INSERT INTO tasks (task_id, provider_status_key, user_id, provider_id, type, prompt, status, progress) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0)",
      [
        taskId,
        `${DIRECT_PROVIDER_STATUS_KEY_PREFIX}${pollingKey ?? taskId}`,
        userId,
        tokenPayload.providerId,
        type,
        prompt ?? null,
      ]
    );

    const updateResult = await query<{ affectedRows?: number }>(
      "UPDATE site_power_ledger SET task_id = ? WHERE task_id = ? AND provider_id = ? AND event_type = 'pre_deduct'",
      [taskId, tokenPayload.tempTaskId, tokenPayload.providerId]
    );

    if ((updateResult as { affectedRows?: number })?.affectedRows === 0) {
      res.status(422).json({ code: 'PRE_DEDUCT_NOT_FOUND', message: '预扣记录不存在' });
      return;
    }

    addTaskToPoller(taskId);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[DirectTaskController] 注册任务失败:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function completeTask(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const tokenPayload = resolveVerifiedPrepareToken(req, res);
  if (!tokenPayload) {
    return;
  }

  const taskId = getTaskIdParam(req);
  if (!taskId) {
    res.status(422).json({ code: 4001, message: '参数错误' });
    return;
  }
  const { outputUrl, thumbnailUrl } = req.body as {
    outputUrl?: string;
    thumbnailUrl?: string;
  };

  let task: TaskOwnershipRow | null;
  try {
    task = await getTaskOwnershipRow(taskId);
  } catch (error) {
    console.error('[DirectTaskController] 查询任务失败:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
    return;
  }

  if (!task) {
    res.status(404).json({ code: 'TASK_NOT_FOUND', message: '任务不存在' });
    return;
  }

  if (!ensureTaskOwnership(userId, tokenPayload, task, res)) {
    return;
  }

  if (task.status === 'success') {
    res.status(200).json({
      success: true,
      billingStatus: task.error_message?.startsWith('计费待补扣：') ? 'undercharged' : 'settled',
    });
    return;
  }

  if (task.status === 'failed') {
    res.status(409).json({ code: 'TASK_ALREADY_FAILED', message: '任务已失败' });
    return;
  }

  if (!outputUrl || typeof outputUrl !== 'string') {
    res.status(422).json({ code: 4001, message: '参数错误' });
    return;
  }

  try {
    const completedAt = new Date();
    const resolvedBilling = await resolveCompletionBilling(task, outputUrl, thumbnailUrl);
    const powerCost = creditToPower(task.provider_id, resolvedBilling.creditCost);
    const result = await sitePowerManager.finalizeTaskSuccess(
      task.provider_id,
      taskId,
      resolvedBilling.outputUrl,
      powerCost,
      resolvedBilling.creditCost,
      resolvedBilling.thumbnailUrl
    );
    const expiresAt = computeExpiresAt(
      resolvedBilling.outputUrl,
      resolvedBilling.thumbnailUrl ?? null,
      completedAt
    );
    await query('UPDATE tasks SET expires_at = ? WHERE task_id = ?', [toMysqlDateTime(expiresAt), taskId]);

    res.status(200).json({
      success: true,
      billingStatus: result.billingStatus,
      billingMessage: result.billingMessage ?? undefined,
    });
  } catch (error) {
    console.error('[DirectTaskController] 完成任务失败:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function failTask(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.userId;
  const tokenPayload = resolveVerifiedPrepareToken(req, res);
  if (!tokenPayload) {
    return;
  }

  const taskId = getTaskIdParam(req);
  if (!taskId) {
    res.status(422).json({ code: 4001, message: '参数错误' });
    return;
  }
  const { errorMessage } = req.body as { errorMessage?: string };

  let task: TaskOwnershipRow | null;
  try {
    task = await getTaskOwnershipRow(taskId);
  } catch (error) {
    console.error('[DirectTaskController] 查询任务失败:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
    return;
  }

  if (!task) {
    res.status(404).json({ code: 'TASK_NOT_FOUND', message: '任务不存在' });
    return;
  }

  if (!ensureTaskOwnership(userId, tokenPayload, task, res)) {
    return;
  }

  if (task.status === 'failed') {
    res.status(200).json({ success: true });
    return;
  }

  if (task.status === 'success') {
    res.status(409).json({ code: 'TASK_ALREADY_COMPLETED', message: '任务已完成' });
    return;
  }

  try {
    await sitePowerManager.refund(task.provider_id, taskId);
    await query(
      "UPDATE tasks SET status = 'failed', error_message = ?, completed_at = NOW() WHERE task_id = ?",
      [errorMessage ?? '任务生成失败', taskId]
    );
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[DirectTaskController] 标记任务失败失败:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}
