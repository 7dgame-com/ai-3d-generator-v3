/**
 * Usage 路由
 *
 * 所有路由均需要：
 *   1. auth 中间件（JWT 验证）
 *   2. 用户仅能读取自己的使用记录
 */

import { Router, Request, Response } from 'express';
import { auth } from '../middleware/auth';
import { getUsageSummary, getUsageHistory } from '../controllers/usage';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.get(
  '/',
  auth,
  (req: Request, res: Response) => getUsageSummary(req as AuthenticatedRequest, res)
);

router.get(
  '/history',
  auth,
  (req: Request, res: Response) => getUsageHistory(req as AuthenticatedRequest, res)
);

export default router;
