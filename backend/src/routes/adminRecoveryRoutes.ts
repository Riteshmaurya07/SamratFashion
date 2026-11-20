import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import {
  getRecoveryMetrics,
  triggerRecoveryCycle,
  getUnresolvedHistoricalReturns,
  resolveHistoricalReturnReconciliation
} from '../controllers/adminRecoveryController';

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('ADMIN', 'SUPER_ADMIN'));

router.get('/status', requirePermission('systemHealth', 'view'), getRecoveryMetrics);
router.post('/trigger', requirePermission('systemHealth', 'manage'), triggerRecoveryCycle);
router.get('/returns/unresolved', requirePermission('returns', 'view'), getUnresolvedHistoricalReturns);
router.post('/returns/:id/resolve', requirePermission('returns', 'manage'), resolveHistoricalReturnReconciliation);

export default router;
