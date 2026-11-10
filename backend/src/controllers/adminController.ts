import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { Order } from '../models/Order';
import { Product } from '../models/Product';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund } from '../models/Refund';
import { AuditLog } from '../models/AuditLog';
import { cancelOrderWithRefund, cancelOrderItemsWithRefund } from '../services/orderCancellationService';
import { AppError } from '../utils/AppError';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function handleControllerError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  res.status(500).json({ success: false, message });
}



export const getDashboardMetrics = async (req: AuthRequest, res: Response) => {
  try {
    const [orderMetrics, lowStockData] = await Promise.all([
      Order.aggregate([
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            pendingOrders: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } },
            confirmedOrders: { $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, 1, 0] } },
            processingOrders: { $sum: { $cond: [{ $eq: ["$status", "PROCESSING"] }, 1, 0] } },
            shippedOrders: { $sum: { $cond: [{ $eq: ["$status", "SHIPPED"] }, 1, 0] } },
            deliveredOrders: { $sum: { $cond: [{ $eq: ["$status", "DELIVERED"] }, 1, 0] } },
            cancelledOrders: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
            paidOrders: { $sum: { $cond: [{ $eq: ["$paymentStatus", "PAID"] }, 1, 0] } },
            failedPayments: { $sum: { $cond: [{ $eq: ["$paymentStatus", "FAILED"] }, 1, 0] } },
            revenue: { $sum: { $cond: [{ $eq: ["$paymentStatus", "PAID"] }, "$total", 0] } },
          },
        },
      ]),
      Product.aggregate([
        { $unwind: "$variants" },
        { $match: { "variants.stock": { $lt: 5 } } },
        { $count: "lowStockCount" },
      ]),
    ]);

    const m = orderMetrics[0] || {
      totalOrders: 0,
      pendingOrders: 0,
      confirmedOrders: 0,
      processingOrders: 0,
      shippedOrders: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
      paidOrders: 0,
      failedPayments: 0,
      revenue: 0,
    };

    const lowStockProductsCount = lowStockData[0]?.lowStockCount || 0;

    res.status(200).json({
      success: true,
      data: {
        totalOrders: m.totalOrders,
        pendingOrders: m.pendingOrders,
        confirmedOrders: m.confirmedOrders,
        processingOrders: m.processingOrders,
        shippedOrders: m.shippedOrders,
        deliveredOrders: m.deliveredOrders,
        cancelledOrders: m.cancelledOrders,
        paidOrders: m.paidOrders,
        failedPayments: m.failedPayments,
        revenue: m.revenue,
        lowStockProducts: lowStockProductsCount,
      },
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const getOrders = async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const skip = (page - 1) * limit;

    const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 64) : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const paymentStatus = typeof req.query.paymentStatus === 'string' ? req.query.paymentStatus.trim() : '';

    const query: Record<string, unknown> = {};
    if (rawSearch) {
      const safeSearchRegex = escapeRegex(rawSearch);
      const digitsOnly = rawSearch.replace(/\D/g, '');

      const userOrClauses: Record<string, unknown>[] = [
        { name: { $regex: safeSearchRegex, $options: 'i' } },
        { email: { $regex: safeSearchRegex, $options: 'i' } },
      ];

      if (digitsOnly.length >= 5) {
        userOrClauses.push({ phone: { $regex: escapeRegex(digitsOnly), $options: 'i' } });
        if (digitsOnly.length === 10) {
          userOrClauses.push({ phone: { $regex: escapeRegex(`+91${digitsOnly}`), $options: 'i' } });
          userOrClauses.push({ phone: { $regex: escapeRegex(`91${digitsOnly}`), $options: 'i' } });
          userOrClauses.push({ phone: { $regex: escapeRegex(`0${digitsOnly}`), $options: 'i' } });
        }
      }

      const matchingUsers = await User.find({ $or: userOrClauses }).select('_id');
      const userIds = matchingUsers.map((u) => u._id);

      const orderOrClauses: Record<string, unknown>[] = [
        { orderNumber: { $regex: safeSearchRegex, $options: 'i' } },
        { 'shippingAddress.fullName': { $regex: safeSearchRegex, $options: 'i' } },
        { 'shippingAddress.city': { $regex: safeSearchRegex, $options: 'i' } },
      ];

      if (digitsOnly.length >= 5) {
        orderOrClauses.push({ 'shippingAddress.phone': { $regex: escapeRegex(digitsOnly), $options: 'i' } });
        if (digitsOnly.length === 10) {
          orderOrClauses.push({ 'shippingAddress.phone': { $regex: escapeRegex(`+91${digitsOnly}`), $options: 'i' } });
          orderOrClauses.push({ 'shippingAddress.phone': { $regex: escapeRegex(`91${digitsOnly}`), $options: 'i' } });
        }
      }

      if (userIds.length > 0) {
        orderOrClauses.push({ userId: { $in: userIds } });
      }

      query.$or = orderOrClauses;
    }

    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const sortField = (req.query.sortField as string) || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const allowedSortFields = ['createdAt', 'total', 'orderNumber'];
    const finalSortField = allowedSortFields.includes(sortField) ? sortField : 'createdAt';

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [orders, total, summaryAgg] = await Promise.all([
      Order.find(query)
        .sort({ [finalSortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email phone')
        .populate({ path: 'items.productId', select: 'name slug images' }),
      Order.countDocuments(query),
      Order.aggregate([
        {
          $facet: {
            totalOrders: [{ $count: "count" }],
            todayOrders: [
              { $match: { createdAt: { $gte: startOfToday } } },
              { $count: "count" }
            ],
            processingOrders: [
              { $match: { status: "PROCESSING" } },
              { $count: "count" }
            ],
            awaitingPaymentOrders: [
              { $match: { paymentStatus: "PENDING" } },
              { $count: "count" }
            ],
            shippedOrders: [
              { $match: { status: "SHIPPED" } },
              { $count: "count" }
            ]
          }
        }
      ])
    ]);

    const firstFacet = summaryAgg?.[0];
    const summary = {
      totalOrders: firstFacet?.totalOrders?.[0]?.count || 0,
      todayOrders: firstFacet?.todayOrders?.[0]?.count || 0,
      processingOrders: firstFacet?.processingOrders?.[0]?.count || 0,
      awaitingPaymentOrders: firstFacet?.awaitingPaymentOrders?.[0]?.count || 0,
      shippedOrders: firstFacet?.shippedOrders?.[0]?.count || 0,
    };

    // Enrich the 10 fetched orders with authoritative financial payment and refund records
    const orderIds = orders.map((o) => o._id);
    const [payments, refunds] = await Promise.all([
      Payment.find({ orderId: { $in: orderIds } })
        .select('orderId amount refundedAmount pendingRefundAmount status provider')
        .lean(),
      Refund.find({ orderId: { $in: orderIds } })
        .select('orderId amount status createdAt failureReason')
        .lean(),
    ]);

    const paymentMap = new Map(payments.map((p) => [p.orderId.toString(), p]));
    const refundMap = new Map<string, typeof refunds>();
    for (const r of refunds) {
      const k = r.orderId.toString();
      const arr = refundMap.get(k) || [];
      arr.push(r);
      refundMap.set(k, arr);
    }

    const enrichedOrders = orders.map((order) => {
      const ordObj = order.toObject();
      const ordIdStr = order._id.toString();
      const pay = paymentMap.get(ordIdStr);
      const ordRefunds = refundMap.get(ordIdStr) || [];

      let settledPaise = 0;
      let pendingPaise = 0;
      let failedPaise = 0;

      for (const ref of ordRefunds) {
        const amtPaise = Math.round((ref.amount || 0) * 100);
        if (ref.status === 'PROCESSED') {
          settledPaise += amtPaise;
        } else if (['PENDING', 'PROCESSING', 'UNKNOWN'].includes(ref.status)) {
          pendingPaise += amtPaise;
        } else if (ref.status === 'FAILED') {
          failedPaise += amtPaise;
        }
      }

      const originalPaid = pay?.amount ?? (order.initialTotal ?? order.total);

      return {
        ...ordObj,
        financialSummary: {
          originalPaid: Math.round(originalPaid * 100) / 100,
          activeOrderTotal: order.total,
          refundInitiated: (settledPaise + pendingPaise + failedPaise) / 100,
          refundSettled: settledPaise / 100,
          refundPending: pendingPaise / 100,
          refundFailed: failedPaise / 100,
          hasPendingRefund: pendingPaise > 0,
          hasFailedRefund: failedPaise > 0,
        }
      };
    });

    res.status(200).json({
      success: true,
      data: {
        items: enrichedOrders,
        summary,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: unknown) {
    handleControllerError(res, error);
  }
};

export const bulkUpdateOrderStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);

    const { orderIds, status } = req.body;
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      throw new AppError('orderIds must be a non-empty array of valid order IDs', 400);
    }

    const MAX_BULK_LIMIT = 50;
    if (orderIds.length > MAX_BULK_LIMIT) {
      throw new AppError(`Bulk status update is limited to a maximum of ${MAX_BULK_LIMIT} orders per request`, 400);
    }

    if (status === 'SHIPPED') {
      throw new AppError('Bulk status update to SHIPPED is not allowed. Orders must be dispatched through the courier shipment workflow.', 400);
    }
    if (status === 'DELIVERED') {
      throw new AppError('Bulk status update to DELIVERED is not allowed. Delivery confirmation requires carrier tracking scans or delivery verification.', 400);
    }
    if (status === 'CANCELLED') {
      throw new AppError('Bulk cancellation is not allowed. Orders must be cancelled individually to ensure stock and refund integrity.', 400);
    }

    const ALLOWED_BULK_STATUSES = ['CONFIRMED', 'PROCESSING'];
    if (!status || !ALLOWED_BULK_STATUSES.includes(status)) {
      throw new AppError(`Invalid status: "${status}". Bulk update allows: ${ALLOWED_BULK_STATUSES.join(', ')}`, 400);
    }

    // Deduplicate order IDs
    const uniqueOrderIds = Array.from(new Set(orderIds.map((id) => String(id).trim())));

    const successes: Array<{
      orderId: string;
      orderNumber?: string;
      previousStatus: string;
      newStatus: string;
    }> = [];

    const failures: Array<{
      orderId: string;
      orderNumber?: string;
      reason: string;
    }> = [];

    const batchId = new mongoose.Types.ObjectId().toString();

    // Process each order with order-specific validation, business rules, and atomic concurrency protection
    for (const idStr of uniqueOrderIds) {
      if (!mongoose.Types.ObjectId.isValid(idStr)) {
        failures.push({
          orderId: idStr,
          reason: 'Invalid order ID format',
        });
        continue;
      }

      const order = await Order.findById(idStr);
      if (!order) {
        failures.push({
          orderId: idStr,
          reason: 'Order not found',
        });
        continue;
      }

      if (order.status === 'CANCELLED') {
        failures.push({
          orderId: idStr,
          orderNumber: order.orderNumber,
          reason: 'Cannot update cancelled order',
        });
        continue;
      }

      if (order.paymentStatus === 'REFUNDED') {
        failures.push({
          orderId: idStr,
          orderNumber: order.orderNumber,
          reason: 'Cannot update refunded order',
        });
        continue;
      }

      if (status === 'CONFIRMED') {
        if (order.status !== 'PENDING') {
          failures.push({
            orderId: idStr,
            orderNumber: order.orderNumber,
            reason: `Cannot confirm order from ${order.status} status (must be PENDING)`,
          });
          continue;
        }
      } else if (status === 'PROCESSING') {
        if (order.status !== 'CONFIRMED') {
          failures.push({
            orderId: idStr,
            orderNumber: order.orderNumber,
            reason: `Cannot move to processing from ${order.status} status (must be CONFIRMED)`,
          });
          continue;
        }

        // Custom print check: Ensure all customized items have customer mockup approval
        const hasUnapprovedCustom = (order.items || []).some(
          (item) => (item.isCustomized || item.customDesignId) &&
            item.approvalStatus &&
            !['approved', 'in_production'].includes(item.approvalStatus)
        );

        if (hasUnapprovedCustom) {
          failures.push({
            orderId: idStr,
            orderNumber: order.orderNumber,
            reason: 'Order contains custom items awaiting customer design approval',
          });
          continue;
        }
      }

      const previousStatus = order.status;
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: previousStatus },
        { $set: { status, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );

      if (!updated) {
        failures.push({
          orderId: idStr,
          orderNumber: order.orderNumber,
          reason: 'Order status changed concurrently. Please retry.',
        });
        continue;
      }

      try {
        await AuditLog.create({
          actorId: req.user.id,
          actorRole: req.user.role || 'ADMIN',
          action: 'ADMIN_ORDER_STATUS_CHANGED',
          entityType: 'ORDER',
          entityId: order._id,
          metadata: {
            previousStatus,
            newStatus: status,
            source: 'BULK_STATUS_UPDATE',
            batchId,
          },
        });
      } catch (auditErr) {
        console.error(`[BULK-STATUS] Failed to write audit log for order ${order._id}:`, auditErr);
      }

      successes.push({
        orderId: idStr,
        orderNumber: order.orderNumber,
        previousStatus,
        newStatus: status,
      });
    }

    res.status(200).json({
      success: true,
      message: `Updated ${successes.length} order(s). ${failures.length} order(s) could not be updated.`,
      data: {
        totalRequested: uniqueOrderIds.length,
        updatedCount: successes.length,
        rejectedCount: failures.length,
        updated: successes,
        failures,
      },
    });
  } catch (error: unknown) {
    handleControllerError(res, error);
  }
};

export const getOrderById = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid order ID format', 400);
    }

    const order = await Order.findById(id)
      .populate('userId', 'name email')
      .populate({
        path: 'items.productId',
        select: 'name slug basePrice mrp images variants status fabric gsm fit categoryId'
      });
    if (!order) {
      throw new AppError('Order not found', 404);
    }

    const payment = await Payment.findOne({ orderId: id });
    const paymentAttempts = await PaymentAttempt.find({ orderId: id });

    res.status(200).json({
      success: true,
      data: {
        order,
        payment,
        paymentAttempts
      }
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const updateOrderStatus = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!status) throw new AppError('Status is required', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    const validTransitions: Record<string, string[]> = {
      'PENDING': ['CONFIRMED', 'CANCELLED'],
      'CONFIRMED': ['PROCESSING', 'CANCELLED'],
      'PROCESSING': ['SHIPPED', 'CANCELLED'],
      'SHIPPED': ['DELIVERED'],
      'DELIVERED': [],
      'CANCELLED': []
    };

    const allowedNextStatuses = validTransitions[order.status] || [];
    
    if (!allowedNextStatuses.includes(status)) {
      throw new AppError(`Invalid status transition from ${order.status} to ${status}`, 400);
    }

    // Route every cancellation through the same refund-aware path. Previously a
    // status update to CANCELLED skipped the automatic refund entirely.
    if (status === 'CANCELLED') {
      const result = await cancelOrderWithRefund({
        orderId: order._id.toString(),
        actorId: req.user.id,
        actorRole: req.user.role,
        reason: req.body.reason || 'Cancelled by admin',
        source: 'ADMIN',
      });

      const message = result.refund
        ? result.refund.status === 'PROCESSED'
          ? 'Order cancelled and refund processed successfully'
          : 'Order cancelled. Refund is being processed automatically.'
        : result.refundError
          ? 'Order cancelled. Automatic refund needs manual attention.'
          : 'Order cancelled successfully';

      return res.status(200).json({
        success: true,
        data: result.order,
        refund: result.refund,
        refundError: result.refundError,
        message,
      });
    }

    const previousStatus = order.status;
    order.status = status;
    if (status === 'DELIVERED' && !order.deliveredAt) {
      // Snapshot the delivery instant (return-window anchor), independent of any
      // later updates/audit churn on the order doc.
      order.deliveredAt = new Date();
    }
    await order.save();

    // Create Audit Log
    await AuditLog.create({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ADMIN_ORDER_STATUS_CHANGED',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: {
        previousStatus,
        newStatus: status
      }
    });

    res.status(200).json({
      success: true,
      data: order,
      message: `Order status updated to ${status}`
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
export const adminCancelOrder = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const result = await cancelOrderWithRefund({
      orderId: id,
      actorId: req.user.id,
      actorRole: req.user.role,
      reason: req.body.reason || 'Admin cancelled',
      source: 'ADMIN',
    });

    const message = result.refund
      ? result.refund.status === 'PROCESSED'
        ? 'Order cancelled and refund processed successfully'
        : 'Order cancelled. Refund is being processed automatically.'
      : result.refundError
        ? 'Order cancelled. Automatic refund needs manual attention.'
        : 'Order cancelled successfully';

    res.status(200).json({
      success: true,
      data: result.order,
      refund: result.refund,
      refundError: result.refundError,
      inventoryError: result.inventoryError,
      message
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const adminCancelOrderItems = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const items = Array.isArray(req.body.items) && req.body.items.length > 0
      ? req.body.items
      : req.body.itemId
      ? [{ itemId: req.body.itemId, quantity: req.body.quantity }]
      : [];

    if (items.length === 0) {
      throw new AppError('At least one item must be specified for cancellation', 400);
    }
    let allowBelowThreshold = false;
    let overrideReason: string | undefined = undefined;

    if (req.body.allowBelowThreshold !== undefined) {
      if (typeof req.body.allowBelowThreshold !== 'boolean') {
        throw new AppError('allowBelowThreshold must be a strictly validated boolean (true or false)', 400);
      }
      allowBelowThreshold = req.body.allowBelowThreshold;
    }

    if (allowBelowThreshold) {
      const reasonCandidate = typeof req.body.overrideReason === 'string'
        ? req.body.overrideReason.trim()
        : typeof req.body.reason === 'string'
        ? req.body.reason.trim()
        : '';

      if (!reasonCandidate) {
        throw new AppError('An override reason is required when allowBelowThreshold is true', 400);
      }
      overrideReason = reasonCandidate;
    }

    const result = await cancelOrderItemsWithRefund({
      orderId: id,
      items,
      operationId: req.body.operationId,
      actorId: req.user.id,
      actorRole: req.user.role,
      reason: req.body.reason || 'Admin cancelled items',
      source: 'ADMIN',
      enforceCustomPrintLock: false,
      allowBelowThreshold,
      overrideReason,
    });

    const message = result.refund
      ? result.refund.status === 'PROCESSED'
        ? 'Items cancelled and refund processed successfully'
        : 'Items cancelled. Refund is being processed automatically.'
      : result.refundError
        ? 'Items cancelled. Automatic refund needs manual attention.'
        : 'Items cancelled successfully';

    res.status(200).json({
      success: true,
      data: result.order,
      refund: result.refund,
      refundAmount: result.refundAmount,
      refundError: result.refundError,
      inventoryError: result.inventoryError,
      fullyCancelled: result.fullyCancelled,
      operationId: result.operationId,
      message
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const cancelOrder = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    if (order.status !== 'PENDING') {
      throw new AppError('Only PENDING orders can be cancelled', 400);
    }
    if (order.paymentStatus !== 'PENDING' && order.paymentStatus !== 'FAILED') {
      throw new AppError('Cannot cancel an order that is already PAID', 400);
    }

    const previousStatus = order.status;
    order.status = 'CANCELLED';
    await order.save();

    // Create Audit Log
    await AuditLog.create({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ADMIN_ORDER_CANCELLED',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: {
        previousStatus,
        newStatus: 'CANCELLED',
        note: 'Admin initiated cancellation for unpaid order'
      }
    });

    res.status(200).json({
      success: true,
      data: order,
      message: 'Order cancelled successfully'
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
