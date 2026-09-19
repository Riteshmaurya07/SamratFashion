import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { Product } from '../models/Product';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const search = req.query.search as string;
    const status = req.query.status as string;
    const paymentStatus = req.query.paymentStatus as string;

    const query: any = {};
    if (search) {
      query.orderNumber = { $regex: search, $options: 'i' };
    }
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const sortField = (req.query.sortField as string) || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const allowedSortFields = ['createdAt', 'total', 'orderNumber'];
    const finalSortField = allowedSortFields.includes(sortField) ? sortField : 'createdAt';

    const [orders, total, allOrdersForMetrics] = await Promise.all([
      Order.find(query)
        .sort({ [finalSortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email'),
      Order.countDocuments(query),
      Order.find().select('status paymentStatus createdAt')
    ]);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const summary = {
      totalOrders: allOrdersForMetrics.length,
      todayOrders: allOrdersForMetrics.filter(o => new Date(o.createdAt) >= startOfToday).length,
      processingOrders: allOrdersForMetrics.filter(o => o.status === 'PROCESSING').length,
      awaitingPaymentOrders: allOrdersForMetrics.filter(o => o.paymentStatus === 'PENDING').length,
      shippedOrders: allOrdersForMetrics.filter(o => o.status === 'SHIPPED').length,
    };

    res.status(200).json({
      success: true,
      data: {
        items: orders,
        summary,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const getOrderById = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid order ID format', 400);
    }

    const order = await Order.findById(id).populate('userId', 'name email');
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
      'CONFIRMED': ['PROCESSING'],
      'PROCESSING': ['SHIPPED'],
      'SHIPPED': ['DELIVERED'],
      'DELIVERED': [],
      'CANCELLED': []
    };

    const allowedNextStatuses = validTransitions[order.status] || [];
    
    if (!allowedNextStatuses.includes(status)) {
      throw new AppError(`Invalid status transition from ${order.status} to ${status}`, 400);
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
