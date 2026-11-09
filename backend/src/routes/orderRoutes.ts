import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireCustomDesignEnabled } from '../config/features';
import { orderLimiter, returnLimiter, trackOrderLimiter } from '../middleware/rateLimiters';
import { 
  createOrder, 
  getOrders, 
  getOrder, 
  cancelOrder,
  cancelOrderItems,
  approveOrderMockup,
  requestOrderRevision,
  regenerateTrackingToken,
  revokeTrackingToken,
  getPublicOrderTracking
} from '../controllers/orderController';
import {
  createReturn,
  getCustomerReturns,
  getOrderReturns,
  getReturnById,
  cancelReturn
} from '../controllers/returnController';
import { getInvoiceByOrder, downloadInvoicePDF } from '../controllers/invoiceController';

const router = Router();

// Public Tracking Endpoint (Unauthenticated, strictly rate-limited & token-validated)
router.get('/public-track/:token', trackOrderLimiter, getPublicOrderTracking);

router.use(requireAuth); // All order routes require authentication

router.route('/')
  .get(getOrders)
  .post(orderLimiter, createOrder);

router.get('/returns', getCustomerReturns);

router.route('/:id')
  .get(getOrder);

router.post('/:id/cancel', cancelOrder);
router.post('/:id/cancel-items', cancelOrderItems);
router.post('/:id/items/:itemId/cancel', cancelOrderItems);
router.post('/:id/items/:itemId/approve-mockup', requireCustomDesignEnabled, approveOrderMockup);
router.post('/:id/items/:itemId/request-revision', requireCustomDesignEnabled, requestOrderRevision);

// Tracking token lifecycle management (authenticated order owner only)
router.post('/:id/tracking-token/regenerate', regenerateTrackingToken);
router.post('/:id/tracking-token/revoke', revokeTrackingToken);

// Order Invoice Endpoints
router.get('/:id/invoice', getInvoiceByOrder);
router.get('/:id/invoice/pdf', downloadInvoicePDF);

// Order-specific returns
router.post('/:id/returns', returnLimiter, createReturn);
router.get('/:id/returns', getOrderReturns);
router.get('/:id/returns/:returnId', getReturnById);
router.post('/:id/returns/:returnId/cancel', cancelReturn);

export default router;
