/**
 * Task routes
 *
 * Auth-only routes for self-scoped task resources.
 */

import { Router } from 'express';
import { auth } from '../middleware/auth';
import { cancelTask, createTask, listTasks, getTask, getDownloadUrl, updateTaskResource } from '../controllers/task';

const router = Router();

// Provider credentials stay on the server.  This is the canonical task
// creation path; the worker polls the provider and settles billing afterwards.
router.post('/', auth, createTask);
router.get('/', auth, listTasks);

// download-url must be registered before /:taskId to avoid param capture
router.get('/:taskId/download-url', auth, getDownloadUrl);
router.get('/:taskId', auth, getTask);
router.delete('/:taskId', auth, cancelTask);

router.put('/:taskId/resource', auth, updateTaskResource);

export default router;
