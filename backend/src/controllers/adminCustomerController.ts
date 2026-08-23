import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { User, UserRole, UserStatus } from '../models/User';
import { Session } from '../models/Session';
import { Order } from '../models/Order';
import { Address } from '../models/Address';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export const getCustomers = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const search = req.query.search as string;
    const status = req.query.status as string;
    const role = req.query.role as string;

    const query: any = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
      if (search.match(/^\d+$/)) {
        query.$or.push({ phone: { $regex: search, $options: 'i' } });
      }
      if (mongoose.Types.ObjectId.isValid(search)) {
        query.$or.push({ _id: search });
      }
    }
    
    if (status) query.status = status;
    
    // Default to CUSTOMER if role filter is missing, unless explicitly requesting ADMIN/SUPER_ADMIN
    if (role) {
      query.role = role;
    } else {
      query.role = UserRole.CUSTOMER;
    }

    const sortField = (req.query.sortField as string) || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const allowedSortFields = ['createdAt', 'name', 'email'];
    const finalSortField = allowedSortFields.includes(sortField) ? sortField : 'createdAt';

    const [customers, total] = await Promise.all([
      User.find(query)
        .select('-passwordHash') // NEVER return passwordHash
        .sort({ [finalSortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);

    // Enhance with order stats safely via aggregation
    const customerIds = customers.map(c => c._id);
    const orderStats = await Order.aggregate([
      { $match: { userId: { $in: customerIds } } },
      { 
        $group: {
          _id: '$userId',
          totalOrders: { $sum: 1 },
          paidAmount: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'PAID'] }, '$total', 0]
            }
          }
        }
      }
    ]);

    const statsMap = new Map(orderStats.map(stat => [stat._id.toString(), stat]));

    const items = customers.map(c => {
      const stats = statsMap.get(c._id.toString()) || { totalOrders: 0, paidAmount: 0 };
      return {
        ...c,
        orderCount: stats.totalOrders,
        totalPaidAmount: stats.paidAmount
      };
    });

    res.status(200).json({
      success: true,
      data: {
        items,
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

export const getCustomerById = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid customer ID format', 400);
    }

    const customer = await User.findById(id).select('-passwordHash').lean();
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const addresses = await Address.find({ userId: id }).lean();
    
    // Aggregating statistics
    const orderStatsPipeline = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          paidOrders: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'PAID'] }, 1, 0] }
          },
          totalPaidAmount: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'PAID'] }, '$total', 0] }
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] }
          },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] }
          }
        }
      }
    ]);

    const statistics = orderStatsPipeline.length > 0 
      ? orderStatsPipeline[0] 
      : { totalOrders: 0, paidOrders: 0, totalPaidAmount: 0, pendingOrders: 0, cancelledOrders: 0 };
    delete statistics._id;

    // Fetch order history summary safely
    const orders = await Order.find({ userId: id })
      .select('orderNumber createdAt total paymentStatus status items')
      .sort({ createdAt: -1 })
      .lean();

    const formattedOrders = orders.map(o => ({
      ...o,
      itemCount: o.items ? o.items.reduce((acc: number, item: any) => acc + item.quantity, 0) : 0
    }));

    res.status(200).json({
      success: true,
      data: {
        customer,
        addresses,
        statistics,
        orders: formattedOrders
      }
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const updateCustomerStatus = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body; // ONLY ACCEPTING ACTIVE or SUSPENDED

    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid customer ID', 400);
    if (!status || !Object.values(UserStatus).includes(status)) {
      throw new AppError('Valid status is required', 400);
    }
    if (!req.user) throw new AppError('Unauthorized', 401);

    // Self-protection
    if (id === req.user.id) {
      throw new AppError('Admins cannot change their own account status via this endpoint', 403);
    }

    const targetUser = await User.findById(id);
    if (!targetUser) throw new AppError('User not found', 404);

    // SUPER_ADMIN protection
    if (targetUser.role === UserRole.SUPER_ADMIN && req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AppError('Cannot alter SUPER_ADMIN account status', 403);
    }

    // Don't accept role changes via this endpoint (ensured by extracting only status)
    
    const previousStatus = targetUser.status;
    targetUser.status = status as UserStatus;
    await targetUser.save();

    // Session Revocation (if suspending)
    if (status === UserStatus.SUSPENDED) {
      await Session.updateMany(
        { userId: targetUser._id, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date() } }
      );
    }

    // Audit Logging
    const actionMap: Record<string, string> = {
      [UserStatus.SUSPENDED]: 'ADMIN_CUSTOMER_SUSPENDED',
      [UserStatus.ACTIVE]: 'ADMIN_CUSTOMER_REACTIVATED'
    };
    
    await AuditLog.create({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: actionMap[status] || 'ADMIN_CUSTOMER_UPDATED',
      entityType: 'USER',
      entityId: targetUser._id,
      metadata: {
        previousStatus,
        newStatus: status
      }
    });

    // Remove passwordHash from response
    const safeUser = targetUser.toObject();
    delete (safeUser as any).passwordHash;

    res.status(200).json({
      success: true,
      data: safeUser,
      message: `User status updated to ${status}`
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
