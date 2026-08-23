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
    const orders = await Order.find();

    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.status === 'PENDING').length;
    const confirmedOrders = orders.filter(o => o.status === 'CONFIRMED').length;
    const processingOrders = orders.filter(o => o.status === 'PROCESSING').length;
    const shippedOrders = orders.filter(o => o.status === 'SHIPPED').length;
    const deliveredOrders = orders.filter(o => o.status === 'DELIVERED').length;
    const cancelledOrders = orders.filter(o => o.status === 'CANCELLED').length;

    const paidOrdersList = orders.filter(o => o.paymentStatus === 'PAID');
    const paidOrders = paidOrdersList.length;
    const failedPayments = orders.filter(o => o.paymentStatus === 'FAILED').length;

    // Revenue = SUM(Order.total) ONLY where paymentStatus === "PAID"
    const revenue = paidOrdersList.reduce((sum, order) => sum + order.total, 0);

    // Low stock: product variants with stock < 5
    const products = await Product.find({ 'variants.stock': { $lt: 5 } });
    let lowStockProductsCount = 0;
    products.forEach(p => {
      p.variants.forEach(v => {
        if (v.stock < 5) lowStockProductsCount++;
      });
    });

    res.status(200).json({
      success: true,
      data: {
        totalOrders,
        pendingOrders,
        confirmedOrders,
        processingOrders,
        shippedOrders,
        deliveredOrders,
        cancelledOrders,
        paidOrders,
        failedPayments,
        revenue,
        lowStockProducts: lowStockProductsCount
      }
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

    const [orders, total] = await Promise.all([
      Order.find(query)
        .sort({ [finalSortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email'),
      Order.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        items: orders,
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
