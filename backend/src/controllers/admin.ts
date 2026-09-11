/**
 * AdminController
 *
 * GET  /backend/admin/config     — 读取 API Key（脱敏返回），支持 provider_id query 参数
 * PUT  /backend/admin/config     — 验证格式 + 连通性，加密写入 system_config，支持 provider_id body 参数
 * GET  /backend/admin/balance    — 查询提供商余额，支持 provider_id query 参数
 * GET  /backend/admin/usage      — 全局 credit 消耗统计
 * GET  /backend/admin/providers  — 返回已启用提供商列表
 */

import { Router, Request, Response } from 'express';
import { creditToPower } from '../config/providers';
import { query } from '../db/connection';
import { encrypt, decrypt } from '../services/crypto';
import { providerRegistry } from '../adapters/ProviderRegistry';
import { normalizeTaskBilling } from '../utils/taskBilling';
import { probeRegion, TripoRegion } from '../services/regionProbe';
import { isRuntimeConfigError } from '../config/runtime';
import { getProviderDispatcherHealth, wakeProviderDispatcher } from '../services/providerQueue';
import { recordAdminAudit, redactDiagnosticValue } from '../services/adminAudit';
import type { AuthenticatedRequest } from '../middleware/auth';

export const adminRouter = Router();

type UsageUserSnapshot = {
  username?: string;
  nickname?: string | null;
  email?: string | null;
};

function normalizeSnapshotText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseUsageUserSnapshot(value: unknown): UsageUserSnapshot | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value as UsageUserSnapshot;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as UsageUserSnapshot : null;
  } catch {
    return null;
  }
}

function resolveUsageUsername(userId: number, snapshotValue: unknown): string {
  const snapshot = parseUsageUserSnapshot(snapshotValue);
  return (
    normalizeSnapshotText(snapshot?.nickname)
    ?? normalizeSnapshotText(snapshot?.username)
    ?? normalizeSnapshotText(snapshot?.email)
    ?? `User ${userId}`
  );
}

function sendRuntimeConfigError(res: Response, err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (
    isRuntimeConfigError(err)
    || message.includes('CRYPTO_KEY')
    || message.includes('PREPARE_TOKEN_SECRET')
  ) {
    res.status(503).json({
      code: 'SERVER_CONFIG_INVALID',
      message,
    });
    return true;
  }
  return false;
}

function resolveAdminProviderId(rawProviderId: unknown): string | null {
  const providerId = typeof rawProviderId === 'string' && rawProviderId.length > 0
    ? rawProviderId
    : providerRegistry.getDefaultId();

  if (!providerId || !providerRegistry.isEnabled(providerId)) {
    return null;
  }

  return providerId;
}

function adminActorId(req: Request): number | null {
  const actor = (req as Partial<AuthenticatedRequest>).user?.userId;
  return Number.isInteger(actor) ? Number(actor) : null;
}

function normalizePage(value: unknown, fallback = 1): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : fallback;
}

function parseJsonObject(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const ADMIN_QUEUE_STATUSES = new Set([
  'waiting_provider', 'retry_wait', 'submitting', 'queued', 'processing',
  'packaging', 'provider_state_unknown', 'success', 'failed', 'timeout', 'cancelled',
]);

function safeDiagnosticDetail(value: unknown): unknown {
  return redactDiagnosticValue(parseJsonObject(value));
}

function nearestRankPercentile(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return sorted[index];
}

// ─── GET /backend/admin/config ───────────────────────────────────────────────

adminRouter.get('/config', async (req: Request, res: Response): Promise<void> => {
  const providerId = resolveAdminProviderId(req.query.provider_id);
  if (!providerId) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }
  const configKey = `${providerId}_api_key`;

  try {
    const rows = await query<Array<{ value: string }>>(
      'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
      [configKey]
    );

    if (!rows || rows.length === 0) {
      res.json({ configured: false });
      return;
    }

    let plaintext: string;
    try {
      plaintext = decrypt(rows[0].value);
    } catch {
      res.json({ configured: false });
      return;
    }

    // 脱敏：前 8 位 + ****
    const masked = plaintext.slice(0, 8) + '****';

    // tripo3d: 额外返回区域信息
    if (providerId === 'tripo3d') {
      const regionRows = await query<Array<{ value: string }>>(
        'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
        ['tripo3d_region']
      );
      const regionValue = regionRows?.[0]?.value;
      const region: TripoRegion | undefined =
        regionValue === 'ai' || regionValue === 'com' ? regionValue : undefined;
      res.json({ configured: true, apiKeyMasked: masked, region });
      return;
    }

    res.json({ configured: true, apiKeyMasked: masked });
  } catch (err) {
    console.error('[AdminController] GET /config error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
});

// ─── PUT /backend/admin/config ───────────────────────────────────────────────

adminRouter.put('/config', async (req: Request, res: Response): Promise<void> => {
  const { apiKey, provider_id: rawProviderId } = req.body as { apiKey?: string; provider_id?: string };
  const providerId = resolveAdminProviderId(rawProviderId);
  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';

  // 格式验证
  if (!normalizedApiKey) {
    res.status(422).json({ code: 4001, message: '参数错误', errors: ['apiKey 不能为空'] });
    return;
  }

  if (!providerId) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }

  // 获取适配器进行格式验证
  const adapter = providerRegistry.get(providerId);
  if (!adapter) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }

  if (!adapter.validateApiKeyFormat(normalizedApiKey)) {
    res.status(422).json({
      code: 4001,
      message: '参数错误',
      errors: ['API Key 格式无效'],
    });
    return;
  }

  // tripo3d: 先探测区域，再保存 Key + Region
  if (providerId === 'tripo3d') {
    let region: TripoRegion;
    try {
      region = await probeRegion(normalizedApiKey);
    } catch {
      res.status(422).json({
        code: 4001,
        message: 'API Key 无效或网络不可达，请检查 Key 是否正确',
      });
      return;
    }

    try {
      const encrypted = encrypt(normalizedApiKey);
      await query(
        `INSERT INTO system_config (\`key\`, \`value\`) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`,
        ['tripo3d_api_key', encrypted]
      );
      await query(
        `INSERT INTO system_config (\`key\`, \`value\`) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`,
        ['tripo3d_region', region]
      );
      await recordAdminAudit({
        actorId: adminActorId(req), action: 'provider_credential_update', targetType: 'provider_credential',
        targetId: providerId, after: { configured: true, region },
      });
      res.json({ success: true, region });
    } catch (err) {
      if (sendRuntimeConfigError(res, err)) {
        return;
      }
      console.error('[AdminController] PUT /config error:', err);
      res.status(500).json({ code: 5001, message: '服务器内部错误' });
    }
    return;
  }

  // 其他 provider: 加密并 upsert
  try {
    const encrypted = encrypt(normalizedApiKey);
    const configKey = `${providerId}_api_key`;
    await query(
      `INSERT INTO system_config (\`key\`, \`value\`) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`,
      [configKey, encrypted]
    );
    await recordAdminAudit({
      actorId: adminActorId(req), action: 'provider_credential_update', targetType: 'provider_credential',
      targetId: providerId, after: { configured: true },
    });
    res.json({ success: true });
  } catch (err) {
    if (sendRuntimeConfigError(res, err)) {
      return;
    }
    console.error('[AdminController] PUT /config error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
});

// ─── GET /backend/admin/balance ──────────────────────────────────────────────

adminRouter.get('/balance', async (req: Request, res: Response): Promise<void> => {
  const providerId = resolveAdminProviderId(req.query.provider_id);
  if (!providerId) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }
  const configKey = `${providerId}_api_key`;

  const adapter = providerRegistry.get(providerId);
  if (!adapter) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }

  try {
    const rows = await query<Array<{ value: string }>>(
      'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
      [configKey]
    );
    if (!rows || rows.length === 0) {
      res.json({ configured: false });
      return;
    }

    let apiKey: string;
    try {
      apiKey = decrypt(rows[0].value);
    } catch {
      res.json({ configured: false });
      return;
    }

    const balance = await adapter.getBalance(apiKey);

    // tripo3d: 额外返回区域信息
    if (providerId === 'tripo3d') {
      const regionRows = await query<Array<{ value: string }>>(
        'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
        ['tripo3d_region']
      );
      const regionValue = regionRows?.[0]?.value;
      const region: TripoRegion | undefined =
        regionValue === 'ai' || regionValue === 'com' ? regionValue : undefined;
      res.json({
        configured: true,
        available: balance.available,
        availablePower: creditToPower(providerId, balance.available),
        frozen: balance.frozen,
        region,
      });
      return;
    }

    res.json({
      configured: true,
      available: balance.available,
      availablePower: creditToPower(providerId, balance.available),
      frozen: balance.frozen,
    });
  } catch (err) {
    const e = err as { status?: number; code?: number; message?: string };
    if (e.status === 422) {
      res.status(422).json({ code: e.code ?? 4001, message: e.message ?? 'API Key 无效' });
      return;
    }
    console.error('[AdminController] GET /balance error:', err);
    res.status(502).json({ code: 3002, message: '查询余额失败' });
  }
});

// ─── GET /backend/admin/providers ────────────────────────────────────────────

export function getProvidersHandler(_req: Request, res: Response): void {
  const providers = providerRegistry.getEnabledIds();
  res.json({ providers });
}

adminRouter.get('/providers', getProvidersHandler);

// ─── Provider queue runtime ─────────────────────────────────────────────────

adminRouter.get('/provider-runtime', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await query<Array<Record<string, unknown>>>(
      `SELECT c.provider_id, c.credential_scope, c.max_concurrency, c.paused, c.pause_reason,
              c.poll_interval_seconds, c.retry_limit, c.config_version, c.updated_at,
              MAX(cfg.\`key\`) IS NOT NULL AS configured,
              SUM(CASE WHEN t.provider_slot_acquired_at IS NOT NULL
                        AND t.provider_slot_released_at IS NULL
                        AND t.status IN ('submitting', 'queued', 'processing', 'provider_state_unknown')
                       THEN 1 ELSE 0 END) AS active_count,
              SUM(CASE WHEN t.status IN ('waiting_provider', 'retry_wait') THEN 1 ELSE 0 END) AS queue_depth,
              MIN(CASE WHEN t.status IN ('waiting_provider', 'retry_wait') THEN t.queue_entered_at END) AS oldest_wait,
              SUM(CASE WHEN t.status = 'waiting_provider' THEN 1 ELSE 0 END) AS waiting_count,
              SUM(CASE WHEN t.status = 'retry_wait' THEN 1 ELSE 0 END) AS retry_count,
              SUM(CASE WHEN t.status = 'submitting' THEN 1 ELSE 0 END) AS submitting_count,
              SUM(CASE WHEN t.status = 'queued' THEN 1 ELSE 0 END) AS queued_count,
              SUM(CASE WHEN t.status = 'processing' THEN 1 ELSE 0 END) AS processing_count,
              SUM(CASE WHEN t.status = 'packaging' THEN 1 ELSE 0 END) AS packaging_count,
              SUM(CASE WHEN t.status = 'provider_state_unknown' THEN 1 ELSE 0 END) AS unknown_count,
              SUM(CASE WHEN t.status = 'failed' AND t.completed_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE) THEN 1 ELSE 0 END) AS recent_failed_count
       FROM provider_runtime_config c
       LEFT JOIN tasks t
         ON t.provider_id = c.provider_id AND t.credential_scope = c.credential_scope
       LEFT JOIN system_config cfg ON cfg.\`key\` = CONCAT(c.provider_id, '_api_key')
       GROUP BY c.provider_id, c.credential_scope, c.max_concurrency, c.paused, c.pause_reason,
                c.poll_interval_seconds, c.retry_limit, c.config_version, c.updated_at
       ORDER BY c.provider_id, c.credential_scope`
    );
    const recentEvents = await query<Array<Record<string, unknown>>>(
      `SELECT e.provider_id, t.credential_scope,
              SUM(CASE WHEN e.event_type = 'dispatch_retry_scheduled' THEN 1 ELSE 0 END) AS throttle_count,
              SUM(CASE WHEN e.event_type = 'submission_unknown' THEN 1 ELSE 0 END) AS unknown_event_count,
              MAX(CASE WHEN e.event_type IN ('dispatch_failed', 'provider_scope_paused', 'submission_unknown') THEN e.created_at END) AS last_error_at,
              SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN e.event_type IN ('dispatch_failed', 'provider_scope_paused', 'submission_unknown') THEN e.event_type END ORDER BY e.created_at DESC), ',', 1) AS last_error_type
       FROM provider_task_events e
       INNER JOIN tasks t ON t.task_id = e.task_id
       WHERE e.created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
       GROUP BY e.provider_id, t.credential_scope`
    );
    const eventByProvider = new Map(recentEvents.map((row) => [`${row.provider_id}:${row.credential_scope}`, row]));
    res.json({
      data: rows.map((row) => ({
        providerId: row.provider_id,
        credentialScope: row.credential_scope,
        maxConcurrency: Number(row.max_concurrency),
        activeCount: Number(row.active_count ?? 0),
        queueDepth: Number(row.queue_depth ?? 0),
        oldestWait: row.oldest_wait ?? null,
        paused: Boolean(row.paused),
        pauseReason: row.pause_reason ?? null,
        pollIntervalSeconds: Number(row.poll_interval_seconds),
        retryLimit: Number(row.retry_limit),
        configVersion: Number(row.config_version),
        updatedAt: row.updated_at,
        configured: Boolean(row.configured),
        statusCounts: {
          waiting: Number(row.waiting_count ?? 0),
          retry: Number(row.retry_count ?? 0),
          submitting: Number(row.submitting_count ?? 0),
          queued: Number(row.queued_count ?? 0),
          processing: Number(row.processing_count ?? 0),
          packaging: Number(row.packaging_count ?? 0),
          unknown: Number(row.unknown_count ?? 0),
          failed: Number(row.recent_failed_count ?? 0),
        },
        recentMetrics: {
          throttleCount: Number(eventByProvider.get(`${row.provider_id}:${row.credential_scope}`)?.throttle_count ?? 0),
          unknownEventCount: Number(eventByProvider.get(`${row.provider_id}:${row.credential_scope}`)?.unknown_event_count ?? 0),
          lastErrorAt: eventByProvider.get(`${row.provider_id}:${row.credential_scope}`)?.last_error_at ?? null,
          lastErrorType: eventByProvider.get(`${row.provider_id}:${row.credential_scope}`)?.last_error_type ?? null,
        },
      })),
    });
  } catch (error) {
    console.error('[AdminController] GET /provider-runtime error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
});

adminRouter.put('/provider-runtime/:providerId', async (req: Request, res: Response): Promise<void> => {
  const providerId = String(req.params.providerId);
  if (!providerRegistry.isEnabled(providerId)) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }
  const input = req.body as {
    maxConcurrency?: unknown;
    paused?: unknown;
    pauseReason?: unknown;
    pollIntervalSeconds?: unknown;
    retryLimit?: unknown;
    configVersion?: unknown;
    credentialScope?: unknown;
  };
  const credentialScope = typeof input.credentialScope === 'string' && input.credentialScope.trim()
    ? input.credentialScope.trim().slice(0, 64)
    : 'default';
  const maxConcurrency = Number(input.maxConcurrency);
  const pollIntervalSeconds = Number(input.pollIntervalSeconds ?? 3);
  const retryLimit = Number(input.retryLimit ?? 6);
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || (providerId === 'tripo3d' && maxConcurrency > 5)) {
    res.status(422).json({
      code: 'INVALID_CONCURRENCY',
      message: providerId === 'tripo3d' ? 'Tripo3D P1 并发必须在 1 到 5 之间' : '并发必须为正整数',
    });
    return;
  }
  if (!Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds < 1 || pollIntervalSeconds > 300
    || !Number.isInteger(retryLimit) || retryLimit < 1 || retryLimit > 20) {
    res.status(422).json({ code: 'INVALID_RUNTIME_CONFIG', message: '轮询间隔或重试次数超出范围' });
    return;
  }
  try {
    const beforeRows = await query<Array<Record<string, unknown>>>(
      `SELECT max_concurrency, paused, pause_reason, poll_interval_seconds, retry_limit, config_version
       FROM provider_runtime_config WHERE provider_id = ? AND credential_scope = ? LIMIT 1`,
      [providerId, credentialScope]
    );
    const before = beforeRows[0];
    if (!before) {
      res.status(404).json({ code: 'RUNTIME_CONFIG_NOT_FOUND', message: '供应商运行配置不存在' });
      return;
    }
    const result = await query<{ affectedRows: number }>(
      `UPDATE provider_runtime_config
       SET max_concurrency = ?, paused = ?, pause_reason = ?, poll_interval_seconds = ?, retry_limit = ?,
           config_version = config_version + 1
       WHERE provider_id = ? AND credential_scope = ?
         AND (? IS NULL OR config_version = ?)`,
      [
        maxConcurrency,
        input.paused === true ? 1 : 0,
        typeof input.pauseReason === 'string' ? input.pauseReason.slice(0, 256) : null,
        pollIntervalSeconds,
        retryLimit,
        providerId,
        credentialScope,
        input.configVersion ?? null,
        input.configVersion ?? null,
      ]
    );
    if (Number(result.affectedRows ?? 0) === 0) {
      res.status(409).json({ code: 'CONFIG_VERSION_CONFLICT', message: '配置已变化，请刷新后重试' });
      return;
    }
    await recordAdminAudit({
      actorId: adminActorId(req),
      action: input.paused === true ? 'provider_runtime_pause' : 'provider_runtime_update',
      targetType: 'provider_runtime',
      targetId: `${providerId}:${credentialScope}`,
      before,
      after: { maxConcurrency, paused: input.paused === true, pauseReason: input.pauseReason ?? null, pollIntervalSeconds, retryLimit },
    });
    wakeProviderDispatcher();
    res.json({ success: true, configVersion: Number(before.config_version) + 1 });
  } catch (error) {
    console.error('[AdminController] PUT /provider-runtime error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
});

adminRouter.post('/provider-runtime/:providerId/wake', async (req: Request, res: Response): Promise<void> => {
  const providerId = resolveAdminProviderId(req.params.providerId);
  if (!providerId) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }
  await recordAdminAudit({
    actorId: adminActorId(req), action: 'provider_dispatch_wake', targetType: 'provider_runtime', targetId: providerId,
  });
  wakeProviderDispatcher();
  res.json({ success: true });
});

async function setProviderPauseState(req: Request, res: Response, paused: boolean): Promise<void> {
  const providerId = resolveAdminProviderId(req.params.providerId);
  const credentialScope = typeof req.body?.credentialScope === 'string' && req.body.credentialScope.trim()
    ? req.body.credentialScope.trim().slice(0, 64)
    : 'default';
  if (!providerId) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }
  const reason = paused && typeof req.body?.pauseReason === 'string'
    ? req.body.pauseReason.trim().slice(0, 256)
    : null;
  try {
    const beforeRows = await query<Array<Record<string, unknown>>>(
      `SELECT paused, pause_reason, config_version FROM provider_runtime_config
       WHERE provider_id = ? AND credential_scope = ? LIMIT 1`,
      [providerId, credentialScope]
    );
    const before = beforeRows[0];
    if (!before) {
      res.status(404).json({ code: 'RUNTIME_CONFIG_NOT_FOUND', message: '供应商运行配置不存在' });
      return;
    }
    const result = await query<{ affectedRows: number }>(
      `UPDATE provider_runtime_config
       SET paused = ?, pause_reason = ?, config_version = config_version + 1
       WHERE provider_id = ? AND credential_scope = ? AND config_version = ?`,
      [paused ? 1 : 0, paused ? (reason || 'manual pause') : null, providerId, credentialScope, before.config_version]
    );
    if (Number(result.affectedRows ?? 0) === 0) {
      res.status(409).json({ code: 'CONFIG_VERSION_CONFLICT', message: '配置已变化，请刷新后重试' });
      return;
    }
    await recordAdminAudit({
      actorId: adminActorId(req), action: paused ? 'provider_runtime_pause' : 'provider_runtime_resume',
      targetType: 'provider_runtime', targetId: `${providerId}:${credentialScope}`,
      before, after: { paused, pauseReason: paused ? (reason || 'manual pause') : null },
    });
    wakeProviderDispatcher();
    res.json({ success: true });
  } catch (error) {
    console.error('[AdminController] provider pause state error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

adminRouter.post('/provider-runtime/:providerId/pause', async (req: Request, res: Response) => {
  await setProviderPauseState(req, res, true);
});

adminRouter.post('/provider-runtime/:providerId/resume', async (req: Request, res: Response) => {
  await setProviderPauseState(req, res, false);
});

// ─── Queue operations and safe diagnostics ──────────────────────────────────

adminRouter.get('/provider-queue', async (req: Request, res: Response): Promise<void> => {
  const providerId = typeof req.query.provider_id === 'string' ? req.query.provider_id : undefined;
  const status = typeof req.query.status === 'string' && ADMIN_QUEUE_STATUSES.has(req.query.status)
    ? req.query.status
    : undefined;
  const page = normalizePage(req.query.page);
  const pageSize = Math.min(100, normalizePage(req.query.pageSize, 20));
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (providerId) {
    where.push('t.provider_id = ?');
    params.push(providerId);
  }
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  const condition = where.join(' AND ');
  try {
    const rows = await query<Array<Record<string, unknown>>>(
      `SELECT t.task_id, t.provider_task_id, t.user_id, t.provider_id, t.credential_scope, t.status,
              t.progress, t.queue_entered_at, t.next_attempt_at, t.attempt_count, t.priority,
              t.provider_slot_acquired_at, t.provider_slot_released_at, t.provider_error_category,
              t.provider_error_code, t.provider_trace_id, t.error_message, t.quota_epoch, t.created_at, t.completed_at
       FROM tasks t WHERE ${condition}
       ORDER BY t.queue_entered_at ASC, t.created_at ASC, t.task_id ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    const countRows = await query<Array<{ total: number | string }>>(
      `SELECT COUNT(*) AS total FROM tasks t WHERE ${condition}`,
      params
    );
    res.json({
      data: rows.map((row) => ({
        taskId: row.task_id,
        providerTaskId: row.provider_task_id,
        userId: row.user_id,
        providerId: row.provider_id,
        credentialScope: row.credential_scope,
        status: row.status,
        progress: Number(row.progress ?? 0),
        queueEnteredAt: row.queue_entered_at ?? null,
        nextAttemptAt: row.next_attempt_at ?? null,
        attemptCount: Number(row.attempt_count ?? 0),
        priority: Number(row.priority ?? 0),
        slotAcquiredAt: row.provider_slot_acquired_at ?? null,
        slotReleasedAt: row.provider_slot_released_at ?? null,
        errorCategory: row.provider_error_category ?? null,
        errorCode: row.provider_error_code ?? null,
        providerTraceId: row.provider_trace_id ?? null,
        errorMessage: row.error_message ?? null,
        quotaEpoch: Number(row.quota_epoch ?? 1),
        createdAt: row.created_at,
        completedAt: row.completed_at ?? null,
      })),
      pagination: { page, pageSize, total: Number(countRows[0]?.total ?? 0) },
    });
  } catch (error) {
    console.error('[AdminController] GET /provider-queue error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
});

adminRouter.get('/tasks/:taskId/diagnostics', async (req: Request, res: Response): Promise<void> => {
  const taskId = String(req.params.taskId);
  try {
    const taskRows = await query<Array<Record<string, unknown>>>(
      `SELECT task_id, provider_task_id, user_id, provider_id, credential_scope, status, progress,
              attempt_count, quota_epoch, provider_error_category, provider_error_code, provider_trace_id,
              error_message, queue_entered_at, next_attempt_at, lease_owner, lease_expires_at,
              provider_slot_acquired_at, provider_slot_released_at, created_at, completed_at
       FROM tasks WHERE task_id = ? LIMIT 1`,
      [taskId]
    );
    const task = taskRows[0];
    if (!task) {
      res.status(404).json({ code: 4004, message: '任务不存在' });
      return;
    }
    const events = await query<Array<Record<string, unknown>>>(
      `SELECT event_type, from_status, to_status, attempt_count, trace_id, detail_json, created_at
       FROM provider_task_events WHERE task_id = ? ORDER BY id DESC LIMIT 100`,
      [taskId]
    );
    res.json({
      task: {
        localTaskId: task.task_id,
        providerTaskId: task.provider_task_id,
        userId: task.user_id,
        providerId: task.provider_id,
        credentialScope: task.credential_scope,
        status: task.status,
        progress: task.progress,
        attemptCount: task.attempt_count,
        quotaEpoch: task.quota_epoch,
        providerErrorCategory: task.provider_error_category ?? null,
        providerErrorCode: task.provider_error_code ?? null,
        providerTraceId: task.provider_trace_id ?? null,
        errorMessage: task.error_message ?? null,
        queueEnteredAt: task.queue_entered_at ?? null,
        nextAttemptAt: task.next_attempt_at ?? null,
        leaseOwner: task.lease_owner ?? null,
        leaseExpiresAt: task.lease_expires_at ?? null,
        slotAcquiredAt: task.provider_slot_acquired_at ?? null,
        slotReleasedAt: task.provider_slot_released_at ?? null,
        createdAt: task.created_at,
        completedAt: task.completed_at ?? null,
      },
      events: events.map((event) => ({
        eventType: event.event_type,
        fromStatus: event.from_status ?? null,
        toStatus: event.to_status ?? null,
        attemptCount: Number(event.attempt_count ?? 0),
        traceId: event.trace_id ?? null,
        detail: safeDiagnosticDetail(event.detail_json),
        createdAt: event.created_at,
      })),
    });
  } catch (error) {
    console.error('[AdminController] GET /tasks/:taskId/diagnostics error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
});

adminRouter.get('/observability', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await query<Array<Record<string, unknown>>>(
      `SELECT c.provider_id, c.credential_scope, c.paused, c.pause_reason,
              COALESCE(t.queue_depth, 0) AS queue_depth,
              COALESCE(t.active_count, 0) AS active_count,
              COALESCE(t.state_unknown_count, 0) AS state_unknown_count,
              t.oldest_wait,
              COALESCE(t.average_queue_wait_seconds, 0) AS average_queue_wait_seconds,
              COALESCE(t.average_active_slot_seconds, 0) AS average_active_slot_seconds,
              COALESCE(e.dispatch_success_count, 0) AS dispatch_success_count,
              COALESCE(e.throttle_count, 0) AS throttle_count,
              COALESCE(e.retry_count, 0) AS retry_count,
              COALESCE(e.dispatch_failed_count, 0) AS dispatch_failed_count
       FROM provider_runtime_config c
       LEFT JOIN (
         SELECT provider_id, credential_scope,
                SUM(CASE WHEN status IN ('waiting_provider', 'retry_wait') THEN 1 ELSE 0 END) AS queue_depth,
                SUM(CASE WHEN provider_slot_acquired_at IS NOT NULL AND provider_slot_released_at IS NULL
                         AND status IN ('submitting', 'queued', 'processing', 'provider_state_unknown') THEN 1 ELSE 0 END) AS active_count,
                SUM(CASE WHEN status = 'provider_state_unknown' THEN 1 ELSE 0 END) AS state_unknown_count,
                MIN(CASE WHEN status IN ('waiting_provider', 'retry_wait') THEN queue_entered_at END) AS oldest_wait,
                AVG(CASE WHEN queue_entered_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, queue_entered_at, COALESCE(provider_slot_acquired_at, NOW())) END) AS average_queue_wait_seconds,
                AVG(CASE WHEN provider_slot_acquired_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, provider_slot_acquired_at, COALESCE(provider_slot_released_at, completed_at, NOW())) END) AS average_active_slot_seconds
         FROM tasks
         GROUP BY provider_id, credential_scope
       ) t ON t.provider_id = c.provider_id AND t.credential_scope = c.credential_scope
       LEFT JOIN (
         SELECT e.provider_id, t.credential_scope,
                SUM(CASE WHEN e.event_type = 'provider_submitted' THEN 1 ELSE 0 END) AS dispatch_success_count,
                SUM(CASE WHEN e.event_type = 'dispatch_retry_scheduled' THEN 1 ELSE 0 END) AS throttle_count,
                SUM(CASE WHEN e.event_type = 'dispatch_retry_scheduled' THEN 1 ELSE 0 END) AS retry_count,
                SUM(CASE WHEN e.event_type = 'dispatch_failed' THEN 1 ELSE 0 END) AS dispatch_failed_count
         FROM provider_task_events e
         INNER JOIN tasks t ON t.task_id = e.task_id
         WHERE e.created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
         GROUP BY e.provider_id, t.credential_scope
       ) e ON e.provider_id = c.provider_id AND e.credential_scope = c.credential_scope
       ORDER BY c.provider_id, c.credential_scope`
    );
    const waitingRows = await query<Array<Record<string, unknown>>>(
      `SELECT provider_id, credential_scope,
              GREATEST(0, TIMESTAMPDIFF(SECOND, queue_entered_at, NOW())) AS wait_seconds
       FROM tasks
       WHERE status IN ('waiting_provider', 'retry_wait')
         AND queue_entered_at IS NOT NULL`
    );
    const waitsByScope = new Map<string, number[]>();
    for (const waiting of waitingRows ?? []) {
      const key = `${waiting.provider_id}:${waiting.credential_scope}`;
      const values = waitsByScope.get(key) ?? [];
      values.push(Math.max(0, Number(waiting.wait_seconds ?? 0)));
      waitsByScope.set(key, values);
    }
    const unknownThreshold = Math.max(1, Number(process.env.AI3D_UNKNOWN_ALERT_THRESHOLD ?? 3));
    const throttleThreshold = Math.max(1, Number(process.env.AI3D_THROTTLE_ALERT_THRESHOLD ?? 5));
    const waitThresholdSeconds = Math.max(60, Number(process.env.AI3D_QUEUE_WAIT_ALERT_SECONDS ?? 600));
    const now = Date.now();
    const dispatcher = getProviderDispatcherHealth();
    const lastScanAt = dispatcher.lastScanAt ? new Date(dispatcher.lastScanAt).getTime() : null;
    const heartbeatThresholdMs = Math.max(15_000, dispatcher.scanMs * 3);
    const dispatcherStalled = !dispatcher.running || !lastScanAt || now - lastScanAt > heartbeatThresholdMs;
    const data = rows.map((row) => {
      const oldestWait = row.oldest_wait ? new Date(String(row.oldest_wait)).getTime() : null;
      const oldestWaitSeconds = oldestWait && Number.isFinite(oldestWait) ? Math.max(0, Math.floor((now - oldestWait) / 1000)) : 0;
      const pauseReason = String(row.pause_reason ?? '');
      const alerts = [
        Boolean(row.paused) ? { code: 'PROVIDER_PAUSED', severity: 'warning', message: '供应商已暂停，请处理账号或手动恢复' } : null,
        pauseReason.startsWith('NO_BALANCE:') ? { code: 'PROVIDER_BALANCE_LOW', severity: 'warning', message: '供应商余额不足，等待管理员充值或恢复' } : null,
        pauseReason.startsWith('NO_ACCESS:') ? { code: 'PROVIDER_AUTH_FAILED', severity: 'warning', message: '供应商鉴权失败，请检查授权后恢复' } : null,
        Number(row.state_unknown_count ?? 0) >= unknownThreshold ? { code: 'STATE_UNKNOWN_BACKLOG', severity: 'warning', message: '存在待人工核对的供应商任务' } : null,
        Number(row.throttle_count ?? 0) >= throttleThreshold ? { code: 'SUSTAINED_THROTTLING', severity: 'warning', message: '最近 15 分钟持续受到供应商限流' } : null,
        oldestWaitSeconds >= waitThresholdSeconds ? { code: 'QUEUE_WAIT_EXCEEDED', severity: 'warning', message: '队列等待时间超过阈值' } : null,
        !dispatcher.dispatchEnabled ? { code: 'DISPATCH_ROLLBACK_ACTIVE', severity: 'warning', message: '队列派发已暂停，已接单任务仍会继续结算' } : null,
        dispatcherStalled ? { code: 'DISPATCHER_HEARTBEAT_STALLED', severity: 'warning', message: '派发 Worker 心跳异常，请检查服务进程' } : null,
      ].filter(Boolean);
      const dispatchSuccessCount = Number(row.dispatch_success_count ?? 0);
      const dispatchFailedCount = Number(row.dispatch_failed_count ?? 0);
      const throttleCount = Number(row.throttle_count ?? 0);
      const dispatchAttemptCount = dispatchSuccessCount + dispatchFailedCount + throttleCount;
      const waits = waitsByScope.get(`${row.provider_id}:${row.credential_scope}`) ?? [];
      return {
        providerId: row.provider_id,
        credentialScope: row.credential_scope,
        queueDepth: Number(row.queue_depth ?? 0),
        activeCount: Number(row.active_count ?? 0),
        stateUnknownCount: Number(row.state_unknown_count ?? 0),
        oldestWait: row.oldest_wait ?? null,
        oldestWaitSeconds,
        dispatchSuccessCount,
        dispatchFailedCount,
        dispatchSuccessRate: dispatchSuccessCount + dispatchFailedCount > 0
          ? dispatchSuccessCount / (dispatchSuccessCount + dispatchFailedCount)
          : null,
        throttleCount,
        throttleRate: dispatchAttemptCount > 0 ? throttleCount / dispatchAttemptCount : null,
        retryCount: Number(row.retry_count ?? 0),
        averageQueueWaitSeconds: Number(row.average_queue_wait_seconds ?? 0),
        averageActiveSlotSeconds: Number(row.average_active_slot_seconds ?? 0),
        waitP50Seconds: nearestRankPercentile(waits, 0.5),
        waitP95Seconds: nearestRankPercentile(waits, 0.95),
        paused: Boolean(row.paused),
        pauseReason: row.pause_reason ?? null,
        alerts,
      };
    });
    res.json({ data, windowMinutes: 15, dispatcher });
  } catch (error) {
    console.error('[AdminController] GET /observability error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
});

// ─── GET /backend/admin/usage ────────────────────────────────────────────────

adminRouter.get('/usage', async (_req: Request, res: Response): Promise<void> => {
  try {
    const enabledProviderIds = new Set(providerRegistry.getEnabledIds());
    const successRows = await query<
      Array<{
        user_id: number;
        provider_id: string;
        credit_cost: number;
        power_cost: number;
        created_at: string;
        user_snapshot: unknown;
      }>
    >(
      `SELECT
         t.user_id,
         t.provider_id,
         t.credit_cost,
         t.power_cost,
         t.created_at,
         q.user_snapshot
       FROM tasks t
       LEFT JOIN quota_user_usage q ON q.user_id = t.user_id
       WHERE t.status = 'success'`
    );

    let totalCredits = 0;
    let totalPower = 0;
    const rankingMap = new Map<number, { credits: number; power: number; username: string }>();
    const dailyTrendMap = new Map<string, { credits: number; power: number }>();

    for (const row of successRows) {
      if (!enabledProviderIds.has(row.provider_id)) {
        continue;
      }

      const billing = normalizeTaskBilling({
        providerId: row.provider_id,
        creditCost: row.credit_cost,
        powerCost: row.power_cost,
        status: 'success',
      });
      totalCredits += billing.creditCost;
      totalPower += billing.powerCost;

      const ranking = rankingMap.get(row.user_id) ?? {
        credits: 0,
        power: 0,
        username: resolveUsageUsername(row.user_id, row.user_snapshot),
      };
      ranking.credits += billing.creditCost;
      ranking.power += billing.powerCost;
      if (ranking.username === `User ${row.user_id}` && row.user_snapshot) {
        ranking.username = resolveUsageUsername(row.user_id, row.user_snapshot);
      }
      rankingMap.set(row.user_id, ranking);

      const dateKey = new Date(row.created_at).toISOString().slice(0, 10);
      const trend = dailyTrendMap.get(dateKey) ?? { credits: 0, power: 0 };
      trend.credits += billing.creditCost;
      trend.power += billing.powerCost;
      dailyTrendMap.set(dateKey, trend);
    }

    res.json({
      totalCredits: Math.round(totalCredits * 100) / 100,
      totalPower: Math.round(totalPower * 100) / 100,
      userRanking: Array.from(rankingMap.entries())
        .map(([userId, values]) => ({
          userId,
          username: values.username,
          credits: Math.round(values.credits * 100) / 100,
          power: Math.round(values.power * 100) / 100,
        }))
        .sort((left, right) => right.credits - left.credits)
        .slice(0, 20),
      dailyTrend: Array.from(dailyTrendMap.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, values]) => ({
          date,
          credits: Math.round(values.credits * 100) / 100,
          power: Math.round(values.power * 100) / 100,
        })),
    });
  } catch (err) {
    console.error('[AdminController] GET /usage error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
});
