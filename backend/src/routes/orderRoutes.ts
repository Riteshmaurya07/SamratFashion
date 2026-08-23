import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { orderLimiter, returnLimiter } from '../middleware/rateLimiters';
import { 
  createOrder, 
  getOrders, 
  getOrder, 
  cancelOrder 
} from '../controllers/orderController';
import {
  createReturn,
  getCustomerReturns,
  getOrderReturns,
  getReturnById,
  cancelReturn
} from '../controllers/returnController';

const router = Router();

router.use(requireAuth); // All order routes require authentication

router.route('/')
  .get(getOrders)
  .post(orderLimiter, createOrder);

router.get('/returns', getCustomerReturns);

router.route('/:id')
  .get(getOrder);

router.post('/:id/cancel', cancelOrder);

// Order-specific returns
router.post('/:id/returns', returnLimiter, createReturn);
router.get('/:id/returns', getOrderReturns);
router.get('/:id/returns/:returnId', getReturnById);
router.post('/:id/returns/:returnId/cancel', cancelReturn);

export default router;
