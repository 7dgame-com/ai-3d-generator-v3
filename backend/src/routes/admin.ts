/**
 * Admin 路由
 *
 * 所有路由均需要：
 *   1. auth 中间件（JWT 验证）
 *   2. requirePermission('admin-config') 中间件（权限验证）
 */

import { Router } from 'express';
import { auth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { requireRootUser } from '../middleware/rootOnly';
import { adminRouter } from '../controllers/admin';

const router = Router();

router.use('/admin', auth, requirePermission('admin-config'), requireRootUser, adminRouter);

export default router;
