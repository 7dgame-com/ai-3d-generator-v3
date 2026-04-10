/**
 * Credits 路由
 *
 * GET /credits/status              — auth（当前用户额度状态）
 * GET /admin/credits/:userId       — auth + requirePermission('admin-config')（管理员查询）
 * POST /admin/recharge             — auth + requirePermission('admin-config')（管理员充值）
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
