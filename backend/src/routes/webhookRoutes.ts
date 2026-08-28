import { Router } from 'express';
import { razorpayWebhook } from '../controllers/webhookController';
import { handleLogisticsWebhook } from '../controllers/logisticsWebhookController';

const router = Router();

router.post('/razorpay', razorpayWebhook);
router.post('/logistics', handleLogisticsWebhook);

export default router;
