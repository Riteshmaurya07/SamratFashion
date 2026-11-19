import { Router } from 'express';
import { requireOpsSecret } from '../middleware/opsAuth';
import { getPaymentHealth, runRecoveryCycle } from '../controllers/opsController';

const router = Router();

// Operational endpoints are strictly non-cacheable by proxies and CDNs.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// Operational endpoints are authenticated by a shared secret, not a user JWT.
// See security-audit/PAYMENT_OPERATIONS_RUNBOOK.md.
router.use(requireOpsSecret);

router.get('/payments/health', getPaymentHealth);

// L5: Recovery mutations (reconciliation, refund sweeps) are strictly POST-only
router.post('/recovery/run', runRecoveryCycle);

export default router;
