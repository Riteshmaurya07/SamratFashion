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
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // OWASP CSV injection mitigation: prevent spreadsheet macro execution
  // Checks for formula triggers (=, +, -, @, tab, CR) including leading whitespace cases
  if (/^\s*[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}



export const getCustomers = async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const skip = (page - 1) * limit;

    const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 64) : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const role = typeof req.query.role === 'string' ? req.query.role.trim() : '';

    const query: Record<string, unknown> = {};
    if (rawSearch) {
      const safeRegex = escapeRegex(rawSearch);
      const digitsOnly = rawSearch.replace(/\D/g, '');

      const orClauses: Record<string, unknown>[] = [
        { name: { $regex: safeRegex, $options: 'i' } },
        { email: { $regex: safeRegex, $options: 'i' } },
      ];

      if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
        const local10 = digitsOnly.slice(2);
        orClauses.push({ phone: { $regex: escapeRegex(local10), $options: 'i' } });
        orClauses.push({ phone: { $regex: escapeRegex(`+91${local10}`), $options: 'i' } });
        orClauses.push({ phone: { $regex: escapeRegex(`0${local10}`), $options: 'i' } });
      } else if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
        const local10 = digitsOnly.slice(1);
        orClauses.push({ phone: { $regex: escapeRegex(local10), $options: 'i' } });
        orClauses.push({ phone: { $regex: escapeRegex(`+91${local10}`), $options: 'i' } });
      } else if (digitsOnly.length === 10) {
        orClauses.push({ phone: { $regex: escapeRegex(digitsOnly), $options: 'i' } });
        orClauses.push({ phone: { $regex: escapeRegex(`+91${digitsOnly}`), $options: 'i' } });
        orClauses.push({ phone: { $regex: escapeRegex(`91${digitsOnly}`), $options: 'i' } });
        orClauses.push({ phone: { $regex: escapeRegex(`0${digitsOnly}`), $options: 'i' } });
      } else if (digitsOnly.length >= 5) {
        orClauses.push({ phone: { $regex: escapeRegex(digitsOnly), $options: 'i' } });
      }
      if (mongoose.Types.ObjectId.isValid(rawSearch)) {
        orClauses.push({ _id: new mongoose.Types.ObjectId(rawSearch) });
      }

      query.$or = orClauses;
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
    // Deterministic tiebreaker prevents rows from shifting between pages when the
    // primary sort key is equal (e.g. bulk-created accounts share a timestamp).
    const sortSpec: Record<string, 1 | -1> = { [finalSortField]: sortOrder, _id: sortOrder };

    const [customers, total, summaryAgg] = await Promise.all([
      User.find(query)
        .select('-passwordHash') // NEVER return passwordHash
        .sort(sortSpec)
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
      User.aggregate([
        { $match: { role: UserRole.CUSTOMER } },
        {
          $facet: {
            total: [{ $count: "count" }],
            active: [{ $match: { status: UserStatus.ACTIVE } }, { $count: "count" }],
            suspended: [{ $match: { status: UserStatus.SUSPENDED } }, { $count: "count" }],
            disabled: [{ $match: { status: UserStatus.DISABLED } }, { $count: "count" }],
          }
        }
      ])
    ]);

    const firstFacet = summaryAgg?.[0];
    const summary = {
      total: firstFacet?.total?.[0]?.count || 0,
      active: firstFacet?.active?.[0]?.count || 0,
      suspended: firstFacet?.suspended?.[0]?.count || 0,
      disabled: firstFacet?.disabled?.[0]?.count || 0,
    };

    // Enhance with order stats safely via aggregation
    const customerIds = customers.map((c) => c._id);
    const orderStats = customerIds.length > 0
      ? await Order.aggregate([
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
        ])
      : [];

    const statsMap = new Map(orderStats.map((stat) => [stat._id.toString(), stat]));

    const items = customers.map((c) => {
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
        summary,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: unknown) {
    const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;
    const message = error instanceof Error ? error.message : 'Failed to fetch customers';
    res.status(statusCode).json({ success: false, message });
  }
};

export const exportCustomersCSV = async (req: AuthRequest, res: Response) => {
  try {
    const customers = await User.find({ role: UserRole.CUSTOMER })
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .lean();

    const customerIds = customers.map((c) => c._id);
    const orderStats = customerIds.length > 0
      ? await Order.aggregate([
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
        ])
      : [];

    const statsMap = new Map(orderStats.map((stat) => [stat._id.toString(), stat]));

    const rows: string[][] = [
      ["Customer ID", "Name", "Email", "Phone", "Status", "Joined Date", "Orders Count", "Total Spent (INR)"].map(h => `"${h}"`)
    ];

    for (const c of customers) {
      const stats = statsMap.get(c._id.toString()) || { totalOrders: 0, paidAmount: 0 };
      rows.push([
        sanitizeCsvCell(c._id.toString().slice(-8).toUpperCase()),
        sanitizeCsvCell(c.name || ''),
        sanitizeCsvCell(c.email || ''),
        sanitizeCsvCell(c.phone || ''),
        sanitizeCsvCell(c.status || 'ACTIVE'),
        sanitizeCsvCell(new Date(c.createdAt).toISOString().split('T')[0]),
        sanitizeCsvCell(stats.totalOrders),
        sanitizeCsvCell(Math.round(stats.paidAmount * 100) / 100)
      ]);
    }

    const csvContent = rows.map((r) => r.join(',')).join('\n');
    const filename = `customers-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.status(200).send(csvContent);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to export customers';
    res.status(500).json({ success: false, message });
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
