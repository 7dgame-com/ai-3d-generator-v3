/**
 * Quota routes
 *
 * GET  /credits/status                 — auth（当前用户额度状态）
 * GET  /admin/quota/summary            — auth + root 或同组织 admin/manager
 * PUT  /admin/quota/default-limit      — auth + root 或同组织 admin/manager
 * POST /admin/quota/reset-usage        — auth + root 或同组织 admin/manager
 * POST /admin/user-quotas/:userId/reset — auth + root 或同组织 admin/manager
 * GET  /admin/user-quotas              — auth + root 或同组织 admin/manager
 */

import { Router, RequestHandler } from 'express';
import { auth } from '../middleware/auth';
import {
  getQuotaStatusHandler,
  getQuotaSummaryHandler,
  listUserQuotasHandler,
  resetUsageHandler,
  resetUserUsageHandler,
  updateDefaultLimitHandler,
} from '../controllers/quota';

const router = Router();

router.get('/credits/status', auth, getQuotaStatusHandler as unknown as RequestHandler);
router.get(
  '/admin/quota/summary',
  auth,
  getQuotaSummaryHandler as unknown as RequestHandler
);
router.put(
  '/admin/quota/default-limit',
  auth,
  updateDefaultLimitHandler as unknown as RequestHandler
);
router.post(
  '/admin/quota/reset-usage',
  auth,
  resetUsageHandler as unknown as RequestHandler
);
router.post(
  '/admin/user-quotas/:userId/reset',
  auth,
  resetUserUsageHandler as unknown as RequestHandler
);
router.get(
  '/admin/user-quotas',
  auth,
  listUserQuotasHandler as unknown as RequestHandler
);

export default router;
