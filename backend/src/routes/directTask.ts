import { Router } from 'express';
import { auth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { completeTask, failTask, prepareTask, registerTask } from '../controllers/directTask';

const router = Router();

router.post('/prepare', auth, requirePermission('generate-model'), prepareTask);
router.post('/register', auth, requirePermission('generate-model'), registerTask);
router.post('/:taskId/complete', auth, requirePermission('generate-model'), completeTask);
router.post('/:taskId/fail', auth, requirePermission('generate-model'), failTask);

export default router;
