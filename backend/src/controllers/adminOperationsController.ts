import { Request, Response, NextFunction } from 'express';
import { Invoice } from '../models/Invoice';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { AuditLog } from '../models/AuditLog';
import { NotificationLog } from '../models/NotificationLog';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { WebhookEvent } from '../models/WebhookEvent';
import '../models/Product';
import { cleanupExpiredLogs } from '../services/logCleanupService';
import { Order } from '../models/Order';
import '../models/User';
import { getOrCreateInvoiceForOrder } from './invoiceController';

// CSV Injection Sanitizer (RFC 4180 + formula prevention)
function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  let str = String(val).trim();
  // Prevent CSV injection: prepending single quote if starts with dangerous formula chars
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape double quotes
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

// ─── 1. INVOICE REGISTER & CSV EXPORT ──────────────────────────────────────────

const INVOICE_BACKFILL_THROTTLE_MS = 60_000;
const INVOICE_BACKFILL_BATCH = 50;
let lastInvoiceBackfillAt = 0;
let invoiceBackfillInFlight: Promise<void> | null = null;

const INVOICE_ELIGIBLE_PENDING_STATUSES = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

/**
 * Issues invoices for paid (or confirmed-COD) orders that were created before
 * invoices were generated on payment. Runs at most once a minute and is safe to
 * call concurrently — the unique orderId index plus duplicate-key handling in
 * getOrCreateInvoiceForOrder keep issuance idempotent.
 */
async function issueMissingInvoices(limit = INVOICE_BACKFILL_BATCH): Promise<void> {
  if (invoiceBackfillInFlight) {
    return invoiceBackfillInFlight;
  }

  const now = Date.now();
  if (now - lastInvoiceBackfillAt < INVOICE_BACKFILL_THROTTLE_MS) {
    return;
  }
  lastInvoiceBackfillAt = now;

  invoiceBackfillInFlight = (async () => {
    try {
      const missing = await Order.aggregate([
        {
          $match: {
            status: { $ne: 'CANCELLED' },
            $or: [
              { paymentStatus: { $in: ['PAID', 'REFUNDED'] } },
              {
                paymentStatus: 'PENDING',
                status: { $in: INVOICE_ELIGIBLE_PENDING_STATUSES },
              },
            ],
          },
        },
        {
          $lookup: {
            from: Invoice.collection.name,
            localField: '_id',
            foreignField: 'orderId',
            as: 'invoices',
          },
        },
        { $match: { invoices: { $size: 0 } } },
        { $sort: { createdAt: 1 } },
        { $limit: Math.max(1, limit) },
        { $project: { _id: 1 } },
      ]);

      let issued = 0;
      let failed = 0;

      for (const order of missing) {
        try {
          await getOrCreateInvoiceForOrder(order._id.toString());
          issued += 1;
        } catch (error) {
          failed += 1;
          console.error(`[INVOICE BACKFILL] Failed for order ${order._id}:`, error);
        }
      }

      if (missing.length > 0) {
        console.log(
          `[INVOICE BACKFILL] candidates=${missing.length} issued=${issued} failed=${failed}`
        );
      }
    } catch (error) {
      console.error('[INVOICE BACKFILL] Scan failed:', error);
    } finally {
      invoiceBackfillInFlight = null;
    }
  })();

  return invoiceBackfillInFlight;
}

export const getAdminInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};

    if (req.query.status && typeof req.query.status === 'string') {
      query.status = req.query.status.toUpperCase();
    }

    if (req.query.startDate || req.query.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (req.query.startDate && typeof req.query.startDate === 'string') {
        const start = new Date(req.query.startDate);
        if (!isNaN(start.getTime())) dateFilter.$gte = start;
      }
      if (req.query.endDate && typeof req.query.endDate === 'string') {
        const end = new Date(req.query.endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          dateFilter.$lte = end;
        }
      }
      if (Object.keys(dateFilter).length > 0) {
        query.issuedAt = dateFilter;
      }
    }

    if (req.query.search && typeof req.query.search === 'string') {
      const searchRegex = new RegExp(req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { invoiceNumber: searchRegex },
        { orderNumber: searchRegex },
        { 'customerSnapshot.name': searchRegex },
        { 'customerSnapshot.email': searchRegex }
      ];
    }

    // Self-heal the register: on the default first page, issue invoices for
    // paid orders that pre-date automatic issuance. Throttled and idempotent.
    const hasFilters = Boolean(
      req.query.status || req.query.startDate || req.query.endDate || req.query.search
    );
    if (page === 1 && !hasFilters) {
      await issueMissingInvoices();
    }

    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .sort({ issuedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Invoice.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        items: invoices,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const exportAdminInvoicesCsv = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query: Record<string, unknown> = {};

    if (req.query.status && typeof req.query.status === 'string') {
      query.status = req.query.status.toUpperCase();
    }

    if (req.query.startDate || req.query.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (req.query.startDate && typeof req.query.startDate === 'string') {
        const start = new Date(req.query.startDate);
        if (!isNaN(start.getTime())) dateFilter.$gte = start;
      }
      if (req.query.endDate && typeof req.query.endDate === 'string') {
        const end = new Date(req.query.endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          dateFilter.$lte = end;
        }
      }
      if (Object.keys(dateFilter).length > 0) {
        query.issuedAt = dateFilter;
      }
    }

    // Limit export to max 5000 records to prevent memory exhaustion
    const invoices = await Invoice.find(query)
      .sort({ issuedAt: -1 })
      .limit(5000)
      .lean();

    const headers = [
      'Invoice Number',
      'Issue Date',
      'Order Number',
      'Customer Name',
      'Customer Email',
      'Status',
      'Subtotal (INR)',
      'Discount (INR)',
      'Shipping Fee (INR)',
      'Tax (INR)',
      'Total (INR)',
      'Payment Method',
      'Currency'
    ];

    const rows = invoices.map(inv => [
      sanitizeCsvCell(inv.invoiceNumber),
      sanitizeCsvCell(inv.issuedAt ? new Date(inv.issuedAt).toISOString().split('T')[0] : ''),
      sanitizeCsvCell(inv.orderNumber),
      sanitizeCsvCell(inv.customerSnapshot?.name || ''),
      sanitizeCsvCell(inv.customerSnapshot?.email || ''),
      sanitizeCsvCell(inv.status),
      sanitizeCsvCell(inv.subtotal),
      sanitizeCsvCell(inv.discount || 0),
      sanitizeCsvCell(inv.shipping || 0),
      sanitizeCsvCell(inv.tax || 0),
      sanitizeCsvCell(inv.total),
      sanitizeCsvCell(inv.paymentSnapshot?.provider || 'ONLINE'),
      sanitizeCsvCell(inv.currency || 'INR')
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="invoices_export_${Date.now()}.csv"`);
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
};

// ─── 2. INVENTORY MOVEMENT LEDGER ──────────────────────────────────────────────

export const getAdminInventoryLedger = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};

    if (req.query.type && typeof req.query.type === 'string') {
      query.type = req.query.type.toUpperCase();
    }

    if (req.query.productId && typeof req.query.productId === 'string') {
      query.productId = req.query.productId;
    }

    if (req.query.startDate || req.query.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (req.query.startDate && typeof req.query.startDate === 'string') {
        const start = new Date(req.query.startDate);
        if (!isNaN(start.getTime())) dateFilter.$gte = start;
      }
      if (req.query.endDate && typeof req.query.endDate === 'string') {
        const end = new Date(req.query.endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          dateFilter.$lte = end;
        }
      }
      if (Object.keys(dateFilter).length > 0) {
        query.createdAt = dateFilter;
      }
    }

    const [transactions, total] = await Promise.all([
      InventoryTransaction.find(query)
        .populate('productId', 'name slug images')
        .populate('orderId', 'orderNumber status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InventoryTransaction.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        items: transactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── 3. AUDIT LOGS VIEWER ──────────────────────────────────────────────────────

export const getAdminAuditLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};

    if (req.query.action && typeof req.query.action === 'string') {
      query.action = req.query.action.trim();
    }

    if (req.query.entityType && typeof req.query.entityType === 'string') {
      query.entityType = req.query.entityType.trim();
    }

    if (req.query.actorId && typeof req.query.actorId === 'string') {
      query.actorId = req.query.actorId;
    }

    if (req.query.startDate || req.query.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (req.query.startDate && typeof req.query.startDate === 'string') {
        const start = new Date(req.query.startDate);
        if (!isNaN(start.getTime())) dateFilter.$gte = start;
      }
      if (req.query.endDate && typeof req.query.endDate === 'string') {
        const end = new Date(req.query.endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          dateFilter.$lte = end;
        }
      }
      if (Object.keys(dateFilter).length > 0) {
        query.createdAt = dateFilter;
      }
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate('actorId', 'name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        items: logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── 4. NOTIFICATION DELIVERY LOGS ─────────────────────────────────────────────

export const getAdminNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};

    if (req.query.status && typeof req.query.status === 'string') {
      query.status = req.query.status.toUpperCase();
    }

    if (req.query.channel && typeof req.query.channel === 'string') {
      query.channel = req.query.channel.toUpperCase();
    }

    if (req.query.eventType && typeof req.query.eventType === 'string') {
      query.eventType = req.query.eventType.trim();
    }

    const [logs, total] = await Promise.all([
      NotificationLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      NotificationLog.countDocuments(query)
    ]);

    // Mask sensitive recipient data (email/phone) for operational safety
    const safeLogs = logs.map(l => {
      const email = l.recipientEmail || '';
      const atIdx = email.indexOf('@');
      const maskedEmail = atIdx > 2
        ? `${email.slice(0, 2)}***${email.slice(atIdx)}`
        : email;

      return {
        ...l,
        recipientEmail: maskedEmail,
        recipientPhone: l.recipientPhone ? `${l.recipientPhone.slice(0, 3)}****${l.recipientPhone.slice(-3)}` : undefined
      };
    });

    res.status(200).json({
      success: true,
      data: {
        items: safeLogs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── 5. PAYMENT ATTEMPT DIAGNOSTICS ────────────────────────────────────────────

export const getAdminPaymentAttempts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};

    if (req.query.status && typeof req.query.status === 'string') {
      query.status = req.query.status.toUpperCase();
    }

    if (req.query.orderId && typeof req.query.orderId === 'string') {
      query.orderId = req.query.orderId;
    }

    if (req.query.razorpayOrderId && typeof req.query.razorpayOrderId === 'string') {
      query.razorpayOrderId = req.query.razorpayOrderId.trim();
    }

    const [attempts, total] = await Promise.all([
      PaymentAttempt.find(query)
        .populate('orderId', 'orderNumber status total user')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PaymentAttempt.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        items: attempts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── 6. WEBHOOK & LOGISTICS EVENT MONITOR ──────────────────────────────────────

export const getAdminWebhooks = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};

    if (req.query.status && typeof req.query.status === 'string') {
      query.status = req.query.status.toUpperCase();
    }

    if (req.query.provider && typeof req.query.provider === 'string') {
      query.provider = req.query.provider.toUpperCase();
    }

    const [events, total] = await Promise.all([
      WebhookEvent.find(query)
        .sort({ processedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WebhookEvent.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        items: events,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── 7. LOG RETENTION & AUTO-CLEANUP ──────────────────────────────────────────

export const triggerLogCleanup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const retentionDays =
      req.body && typeof req.body === 'object' && 'retentionDays' in req.body && typeof req.body.retentionDays === 'number'
        ? req.body.retentionDays
        : undefined;

    const report = await cleanupExpiredLogs({ retentionDays });
    res.status(200).json({
      success: true,
      message: `Log cleanup completed. Purged ${report.totalDeleted} records.`,
      data: report,
    });
  } catch (error) {
    next(error);
  }
};
