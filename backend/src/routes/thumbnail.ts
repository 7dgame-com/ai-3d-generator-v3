import { Router } from 'express';
import { auth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { downloadThumbnail } from '../controllers/thumbnail';

const router = Router();

router.get('/:taskId', auth, requirePermission('generate-model'), (req, res) =>
  downloadThumbnail(req as Parameters<typeof downloadThumbnail>[0], res)
);

export default router;
