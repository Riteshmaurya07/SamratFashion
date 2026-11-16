import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice';
import { CreditNote } from '../models/CreditNote';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { AuditLog } from '../models/AuditLog';
import { NotificationLog } from '../models/NotificationLog';
import { Payment } from '../models/Payment';
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

/**
 * Refunded totals per invoice, derived from issued credit notes only.
 * Invoices issued after a cancellation already carry net totals and therefore
 * have no credit note, so `refunded` stays 0 for them.
 */
async function getRefundedAmountsByInvoice(
  invoiceIds: mongoose.Types.ObjectId[]
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();

  const notes = await CreditNote.find({
    invoiceId: { $in: invoiceIds },
    status: 'ISSUED',
  })
    .select('invoiceId totalRefundAmount')
    .lean();

  const totals = new Map<string, number>();
  for (const note of notes) {
    const key = String(note.invoiceId);
    totals.set(key, (totals.get(key) || 0) + Number(note.totalRefundAmount || 0));
  }
  return totals;
}

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

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

    const refundedByInvoice = await getRefundedAmountsByInvoice(
      invoices.map((invoice) => invoice._id)
    );

    const items = invoices.map((invoice) => {
      const refundedAmount = roundMoney(refundedByInvoice.get(String(invoice._id)) || 0);
      return {
        ...invoice,
        refundedAmount,
        netTotal: roundMoney(Math.max(0, invoice.total - refundedAmount)),
      };
    });

    res.status(200).json({
      success: true,
      data: {
        items,
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

    const refundedByInvoice = await getRefundedAmountsByInvoice(
      invoices.map((invoice) => invoice._id)
    );

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
      'Refunded (INR)',
      'Net Total (INR)',
      'Payment Method',
      'Currency'
    ];

    const rows = invoices.map(inv => {
      const refundedAmount = roundMoney(refundedByInvoice.get(String(inv._id)) || 0);
      return [
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
        sanitizeCsvCell(refundedAmount),
        sanitizeCsvCell(roundMoney(Math.max(0, inv.total - refundedAmount))),
        sanitizeCsvCell(inv.paymentSnapshot?.provider || 'ONLINE'),
        sanitizeCsvCell(inv.currency || 'INR')
      ].join(',');
    });

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

    if (req.query.paymentId && typeof req.query.paymentId === 'string') {
      query.paymentId = req.query.paymentId.trim();
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

// ─── 5a. READ-ONLY PAYMENT RECONCILIATION QUEUE ────────────────────────────────

export const getAdminPaymentReconciliationQueue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestedPage = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const page = requestedPage;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const maxPage = 10_000;

    if (page > maxPage) {
      res.status(400).json({ success: false, message: `Page must not exceed ${maxPage}` });
      return;
    }

    const skip = (page - 1) * limit;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);

    const paymentIncidents: any[] = [
      { $match: { $or: [{ reconciliationRequired: true }, { status: 'CAPTURED' }] } },
      {
        $lookup: {
          from: Order.collection.name,
          localField: 'orderId',
          foreignField: '_id',
          as: '_order'
        }
      },
      { $unwind: { path: '$_order', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: PaymentAttempt.collection.name,
          let: { linkedPaymentId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$paymentId', '$$linkedPaymentId'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 }
          ],
          as: '_attempt'
        }
      },
      { $unwind: { path: '$_attempt', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { reconciliationRequired: true },
            { status: 'CAPTURED', '_order.paymentStatus': { $ne: 'PAID' } }
          ]
        }
      },
      {
        $project: {
          _id: 0,
          incidentId: { $concat: ['payment:', { $toString: '$_id' }] },
          source: { $literal: 'PAYMENT' },
          orderId: { $toString: '$orderId' },
          orderNumber: { $ifNull: ['$_order.orderNumber', null] },
          amount: 1,
          currency: 1,
          paymentId: { $toString: '$_id' },
          paymentStatus: '$status',
          attemptId: { $ifNull: [{ $toString: '$_attempt._id' }, null] },
          attemptStatus: { $ifNull: ['$_attempt.status', null] },
          razorpayOrderId: { $ifNull: ['$_attempt.razorpayOrderId', null] },
          razorpayPaymentId: { $ifNull: ['$razorpayPaymentId', '$_attempt.razorpayPaymentId', null] },
          webhookEventId: { $literal: null },
          webhookEventType: { $literal: null },
          webhookStatus: { $literal: null },
          reconciliationRequiredIndicator: { $eq: ['$reconciliationRequired', true] },
          paymentOrderMismatch: {
            $and: [
              { $eq: ['$status', 'CAPTURED'] },
              { $ne: [{ $ifNull: ['$_order.paymentStatus', 'MISSING'] }, 'PAID'] }
            ]
          },
          issueReason: {
            $cond: [
              { $eq: ['$reconciliationRequired', true] },
              { $ifNull: ['$reconciliationReason', 'Payment flagged for reconciliation'] },
              'Captured payment is not reflected as PAID on its order'
            ]
          },
          issueTime: { $ifNull: ['$updatedAt', '$createdAt'] }
        }
      }
    ];

    const attemptIncidents: any[] = [
      {
        $match: {
          $or: [
            { status: 'PROCESSING', updatedAt: { $lte: staleBefore } },
            { status: 'CAPTURED' }
          ]
        }
      },
      {
        $lookup: {
          from: Order.collection.name,
          localField: 'orderId',
          foreignField: '_id',
          as: '_order'
        }
      },
      { $unwind: { path: '$_order', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: Payment.collection.name,
          localField: 'paymentId',
          foreignField: '_id',
          as: '_payment'
        }
      },
      { $unwind: { path: '$_payment', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { status: 'PROCESSING', updatedAt: { $lte: staleBefore } },
            {
              status: 'CAPTURED',
              $expr: {
                $or: [
                  { $eq: [{ $ifNull: ['$_payment._id', null] }, null] },
                  { $ne: ['$_payment.orderId', '$orderId'] },
                  { $not: [{ $in: ['$_payment.status', ['CAPTURED', 'REFUNDED']] }] },
                  {
                    $and: [
                      { $ne: [{ $ifNull: ['$razorpayPaymentId', null] }, null] },
                      { $ne: ['$razorpayPaymentId', { $ifNull: ['$_payment.razorpayPaymentId', ''] }] }
                    ]
                  },
                  { $eq: [{ $ifNull: ['$_order._id', null] }, null] },
                  {
                    $and: [
                      { $ne: ['$_order.paymentStatus', 'PAID'] },
                      { $ne: ['$_order.paymentStatus', 'REFUNDED'] }
                    ]
                  }
                ]
              }
            }
          ]
        }
      },
      {
        $project: {
          _id: 0,
          incidentId: { $concat: ['attempt:', { $toString: '$_id' }] },
          source: { $literal: 'ATTEMPT' },
          orderId: { $toString: '$orderId' },
          orderNumber: { $ifNull: ['$_order.orderNumber', null] },
          amount: 1,
          currency: 1,
          paymentId: { $toString: '$paymentId' },
          paymentStatus: { $ifNull: ['$_payment.status', null] },
          attemptId: { $toString: '$_id' },
          attemptStatus: '$status',
          razorpayOrderId: 1,
          razorpayPaymentId: { $ifNull: ['$razorpayPaymentId', '$_payment.razorpayPaymentId'] },
          webhookEventId: { $literal: null },
          webhookEventType: { $literal: null },
          webhookStatus: { $literal: null },
          issueReason: {
            $cond: [
              { $eq: ['$status', 'PROCESSING'] },
              'Payment attempt has remained PROCESSING for more than 15 minutes',
              {
                $switch: {
                  branches: [
                    {
                      case: { $eq: [{ $ifNull: ['$_payment._id', null] }, null] },
                      then: 'Captured payment attempt has no linked Payment record'
                    },
                    {
                      case: { $ne: ['$_payment.orderId', '$orderId'] },
                      then: 'Captured payment attempt links to a Payment for a different order'
                    },
                    {
                      case: { $not: [{ $in: ['$_payment.status', ['CAPTURED', 'REFUNDED']] }] },
                      then: {
                        $concat: [
                          'Captured payment attempt conflicts with Payment status ',
                          { $ifNull: ['$_payment.status', 'UNKNOWN'] }
                        ]
                      }
                    },
                    {
                      case: {
                        $and: [
                          { $ne: [{ $ifNull: ['$razorpayPaymentId', null] }, null] },
                          { $ne: ['$razorpayPaymentId', { $ifNull: ['$_payment.razorpayPaymentId', ''] }] }
                        ]
                      },
                      then: 'Captured payment ID does not match the linked Payment'
                    },
                    {
                      case: { $eq: [{ $ifNull: ['$_order._id', null] }, null] },
                      then: 'Captured payment attempt has no linked order'
                    },
                    {
                      case: {
                        $and: [
                          { $ne: ['$_order.paymentStatus', 'PAID'] },
                          { $ne: ['$_order.paymentStatus', 'REFUNDED'] }
                        ]
                      },
                      then: 'Captured payment attempt is not reflected as PAID on its order'
                    }
                  ],
                  default: 'Captured payment attempt requires reconciliation'
                }
              }
            ]
          },
          issueTime: '$updatedAt'
        }
      }
    ];

    const webhookIncidents: any[] = [
      {
        $match: {
          provider: 'RAZORPAY',
          eventType: {
            $in: ['payment.captured', 'order.paid', 'payment.failed', 'refund.processed', 'refund.failed']
          },
          $or: [
            { status: 'FAILED' },
            { status: 'PROCESSING', processingLockExpiresAt: { $lte: now } },
            {
              status: 'PROCESSING',
              processingLockExpiresAt: { $exists: false },
              updatedAt: { $lte: staleBefore }
            }
          ]
        }
      },
      {
        $addFields: {
          _razorpayOrderId: {
            $ifNull: ['$payload.payload.payment.entity.order_id', '$payload.payload.order.entity.id']
          },
          _razorpayPaymentId: {
            $ifNull: ['$payload.payload.payment.entity.id', '$payload.payload.refund.entity.payment_id']
          }
        }
      },
      {
        $lookup: {
          from: PaymentAttempt.collection.name,
          localField: '_razorpayOrderId',
          foreignField: 'razorpayOrderId',
          as: '_attempt'
        }
      },
      { $unwind: { path: '$_attempt', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: Payment.collection.name,
          localField: '_attempt.paymentId',
          foreignField: '_id',
          as: '_payment'
        }
      },
      { $unwind: { path: '$_payment', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          _linkedOrderId: { $ifNull: ['$_payment.orderId', '$_attempt.orderId'] }
        }
      },
      {
        $lookup: {
          from: Order.collection.name,
          localField: '_linkedOrderId',
          foreignField: '_id',
          as: '_order'
        }
      },
      { $unwind: { path: '$_order', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          incidentId: { $concat: ['webhook:', { $toString: '$_id' }] },
          source: { $literal: 'WEBHOOK' },
          orderId: {
            $ifNull: [
              { $toString: '$_payment.orderId' },
              { $toString: '$_attempt.orderId' },
              null
            ]
          },
          orderNumber: { $ifNull: ['$_order.orderNumber', null] },
          amount: { $ifNull: ['$_payment.amount', '$_attempt.amount'] },
          currency: { $ifNull: ['$_payment.currency', '$_attempt.currency'] },
          paymentId: { $ifNull: [{ $toString: '$_payment._id' }, { $toString: '$_attempt.paymentId' }, null] },
          paymentStatus: { $ifNull: ['$_payment.status', null] },
          attemptId: { $ifNull: [{ $toString: '$_attempt._id' }, null] },
          attemptStatus: { $ifNull: ['$_attempt.status', null] },
          razorpayOrderId: { $ifNull: ['$_razorpayOrderId', null] },
          razorpayPaymentId: { $ifNull: ['$_razorpayPaymentId', '$_payment.razorpayPaymentId', '$_attempt.razorpayPaymentId', null] },
          webhookEventId: '$eventId',
          webhookEventType: '$eventType',
          webhookStatus: '$status',
          issueReason: {
            $cond: [
              { $eq: ['$status', 'FAILED'] },
              {
                $cond: [
                  { $gt: ['$processingAttempts', 1] },
                  { $concat: ['Webhook processing failed after ', { $toString: '$processingAttempts' }, ' attempts'] },
                  'Webhook processing failed'
                ]
              },
              'Webhook processing lease expired'
            ]
          },
          issueTime: { $ifNull: ['$updatedAt', '$createdAt'] }
        }
      }
    ];

    const [result] = await Payment.aggregate([
      ...paymentIncidents,
      { $unionWith: { coll: PaymentAttempt.collection.name, pipeline: attemptIncidents } },
      { $unionWith: { coll: WebhookEvent.collection.name, pipeline: webhookIncidents } },
      {
        $facet: {
          items: [
            { $project: { reconciliationRequiredIndicator: 0, paymentOrderMismatch: 0 } },
            { $sort: { issueTime: -1, incidentId: 1 } },
            { $skip: skip },
            { $limit: limit }
          ],
          total: [{ $count: 'count' }],
          paymentSummary: [
            { $match: { source: 'PAYMENT' } },
            {
              $group: {
                _id: { $ifNull: ['$currency', 'INR'] },
                capturedAwaitingActionCount: {
                  $sum: { $cond: [{ $eq: ['$paymentStatus', 'CAPTURED'] }, 1, 0] }
                },
                capturedAwaitingActionAmount: {
                  $sum: { $cond: [{ $eq: ['$paymentStatus', 'CAPTURED'] }, '$amount', 0] }
                },
                paymentOrderMismatches: {
                  $sum: { $cond: ['$paymentOrderMismatch', 1, 0] }
                },
                reconciliationRequiredPayments: {
                  $sum: { $cond: ['$reconciliationRequiredIndicator', 1, 0] }
                }
              }
            }
          ],
          capturedAttemptMismatches: [
            { $match: { source: 'ATTEMPT', attemptStatus: 'CAPTURED' } },
            { $count: 'count' }
          ],
          failedRazorpayWebhooks: [
            { $match: { source: 'WEBHOOK', webhookStatus: 'FAILED' } },
            { $count: 'count' }
          ],
          staleProcessingAttempts: [
            { $match: { source: 'ATTEMPT', attemptStatus: 'PROCESSING' } },
            { $count: 'count' }
          ]
        }
      }
    ] as any[]);

    const items = result?.items || [];
    const total = result?.total?.[0]?.count || 0;
    const paymentSummaries = result?.paymentSummary || [];
    const paymentMetrics = paymentSummaries.reduce((metrics: Record<string, number>, summary: any) => ({
      capturedAwaitingActionCount: metrics.capturedAwaitingActionCount + (summary.capturedAwaitingActionCount || 0),
      paymentOrderMismatches: metrics.paymentOrderMismatches + (summary.paymentOrderMismatches || 0),
      reconciliationRequiredPayments: metrics.reconciliationRequiredPayments + (summary.reconciliationRequiredPayments || 0)
    }), {
      capturedAwaitingActionCount: 0,
      paymentOrderMismatches: 0,
      reconciliationRequiredPayments: 0
    });
    res.status(200).json({
      success: true,
      data: {
        items,
        summary: {
          unresolvedTotal: total,
          capturedAwaitingActionCount: paymentMetrics.capturedAwaitingActionCount,
          capturedAwaitingActionAmountByCurrency: paymentSummaries
            .filter((entry: any) => entry.capturedAwaitingActionCount > 0)
            .map((entry: any) => ({ currency: entry._id, amount: entry.capturedAwaitingActionAmount })),
          paymentOrderMismatches: paymentMetrics.paymentOrderMismatches,
          reconciliationRequiredPayments: paymentMetrics.reconciliationRequiredPayments,
          capturedAttemptMismatches: result?.capturedAttemptMismatches?.[0]?.count || 0,
          failedRazorpayWebhooks: result?.failedRazorpayWebhooks?.[0]?.count || 0,
          staleProcessingAttempts: result?.staleProcessingAttempts?.[0]?.count || 0
        },
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

    if (req.query.eventId && typeof req.query.eventId === 'string') {
      query.eventId = req.query.eventId.trim();
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
