import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { requireCustomDesignEnabled } from '../config/features';
import { refundLimiter, returnLimiter } from '../middleware/rateLimiters';
import { 
  getDashboardMetrics, 
  getDashboardTrend,
  getOrders,
  bulkUpdateOrderStatus,
  getOrderById,
  updateOrderStatus,
  adminCancelOrder,
  adminCancelOrderItems,
} from '../controllers/adminController';

import { 
  getCustomers,
  exportCustomersCSV,
  getCustomerById,
  updateCustomerStatus
} from '../controllers/adminCustomerController';
import { initiateRefund, getOrderRefunds, syncOrderRefunds } from '../controllers/refundController';
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
  createOrderCourierQuote,
  getLatestOrderCourierQuote,
  getCourierQuoteById
} from '../controllers/courierQuoteController';
import { 
  getAdminReturns, 
  getAdminReturnById, 
  approveReturn, 
  rejectReturn, 
  receiveReturn, 
  inspectReturn, 
  acceptReturn, 
  rejectReturnAfterInspection,
  getReverseCourierQuotes,
  bookReversePickup,
  manualReturnShipping,
  getReturnReverseShipment
} from '../controllers/returnController';

import { 
  updateAdminCustomDesignStatus,
  generateProductionAssets
} from '../controllers/adminCustomDesignController';

import { getAdminDiagnostics } from '../controllers/healthController';
import * as adminCouponController from '../controllers/adminCouponController';
import { exportOrdersPDF } from '../controllers/adminOrderExportController';
import {
  getAdminStoreSettings,
  updateAdminStoreSettings,
} from '../controllers/storeSettingsController';
import { getMyPermissions } from '../controllers/adminTeamController';

const router = express.Router();

// All routes require authentication and Admin/Super Admin role
router.use(requireAuth);
router.use(requireRole('ADMIN', 'SUPER_ADMIN'));

// My Permissions (available to all authenticated admins/super-admins)
router.get('/me/permissions', getMyPermissions);

// Diagnostics
router.get('/diagnostics', requirePermission('systemHealth', 'view'), getAdminDiagnostics);

// Store settings
router.get('/settings', requirePermission('settings', 'view'), getAdminStoreSettings);
router.put('/settings', requirePermission('settings', 'manage', 'canManageSettings'), updateAdminStoreSettings);

// Dashboard
router.get('/dashboard', requirePermission('dashboard', 'view'), getDashboardMetrics);
router.get('/dashboard/trend', requirePermission('dashboard', 'view'), getDashboardTrend);

import { uploadStaffMockup } from '../controllers/adminCustomOrderController';
import { getCreditNotesByOrder } from '../controllers/invoiceController';

// Orders
router.get('/orders/export/pdf', requirePermission('orders', 'view'), exportOrdersPDF);
router.get('/orders', requirePermission('orders', 'view'), getOrders);
router.patch('/orders/bulk-status', requirePermission('orders', 'manage'), bulkUpdateOrderStatus);
router.get('/orders/:id', requirePermission('orders', 'view'), getOrderById);
router.patch('/orders/:id/status', requirePermission('orders', 'manage'), updateOrderStatus);
router.post('/orders/:id/cancel', requirePermission('orders', 'manage', 'canRefund'), adminCancelOrder);
router.post('/orders/:id/cancel-items', requirePermission('orders', 'manage', 'canRefund'), adminCancelOrderItems);
router.post('/orders/:id/items/:itemId/mockup', requireCustomDesignEnabled, requirePermission('orders', 'manage'), uploadStaffMockup);
router.post('/orders/:id/refund', refundLimiter, requirePermission('orders', 'manage', 'canRefund'), initiateRefund);
router.get('/orders/:id/refunds', requirePermission('orders', 'view'), getOrderRefunds);
router.post('/orders/:id/refunds/sync', requirePermission('orders', 'manage', 'canRefund'), syncOrderRefunds);
router.get('/orders/:id/credit-notes', requirePermission('orders', 'view'), getCreditNotesByOrder);

import { 
  getFulfillment,
  allocateOrder,
  pickFulfillment,
  packFulfillment,
  getPackingSlipPDF,
  qcCheckFulfillment,
  markReadyToShip,
  confirmFulfillmentPackage
} from '../controllers/fulfillmentController';

// Fulfillment / Warehouse Ops
router.get('/orders/:id/fulfillment', requirePermission('orders', 'view'), getFulfillment);
router.post('/orders/:id/fulfillment/allocate', requirePermission('orders', 'manage'), allocateOrder);
router.post('/orders/:id/fulfillment/pick', requirePermission('orders', 'manage'), pickFulfillment);
router.post('/orders/:id/fulfillment/pack', requirePermission('orders', 'manage'), packFulfillment);
router.get('/orders/:id/fulfillment/packing-slip', requirePermission('orders', 'view'), getPackingSlipPDF);
router.post('/orders/:id/fulfillment/qc', requirePermission('orders', 'manage'), qcCheckFulfillment);
router.post('/orders/:id/fulfillment/ready-to-ship', requirePermission('orders', 'manage'), markReadyToShip);
router.post('/orders/:id/fulfillment/package-details', requirePermission('orders', 'manage'), confirmFulfillmentPackage);

// Fulfillment / Shipments
router.get('/orders/:id/shipment', requirePermission('orders', 'view'), getShipment);
router.post('/orders/:id/shipment', requirePermission('orders', 'manage'), createShipment);
router.patch('/orders/:id/shipment', requirePermission('orders', 'manage'), updateShipment);
router.get('/orders/:id/shipment/label', requirePermission('orders', 'view'), getShippingLabel);
router.post('/orders/:id/shipment/pickup', requirePermission('orders', 'manage'), requestPickup);
router.post('/orders/:id/shipment/tracking/refresh', requirePermission('orders', 'manage'), refreshTracking);
router.post('/orders/:id/shipment/cancel', requirePermission('orders', 'manage'), cancelShipment);

// Multi-Courier Rate Comparison (NimbusPost)
router.post('/orders/:id/courier-quotes', requirePermission('orders', 'manage'), createOrderCourierQuote);
router.get('/orders/:id/courier-quotes/latest', requirePermission('orders', 'view'), getLatestOrderCourierQuote);
router.get('/courier-quotes/:quoteId', requirePermission('orders', 'view'), getCourierQuoteById);

// Returns
router.get('/returns', requirePermission('returns', 'view'), getAdminReturns);
router.get('/returns/:id', requirePermission('returns', 'view'), getAdminReturnById);
router.post('/returns/:id/approve', returnLimiter, requirePermission('returns', 'manage'), approveReturn);
router.post('/returns/:id/reject', returnLimiter, requirePermission('returns', 'manage'), rejectReturn);
router.post('/returns/:id/receive', returnLimiter, requirePermission('returns', 'manage'), receiveReturn);
router.post('/returns/:id/inspect', returnLimiter, requirePermission('returns', 'manage'), inspectReturn);
router.post('/returns/:id/accept', returnLimiter, requirePermission('returns', 'manage'), acceptReturn);
router.post('/returns/:id/reject-after-inspection', returnLimiter, requirePermission('returns', 'manage'), rejectReturnAfterInspection);
router.post('/returns/:id/reverse-quotes', requirePermission('returns', 'manage'), getReverseCourierQuotes);
router.post('/returns/:id/book-reverse-pickup', requirePermission('returns', 'manage'), bookReversePickup);
router.post('/returns/:id/manual-shipping', requirePermission('returns', 'manage'), manualReturnShipping);
router.get('/returns/:id/reverse-shipment', requirePermission('returns', 'view'), getReturnReverseShipment);

// Admin Custom Orders (GET / and GET /:id live in adminCustomOrderRoutes, mounted
// BEFORE this router so they keep the admin page's expected response shape).
router.put('/custom-orders/:id/status', requireCustomDesignEnabled, requirePermission('customOrders', 'manage'), updateAdminCustomDesignStatus);
router.post('/custom-orders/:id/generate-assets', requireCustomDesignEnabled, requirePermission('customOrders', 'manage'), generateProductionAssets);

// Customers
router.get('/customers/export', requirePermission('customers', 'view'), exportCustomersCSV);
router.get('/customers', requirePermission('customers', 'view'), getCustomers);
router.get('/customers/:id', requirePermission('customers', 'view'), getCustomerById);
router.patch('/customers/:id/status', requirePermission('customers', 'manage', 'canSuspendUsers'), updateCustomerStatus);

// Coupons (Admin)
router.get('/coupons', requirePermission('coupons', 'view'), adminCouponController.getAdminCoupons);
router.post('/coupons', refundLimiter, requirePermission('coupons', 'manage', 'canManageCoupons'), adminCouponController.createCoupon);
router.get('/coupons/:id', requirePermission('coupons', 'view'), adminCouponController.getAdminCouponById);
router.put('/coupons/:id', refundLimiter, requirePermission('coupons', 'manage', 'canManageCoupons'), adminCouponController.updateCoupon);
router.patch('/coupons/:id/status', refundLimiter, requirePermission('coupons', 'manage', 'canManageCoupons'), adminCouponController.updateCouponStatus);

// Operations & Reporting Endpoints
import {
  getAdminInvoices,
  exportAdminInvoicesCsv,
  getAdminInventoryLedger,
  getAdminAuditLogs,
  getAdminNotifications,
  resendAdminNotification,
  getAdminPaymentAttempts,
  getAdminPaymentReconciliationQueue,
  getAdminWebhooks,
  retryAdminWebhook,
  resolveAdminWebhook,
  clearPaymentReconciliation,
  triggerLogCleanup
} from '../controllers/adminOperationsController';

router.get('/invoices/export', requirePermission('invoices', 'view'), exportAdminInvoicesCsv);
router.get('/invoices', requirePermission('invoices', 'view'), getAdminInvoices);
router.get('/inventory-ledger', requirePermission('inventoryLedger', 'view'), getAdminInventoryLedger);
router.get('/audit-logs', requirePermission('auditLogs', 'view'), getAdminAuditLogs);
router.get('/notifications', requirePermission('notifications', 'view'), getAdminNotifications);
router.post('/notifications/:id/resend', refundLimiter, requirePermission('notifications', 'manage'), resendAdminNotification);
router.get('/payment-attempts', requirePermission('paymentDiagnostics', 'view'), getAdminPaymentAttempts);
router.get('/payment-reconciliation', requirePermission('paymentReconciliation', 'view'), getAdminPaymentReconciliationQueue);
router.post('/payments/:id/clear-reconciliation', refundLimiter, requirePermission('paymentReconciliation', 'manage'), clearPaymentReconciliation);
router.post('/payments/:paymentId/clear-reconciliation', refundLimiter, requirePermission('paymentReconciliation', 'manage'), clearPaymentReconciliation);
router.get('/webhooks', requirePermission('webhooks', 'view'), getAdminWebhooks);
router.post('/webhooks/:id/retry', refundLimiter, requirePermission('webhooks', 'manage', 'canManageWebhooks'), retryAdminWebhook);
router.post('/webhooks/:id/resolve', refundLimiter, requirePermission('webhooks', 'manage', 'canManageWebhooks'), resolveAdminWebhook);
router.post('/maintenance/cleanup-logs', requirePermission('systemHealth', 'manage'), triggerLogCleanup);

export default router;
