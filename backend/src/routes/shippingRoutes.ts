import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { 
  checkServiceability, 
  calculateRates, 
  getCustomerTracking 
} from '../controllers/shippingController';

const router = Router();

// Public PIN Code Serviceability & Rates Lookup
router.get('/serviceability', checkServiceability);
router.post('/rates', calculateRates);

// Authenticated Customer Tracking
router.get('/track/:idOrAwb', requireAuth, getCustomerTracking);

export default router;
