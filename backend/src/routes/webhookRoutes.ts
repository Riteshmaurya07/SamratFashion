import { Router } from 'express';
import { razorpayWebhook } from '../controllers/webhookController';

const router = Router();

router.post('/razorpay', razorpayWebhook);

export default router;
