import { Router } from 'express';
import { auth } from '../middleware/auth';
import { downloadThumbnail } from '../controllers/thumbnail';

const router = Router();

router.get('/:taskId', auth, (req, res) =>
  downloadThumbnail(req as Parameters<typeof downloadThumbnail>[0], res)
);

export default router;
