import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { paymentLimiter } from '../middleware/rateLimiters';
import { createPaymentOrder, verifyPayment, getPaymentStatus } from '../controllers/paymentController';

const router = Router();

router.use(requireAuth);

router.post('/create-order', paymentLimiter, createPaymentOrder);
router.post('/verify', paymentLimiter, verifyPayment);
router.get('/order/:orderId', getPaymentStatus);

export default router;
