import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { activeQuotaTool } from '../services/quotaToolRegistry';
import { buildQuotaUserSnapshot } from '../services/quotaUserSnapshot';

interface QuotaAdminAccess {
  isRoot: boolean;
}

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

function parsePositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function hasAnyRole(roles: readonly string[] | undefined, expected: readonly string[]): boolean {
  return Array.isArray(roles) && expected.some((role) => roles.includes(role));
}

function resolveQuotaAdminAccess(
  req: AuthenticatedRequest,
  res: Response
): QuotaAdminAccess | null {
  const roles = req.user.roles ?? [];
  const isRoot = hasAnyRole(roles, ['root']);
  const isQuotaManager = hasAnyRole(roles, ['admin', 'manager']);

  if (!isRoot && !isQuotaManager) {
    res.status(403).json({ code: 2003, message: '没有权限执行此操作' });
    return null;
  }

  return { isRoot };
}

function sendQuotaOperationError(res: Response, error: unknown): void {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : NaN;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : 5001;
  const message = error instanceof Error ? error.message : '服务器内部错误';

  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ code, message });
    return;
  }

  res.status(500).json({ code: 5001, message: '服务器内部错误' });
}

export async function getQuotaStatusHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const status = await activeQuotaTool.getUserStatus(req.user.userId, buildQuotaUserSnapshot(req.user));
    res.json({ data: status });
  } catch (error) {
    console.error('[QuotaController] GET /credits/status error:', error);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function getQuotaSummaryHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const access = resolveQuotaAdminAccess(req, res);
  if (!access) {
    return;
  }

  try {
    const summary = await activeQuotaTool.getSummary(null);
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
  if (!resolveQuotaAdminAccess(req, res)) {
    return;
  }

  const limit = normalizeLimit((req.body as { quota_limit?: unknown }).quota_limit);
  if (limit === null) {
    res.status(422).json({ code: 'INVALID_QUOTA_LIMIT', message: 'quota_limit 必须是大于等于 0 的数字' });
    return;
  }

  try {
    await activeQuotaTool.setDefaultLimit(limit);
    const summary = await activeQuotaTool.getSummary(null);
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
  const access = resolveQuotaAdminAccess(req, res);
  if (!access) {
    return;
  }

  const note = typeof req.body?.note === 'string'
    ? req.body.note
    : `admin reset by user ${req.user.userId}`;

  try {
    const result = await activeQuotaTool.resetAllUsage(note, null);
    const summary = await activeQuotaTool.getSummary(null);
    res.json({ success: true, data: { ...result, summary } });
  } catch (error) {
    console.error('[QuotaController] POST /admin/quota/reset-usage error:', error);
    sendQuotaOperationError(res, error);
  }
}

export async function resetUserUsageHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const access = resolveQuotaAdminAccess(req, res);
  if (!access) {
    return;
  }

  const userId = parsePositiveInteger(req.params.userId ?? req.body?.user_id);
  if (userId === undefined) {
    res.status(422).json({ code: 4220, message: 'user_id 必须为正整数' });
    return;
  }

  const note = typeof req.body?.note === 'string'
    ? req.body.note
    : `single user reset by user ${req.user.userId}`;

  try {
    const result = await activeQuotaTool.resetUserUsage(userId, note, {
      organization: null,
      requireLearnerRole: true,
    });
    const summary = await activeQuotaTool.getSummary(null);
    res.json({ success: true, data: { ...result, summary } });
  } catch (error) {
    console.error('[QuotaController] POST /admin/user-quotas/:userId/reset error:', error);
    sendQuotaOperationError(res, error);
  }
}

export async function listUserQuotasHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const access = resolveQuotaAdminAccess(req, res);
  if (!access) {
    return;
  }

  const page = normalizePage(req.query.page, 1);
  const pageSize = Math.min(100, normalizePage(req.query.pageSize, 20));
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  try {
    const usageList = await activeQuotaTool.listUsageStatuses({
      page,
      pageSize,
      search,
      organization: null,
    });

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
