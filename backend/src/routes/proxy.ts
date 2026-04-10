import { Router } from 'express';
import { auth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { proxyProviderRequest } from '../controllers/proxy';

const router = Router();

router.post('/:providerId/*', auth, requirePermission('generate-model'), proxyProviderRequest);

export default router;
