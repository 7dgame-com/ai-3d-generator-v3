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

export const adminRouter = Router();

// ─── GET /backend/admin/config ───────────────────────────────────────────────

adminRouter.get('/config', async (req: Request, res: Response): Promise<void> => {
  const providerId = (req.query.provider_id as string | undefined) ?? 'tripo3d';
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
    res.json({ configured: true, apiKeyMasked: masked });
  } catch (err) {
    console.error('[AdminController] GET /config error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
});

// ─── PUT /backend/admin/config ───────────────────────────────────────────────

adminRouter.put('/config', async (req: Request, res: Response): Promise<void> => {
  const { apiKey, provider_id: rawProviderId } = req.body as { apiKey?: string; provider_id?: string };
  const providerId = rawProviderId ?? 'tripo3d';

  // 格式验证
  if (!apiKey || typeof apiKey !== 'string') {
    res.status(422).json({ code: 4001, message: '参数错误', errors: ['apiKey 不能为空'] });
    return;
  }

  // 获取适配器进行格式和连通性验证
  const adapter = providerRegistry.get(providerId);
  if (!adapter) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }

  if (!adapter.validateApiKeyFormat(apiKey)) {
    res.status(422).json({
      code: 4001,
      message: '参数错误',
      errors: ['API Key 格式无效'],
    });
    return;
  }

  // 连通性验证
  try {
    await adapter.verifyApiKey(apiKey);
  } catch (err) {
    const e = err as { code?: number; status?: number; message?: string; detail?: string };
    if (e.status === 422) {
      res.status(422).json({ code: e.code ?? 4001, message: e.message ?? 'API Key 无效或无权限', errors: ['连通性验证失败'] });
      return;
    }
    res.status(502).json({ code: e.code ?? 3002, message: e.message ?? 'AI 服务暂时不可用', detail: e.detail });
    return;
  }

  // 加密并 upsert
  try {
    const encrypted = encrypt(apiKey);
    const configKey = `${providerId}_api_key`;
    await query(
      `INSERT INTO system_config (\`key\`, \`value\`) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`,
      [configKey, encrypted]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[AdminController] PUT /config error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
});

// ─── GET /backend/admin/balance ──────────────────────────────────────────────

adminRouter.get('/balance', async (req: Request, res: Response): Promise<void> => {
  const providerId = (req.query.provider_id as string | undefined) ?? 'tripo3d';
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

adminRouter.get('/providers', (_req: Request, res: Response): void => {
  const providers = providerRegistry.getEnabledIds();
  res.json({ providers });
});

// ─── GET /backend/admin/usage ────────────────────────────────────────────────

adminRouter.get('/usage', async (_req: Request, res: Response): Promise<void> => {
  try {
    const successRows = await query<
      Array<{ user_id: number; provider_id: string; credit_cost: number; power_cost: number; created_at: string }>
    >(
      `SELECT user_id, provider_id, credit_cost, power_cost, created_at
       FROM tasks
       WHERE status = 'success'`
    );

    let totalCredits = 0;
    let totalPower = 0;
    const rankingMap = new Map<number, { credits: number; power: number }>();
    const dailyTrendMap = new Map<string, { credits: number; power: number }>();

    for (const row of successRows) {
      const billing = normalizeTaskBilling({
        providerId: row.provider_id,
        creditCost: row.credit_cost,
        powerCost: row.power_cost,
        status: 'success',
      });
      totalCredits += billing.creditCost;
      totalPower += billing.powerCost;

      const ranking = rankingMap.get(row.user_id) ?? { credits: 0, power: 0 };
      ranking.credits += billing.creditCost;
      ranking.power += billing.powerCost;
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
          username: `User ${userId}`,
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
