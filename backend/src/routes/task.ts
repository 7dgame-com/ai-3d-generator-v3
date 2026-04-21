/**
 * Task routes
 *
 * Auth-only routes for self-scoped task resources.
 */

import { Router } from 'express';
import { auth } from '../middleware/auth';
import { listTasks, getTask, getDownloadUrl, updateTaskResource } from '../controllers/task';

const router = Router();

router.get('/', auth, listTasks);

// download-url must be registered before /:taskId to avoid param capture
router.get('/:taskId/download-url', auth, getDownloadUrl);
router.get('/:taskId', auth, getTask);

router.put('/:taskId/resource', auth, updateTaskResource);

export default router;
