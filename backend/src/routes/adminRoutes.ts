import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { refundLimiter, returnLimiter } from '../middleware/rateLimiters';
import { 
  getDashboardMetrics, 
  getOrders, 
  getOrderById, 
  updateOrderStatus,
  adminCancelOrder
} from '../controllers/adminController';

import { 
  getCustomers, 
  getCustomerById, 
  updateCustomerStatus 
} from '../controllers/adminCustomerController';
import { initiateRefund, getOrderRefunds } from '../controllers/refundController';
import { 
  getShipment, 
  createShipment, 
  updateShipment, 
  getShippingLabel, 
  requestPickup, 
  refreshTracking, 
  cancelShipment 
} from '../controllers/shipmentController';
import { 
  getAdminReturns, 
  getAdminReturnById, 
  approveReturn, 
  rejectReturn, 
  receiveReturn, 
  inspectReturn, 
  acceptReturn, 
  rejectReturnAfterInspection 
} from '../controllers/returnController';

import { 
  updateAdminCustomDesignStatus,
  generateProductionAssets
} from '../controllers/adminCustomDesignController';

import { getAdminDiagnostics } from '../controllers/healthController';
import * as adminCouponController from '../controllers/adminCouponController';

const router = express.Router();

// All routes require authentication and Admin/Super Admin role
router.use(requireAuth);
router.use(requireRole('ADMIN', 'SUPER_ADMIN'));

// Diagnostics
router.get('/diagnostics', getAdminDiagnostics);

// Dashboard
router.get('/dashboard', getDashboardMetrics);

import { uploadStaffMockup } from '../controllers/adminCustomOrderController';

// Orders
router.get('/orders', getOrders);
router.get('/orders/:id', getOrderById);
router.patch('/orders/:id/status', updateOrderStatus);
router.post('/orders/:id/cancel', adminCancelOrder);
router.post('/orders/:id/items/:itemId/mockup', uploadStaffMockup);
router.post('/orders/:id/refund', refundLimiter, initiateRefund);
router.get('/orders/:id/refunds', getOrderRefunds);

import { 
  getFulfillment,
  allocateOrder,
  pickFulfillment,
  packFulfillment,
  getPackingSlipPDF,
  qcCheckFulfillment,
  markReadyToShip
} from '../controllers/fulfillmentController';

// Fulfillment / Warehouse Ops
router.get('/orders/:id/fulfillment', getFulfillment);
router.post('/orders/:id/fulfillment/allocate', allocateOrder);
router.post('/orders/:id/fulfillment/pick', pickFulfillment);
router.post('/orders/:id/fulfillment/pack', packFulfillment);
router.get('/orders/:id/fulfillment/packing-slip', getPackingSlipPDF);
router.post('/orders/:id/fulfillment/qc', qcCheckFulfillment);
router.post('/orders/:id/fulfillment/ready-to-ship', markReadyToShip);

// Fulfillment / Shipments
router.get('/orders/:id/shipment', getShipment);
router.post('/orders/:id/shipment', createShipment);
router.patch('/orders/:id/shipment', updateShipment);
router.get('/orders/:id/shipment/label', getShippingLabel);
router.post('/orders/:id/shipment/pickup', requestPickup);
router.post('/orders/:id/shipment/tracking/refresh', refreshTracking);
router.post('/orders/:id/shipment/cancel', cancelShipment);

// Returns
router.get('/returns', getAdminReturns);
router.get('/returns/:id', getAdminReturnById);
router.post('/returns/:id/approve', returnLimiter, approveReturn);
router.post('/returns/:id/reject', returnLimiter, rejectReturn);
router.post('/returns/:id/receive', returnLimiter, receiveReturn);
router.post('/returns/:id/inspect', returnLimiter, inspectReturn);
router.post('/returns/:id/accept', returnLimiter, acceptReturn);
router.post('/returns/:id/reject-after-inspection', returnLimiter, rejectReturnAfterInspection);

// Admin Custom Orders (GET / and GET /:id live in adminCustomOrderRoutes, mounted
// BEFORE this router so they keep the admin page's expected response shape).
router.put('/custom-orders/:id/status', updateAdminCustomDesignStatus);
router.post('/custom-orders/:id/generate-assets', generateProductionAssets);

// Customers
router.get('/customers', getCustomers);
router.get('/customers/:id', getCustomerById);
router.patch('/customers/:id/status', updateCustomerStatus);

// Coupons (Admin)
router.get('/coupons', adminCouponController.getAdminCoupons);
router.post('/coupons', refundLimiter, adminCouponController.createCoupon);
router.get('/coupons/:id', adminCouponController.getAdminCouponById);
router.put('/coupons/:id', refundLimiter, adminCouponController.updateCoupon);
router.patch('/coupons/:id/status', refundLimiter, adminCouponController.updateCouponStatus);

export default router;
