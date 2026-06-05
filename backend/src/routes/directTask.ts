import { Router } from 'express';
import { auth } from '../middleware/auth';
import { cancelPreparedTask, completeTask, failTask, prepareTask, registerTask } from '../controllers/directTask';

const router = Router();

router.post('/prepare', auth, prepareTask);
router.post('/prepare/cancel', auth, cancelPreparedTask);
router.post('/register', auth, registerTask);
router.post('/:taskId/complete', auth, completeTask);
router.post('/:taskId/fail', auth, failTask);

export default router;
