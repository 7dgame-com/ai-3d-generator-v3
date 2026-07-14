import { NextFunction, Request, Response, Router } from 'express';
import { auth } from '../middleware/auth';
import { cancelPreparedTask, completeTask, failTask, prepareTask, registerTask } from '../controllers/directTask';
import type { AuthenticatedRequest } from '../middleware/auth';
import { isUnifiedQueueEnabledForUser } from '../services/queueRollout';

const router = Router();

export function rejectLegacyCreationWhenQueueEnabled(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as AuthenticatedRequest).user?.userId;
  if (!Number.isSafeInteger(userId) || !isUnifiedQueueEnabledForUser(Number(userId))) {
    next();
    return;
  }
  res.status(409).json({
    code: 'LEGACY_DIRECT_CREATION_DISABLED',
    message: '统一供应商队列已启用，请使用 POST /tasks 创建任务',
  });
}

router.post('/prepare', auth, rejectLegacyCreationWhenQueueEnabled, prepareTask);
router.post('/prepare/cancel', auth, cancelPreparedTask);
router.post('/register', auth, rejectLegacyCreationWhenQueueEnabled, registerTask);
router.post('/:taskId/complete', auth, completeTask);
router.post('/:taskId/fail', auth, failTask);

export default router;
