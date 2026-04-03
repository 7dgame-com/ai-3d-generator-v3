/**
 * Task routes
 *
 * Permissions:
 *   POST   /backend/tasks                      - generate-model
 *   GET    /backend/tasks                      - generate-model
 *   GET    /backend/tasks/:taskId              - generate-model
 *   GET    /backend/tasks/:taskId/download-url - download-model
 *   PUT    /backend/tasks/:taskId/resource     - upload-to-main
 */

import { Router } from 'express';
import { auth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { createTask, listTasks, getTask, getDownloadUrl, updateTaskResource } from '../controllers/task';

const router = Router();

router.post('/', auth, requirePermission('generate-model'), createTask);
router.get('/', auth, requirePermission('generate-model'), listTasks);

// download-url must be registered before /:taskId to avoid param capture
router.get('/:taskId/download-url', auth, requirePermission('download-model'), getDownloadUrl);
router.get('/:taskId', auth, requirePermission('generate-model'), getTask);

router.put('/:taskId/resource', auth, requirePermission('upload-to-main'), updateTaskResource);

export default router;
