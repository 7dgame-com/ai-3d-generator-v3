/**
 * Admin 路由
 *
 * 所有路由均需要：
 *   1. auth 中间件（JWT 验证）
 *   2. requireRootUser 中间件（仅 root 可访问）
 */

import { Router } from 'express';
import { auth } from '../middleware/auth';
import { requireRootUser } from '../middleware/rootOnly';
import { adminRouter } from '../controllers/admin';

const router = Router();

router.use('/admin', auth, requireRootUser, adminRouter);

export default router;
