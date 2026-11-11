import { NextFunction, Request, Response } from 'express';
import { Order } from '../models/Order';
import { AppError } from '../utils/AppError';
import {
  generateOrdersReportPDFStream,
  OrdersReportRow,
} from '../utils/pdfOrdersReportGenerator';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EXPORT_ROWS = 5000;

type DateRange = {
  start?: Date;
  end: Date;
  label: string;
};

function startOfIstDay(base: Date): Date {
  const shifted = new Date(base.getTime() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS
  );
}

function parseIstDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);

  if (Number.isNaN(parsed.getTime())) return null;
  // Reject impossible dates such as 2026-02-31.
  const check = new Date(parsed.getTime() + IST_OFFSET_MS);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function formatIstDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatIstDateForFilename(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

function resolveDateRange(rangeRaw: unknown, startRaw: unknown, endRaw: unknown): DateRange {
  const range = (typeof rangeRaw === 'string' ? rangeRaw : 'today').toLowerCase();
  const now = new Date();
  const startOfToday = startOfIstDay(now);

  switch (range) {
    case 'today':
      return { start: startOfToday, end: now, label: `Today · ${formatIstDate(now)}` };
    case '3d': {
      const start = new Date(startOfToday.getTime() - 2 * DAY_MS);
      return { start, end: now, label: `Last 3 days · ${formatIstDate(start)} – ${formatIstDate(now)}` };
    }
    case '7d': {
      const start = new Date(startOfToday.getTime() - 6 * DAY_MS);
      return { start, end: now, label: `Last 7 days · ${formatIstDate(start)} – ${formatIstDate(now)}` };
    }
    case '30d': {
      const start = new Date(startOfToday.getTime() - 29 * DAY_MS);
      return { start, end: now, label: `Last 30 days · ${formatIstDate(start)} – ${formatIstDate(now)}` };
    }
    case 'all':
      return { end: now, label: `All time · up to ${formatIstDate(now)}` };
    case 'custom': {
      const start = parseIstDateOnly(startRaw);
      const endDate = parseIstDateOnly(endRaw);

      if (!start || !endDate) {
        throw new AppError(
          'A valid startDate and endDate (YYYY-MM-DD) are required for a custom export range.',
          400,
          'INVALID_EXPORT_RANGE'
        );
      }

      if (endDate.getTime() < start.getTime()) {
        throw new AppError('endDate must be on or after startDate.', 400, 'INVALID_EXPORT_RANGE');
      }

      // Include the whole end day (IST).
      const inclusiveEnd = new Date(endDate.getTime() + DAY_MS - 1);
      return {
        start,
        end: inclusiveEnd,
        label: `Custom range · ${formatIstDate(start)} – ${formatIstDate(endDate)}`,
      };
    }
    default:
      throw new AppError(
        'Unsupported export range. Use today, 3d, 7d, 30d, all or custom.',
        400,
        'INVALID_EXPORT_RANGE'
      );
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildQuery(req: Request, dateRange: DateRange): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  if (typeof req.query.status === 'string' && req.query.status.trim()) {
    query.status = req.query.status.trim().toUpperCase();
  }

  if (typeof req.query.paymentStatus === 'string' && req.query.paymentStatus.trim()) {
    query.paymentStatus = req.query.paymentStatus.trim().toUpperCase();
  }

  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    const search = req.query.search.trim().slice(0, 100);
    query.orderNumber = { $regex: escapeRegex(search), $options: 'i' };
  }

  const dateFilter: Record<string, Date> = {};
  if (dateRange.start) dateFilter.$gte = dateRange.start;
  dateFilter.$lte = dateRange.end;
  query.createdAt = dateFilter;

  return query;
}

function toReportRow(order: any): OrdersReportRow {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemCount = items.reduce(
    (total: number, item: any) => total + (Number(item?.quantity) || 0),
    0
  );

  return {
    orderNumber: order.orderNumber || String(order._id),
    createdAt: order.createdAt,
    customerName: order.userId?.name || order.shippingAddress?.fullName || 'Unknown',
    customerEmail: order.userId?.email || '',
    itemCount: itemCount || items.length,
    total: Number(order.total) || 0,
    paymentStatus: order.paymentStatus || 'PENDING',
    status: order.status || 'UNKNOWN',
  };
}

export const exportOrdersPDF = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dateRange = resolveDateRange(req.query.range, req.query.startDate, req.query.endDate);
    const query = buildQuery(req, dateRange);

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(MAX_EXPORT_ROWS + 1)
      .populate('userId', 'name email')
      .lean();

    const truncated = orders.length > MAX_EXPORT_ROWS;
    const exportOrders = truncated ? orders.slice(0, MAX_EXPORT_ROWS) : orders;
    const rows = exportOrders.map(toReportRow);

    const filenameDate = formatIstDateForFilename(new Date());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="orders-report-${filenameDate}.pdf"`
    );
    res.setHeader('Cache-Control', 'no-store');

    const doc = generateOrdersReportPDFStream(rows, {
      rangeLabel: dateRange.label,
      generatedAt: new Date(),
      statusFilter: typeof req.query.status === 'string' ? req.query.status : undefined,
      paymentFilter:
        typeof req.query.paymentStatus === 'string' ? req.query.paymentStatus : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      truncated,
    });

    doc.pipe(res);
  } catch (error) {
    next(error);
  }
};
