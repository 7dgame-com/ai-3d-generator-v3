/**
 * Admin 路由
 *
 * Provider 列表是生成页启动数据，登录用户可读取。
 * 其余 admin 路由均需要 auth + requireRootUser。
 */

import { Router, RequestHandler } from 'express';
import { auth } from '../middleware/auth';
import { requireRootUser } from '../middleware/rootOnly';
import { adminRouter, getProvidersHandler } from '../controllers/admin';

const router = Router();

router.get('/admin/providers', auth, getProvidersHandler as unknown as RequestHandler);
router.use('/admin', auth, requireRootUser, adminRouter);

export default router;
