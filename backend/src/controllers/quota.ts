import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { activeQuotaTool } from '../services/quotaToolRegistry';

function normalizePage(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeLimit(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

export async function getQuotaStatusHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const status = await activeQuotaTool.getUserStatus(req.user.userId);
    res.json({ data: status });
  } catch (error) {
    console.error('[QuotaController] GET /credits/status error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function getQuotaSummaryHandler(
  _req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const summary = await activeQuotaTool.getSummary();
    res.json({ data: summary });
  } catch (error) {
    console.error('[QuotaController] GET /admin/quota/summary error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function updateDefaultLimitHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const limit = normalizeLimit((req.body as { quota_limit?: unknown }).quota_limit);
  if (limit === null) {
    res.status(422).json({ code: 'INVALID_QUOTA_LIMIT', message: 'quota_limit 必须是大于等于 0 的数字' });
    return;
  }

  try {
    await activeQuotaTool.setDefaultLimit(limit);
    const summary = await activeQuotaTool.getSummary();
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('[QuotaController] PUT /admin/quota/default-limit error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function resetUsageHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const note = typeof req.body?.note === 'string'
    ? req.body.note
    : `admin reset by user ${req.user.userId}`;

  try {
    const result = await activeQuotaTool.resetAllUsage(note);
    const summary = await activeQuotaTool.getSummary();
    res.json({ success: true, data: { ...result, summary } });
  } catch (error) {
    console.error('[QuotaController] POST /admin/quota/reset-usage error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function listUserQuotasHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const page = normalizePage(req.query.page, 1);
  const pageSize = Math.min(100, normalizePage(req.query.pageSize, 20));
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  try {
    const usageList = await activeQuotaTool.listUsageStatuses({ page, pageSize, search });

    res.json({
      data: usageList.data.map((quota) => ({
        id: quota.user_id,
        username: quota.user_snapshot?.username,
        nickname: quota.user_snapshot?.nickname,
        email: quota.user_snapshot?.email,
        status: quota.user_snapshot?.status,
        roles: quota.user_snapshot?.roles,
        quota,
      })),
      pagination: usageList.pagination,
    });
  } catch (error: any) {
    console.error('[QuotaController] GET /admin/user-quotas error:', error?.message ?? error);
    res.status(502).json({ code: 3002, message: '查询用户额度失败' });
  }
}
