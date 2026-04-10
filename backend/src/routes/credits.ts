/**
 * Credits 路由
 *
 * GET /credits/status              — auth（站点共享额度状态）
 * GET /admin/site-power-status     — auth + requirePermission('admin-config')（站点共享额度查询）
 * POST /admin/site-power-recharge  — auth + requirePermission('admin-config')（站点共享额度充值）
 *
 * Legacy user-targeted admin endpoints remain mounted below for backend compatibility
 * during the rollout, but the frontend should no longer call them.
 */

import { Router, RequestHandler } from 'express';
import { auth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { requireRootUser } from '../middleware/rootOnly';
import { getStatusHandler, getAdminStatusHandler, rechargeHandler } from '../controllers/credits';
import {
  getAdminSitePowerStatusHandler,
  getStatusHandler as getSitePowerStatusHandler,
  rechargeSitePowerHandler,
} from '../controllers/sitePower';

const router = Router();

router.post(
  '/admin/recharge',
  auth,
  requirePermission('admin-config'),
  requireRootUser,
  rechargeHandler as unknown as RequestHandler
);
router.get('/credits/status', auth, getSitePowerStatusHandler as unknown as RequestHandler);
router.get(
  '/admin/credits/:userId',
  auth,
  requirePermission('admin-config'),
  requireRootUser,
  getAdminStatusHandler as unknown as RequestHandler
);
router.get(
  '/admin/site-power-status',
  auth,
  requirePermission('admin-config'),
  requireRootUser,
  getAdminSitePowerStatusHandler as unknown as RequestHandler
);
router.post(
  '/admin/site-power-recharge',
  auth,
  requirePermission('admin-config'),
  requireRootUser,
  rechargeSitePowerHandler as unknown as RequestHandler
);

export default router;
