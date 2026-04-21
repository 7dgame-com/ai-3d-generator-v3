/**
 * Download routes
 *
 * GET /api/download/:taskId  - auth + own task
 */

import { Router } from 'express';
import { auth } from '../middleware/auth';
import { downloadFile } from '../controllers/download';

const router = Router();

router.get('/:taskId', auth, (req, res) =>
  downloadFile(req as Parameters<typeof downloadFile>[0], res)
);

export default router;
