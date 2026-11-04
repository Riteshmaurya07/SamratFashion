import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  getRecoveryMetrics,
  triggerRecoveryCycle,
  getUnresolvedHistoricalReturns,
  resolveHistoricalReturnReconciliation
} from '../controllers/adminRecoveryController';

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('ADMIN', 'SUPER_ADMIN'));

router.get('/status', getRecoveryMetrics);
router.post('/trigger', triggerRecoveryCycle);
router.get('/returns/unresolved', getUnresolvedHistoricalReturns);
router.post('/returns/:id/resolve', resolveHistoricalReturnReconciliation);

export default router;
