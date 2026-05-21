/**
 * Quota routes
 *
 * GET  /credits/status                 — auth（当前用户额度状态）
 * GET  /admin/quota/summary            — auth + requireRootUser
 * PUT  /admin/quota/default-limit      — auth + requireRootUser
 * POST /admin/quota/reset-usage        — auth + requireRootUser
 * GET  /admin/user-quotas              — auth + requireRootUser
 */

import { Router, RequestHandler } from 'express';
import { auth } from '../middleware/auth';
import { requireRootUser } from '../middleware/rootOnly';
import {
  getQuotaStatusHandler,
  getQuotaSummaryHandler,
  listUserQuotasHandler,
  resetUsageHandler,
  updateDefaultLimitHandler,
} from '../controllers/quota';

const router = Router();

router.get('/credits/status', auth, getQuotaStatusHandler as unknown as RequestHandler);
router.get(
  '/admin/quota/summary',
  auth,
  requireRootUser,
  getQuotaSummaryHandler as unknown as RequestHandler
);
router.put(
  '/admin/quota/default-limit',
  auth,
  requireRootUser,
  updateDefaultLimitHandler as unknown as RequestHandler
);
router.post(
  '/admin/quota/reset-usage',
  auth,
  requireRootUser,
  resetUsageHandler as unknown as RequestHandler
);
router.get(
  '/admin/user-quotas',
  auth,
  requireRootUser,
  listUserQuotasHandler as unknown as RequestHandler
);

export default router;
