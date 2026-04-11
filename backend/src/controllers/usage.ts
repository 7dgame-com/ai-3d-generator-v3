/**
 * UsageController
 *
 * GET /backend/usage         — 当前用户用量统计（总消耗、本月消耗、任务数、按日期趋势）
 * GET /backend/usage/history — 用量历史列表，支持 startDate、endDate、type 筛选
 */

import { Response } from 'express';
import { providerRegistry } from '../adapters/ProviderRegistry';
import { query } from '../db/connection';
import { AuthenticatedRequest } from '../middleware/auth';
import { normalizeTaskBilling } from '../utils/taskBilling';

// ─── GET /backend/usage ──────────────────────────────────────────────────────

export async function getUsageSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user.userId;
  const enabledProviderIds = new Set(providerRegistry.getEnabledIds());

  try {
    const successRows = await query<
      Array<{ provider_id: string; credit_cost: number; power_cost: number; created_at: string }>
    >(
      `SELECT provider_id, credit_cost, power_cost, created_at
       FROM tasks
       WHERE user_id = ?
         AND status = 'success'`,
      [userId]
    );

    const taskCountRows = await query<Array<{ task_count: number }>>(
      'SELECT COUNT(*) AS task_count FROM tasks WHERE user_id = ?',
      [userId]
    );
    const taskCount = Number(taskCountRows[0]?.task_count ?? 0);
    const now = new Date();
    const currentMonth = now.getUTCMonth();
    const currentYear = now.getUTCFullYear();
    const trendStartMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;

    let totalCredits = 0;
    let totalPower = 0;
    let monthCredits = 0;
    let monthPower = 0;
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
      const createdAt = new Date(row.created_at);

      totalCredits += billing.creditCost;
      totalPower += billing.powerCost;

      if (createdAt.getUTCFullYear() === currentYear && createdAt.getUTCMonth() === currentMonth) {
        monthCredits += billing.creditCost;
        monthPower += billing.powerCost;
      }

      if (createdAt.getTime() >= trendStartMs) {
        const dateKey = createdAt.toISOString().slice(0, 10);
        const current = dailyTrendMap.get(dateKey) ?? { credits: 0, power: 0 };
        current.credits += billing.creditCost;
        current.power += billing.powerCost;
        dailyTrendMap.set(dateKey, current);
      }
    }

    res.json({
      totalCredits: Math.round(totalCredits * 100) / 100,
      totalPower: Math.round(totalPower * 100) / 100,
      monthCredits: Math.round(monthCredits * 100) / 100,
      monthPower: Math.round(monthPower * 100) / 100,
      taskCount,
      dailyTrend: Array.from(dailyTrendMap.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, values]) => ({
          date,
          credits: Math.round(values.credits * 100) / 100,
          power: Math.round(values.power * 100) / 100,
        })),
    });
  } catch (err) {
    console.error('[UsageController] GET /usage error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

// ─── GET /backend/usage/history ──────────────────────────────────────────────

export async function getUsageHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user.userId;
  const enabledProviderIds = new Set(providerRegistry.getEnabledIds());
  const { startDate, endDate, type } = req.query as {
    startDate?: string;
    endDate?: string;
    type?: string;
  };

  try {
    const conditions: string[] = ['user_id = ?', "status = 'success'"];
    const params: unknown[] = [userId];

    if (startDate) {
      conditions.push('DATE(created_at) >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('DATE(created_at) <= ?');
      params.push(endDate);
    }

    if (type && (type === 'text_to_model' || type === 'image_to_model')) {
      conditions.push('type = ?');
      params.push(type);
    }

    const whereClause = conditions.join(' AND ');

    const rows = await query<
      Array<{
        task_id: string;
        provider_id: string;
        type: string;
        prompt: string | null;
        credit_cost: number;
        power_cost: number;
        created_at: string;
        status: string;
      }>
    >(
      `SELECT
         task_id,
         provider_id,
         type,
         prompt,
         credit_cost,
         power_cost,
         created_at,
         status
       FROM tasks
       WHERE ${whereClause}
       ORDER BY created_at DESC`,
      params
    );

    res.json({
      data: rows
        .filter((row) => enabledProviderIds.has(row.provider_id))
        .map((r) => {
          const billing = normalizeTaskBilling({
            providerId: r.provider_id,
            creditCost: r.credit_cost,
            powerCost: r.power_cost,
            status: r.status,
          });
          return {
            taskId: r.task_id,
            type: r.type,
            prompt: r.prompt ? r.prompt.slice(0, 50) : null,
            creditsUsed: billing.creditCost,
            powerUsed: billing.powerCost,
            createdAt: r.created_at,
            status: r.status,
          };
        }),
    });
  } catch (err) {
    console.error('[UsageController] GET /usage/history error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}
