import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice, InvoiceStatus, IInvoice } from '../models/Invoice';
import { CreditNote } from '../models/CreditNote';
import { Order } from '../models/Order';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { generateInvoicePDFStream } from '../utils/pdfInvoiceGenerator';
import { ensureInvoiceFonts } from '../utils/fontLoader';
import { AuditLog } from '../models/AuditLog';
import { incrementCounter } from '../models/Counter';
import { backfillOrderItemSkus } from '../services/skuService';
import { normalizeSku } from '../utils/skuFormat';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}
/**
 * Idempotent server-side invoice generation helper
 */
export async function getOrCreateInvoiceForOrder(orderId: string): Promise<IInvoice> {
  // 1. Check if invoice already issued
  const existingInvoice = await Invoice.findOne({ orderId });
  if (existingInvoice) {
    return existingInvoice;
  }

  // 2. Fetch authoritative Order
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404, 'NOT_FOUND');
  }

  // 3. Payment / Status Eligibility check
  const isPaidOrRefunded = order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUNDED';
  const isConfirmedCod = order.paymentStatus === 'PENDING' && ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status);

  if (!isPaidOrRefunded && !isConfirmedCod) {
    throw new AppError('Invoice cannot be generated for an unpaid, failed, or cancelled order', 400, 'BAD_REQUEST');
  }

  // 3b. Legacy orders may predate SKU snapshots; resolve the product codes
  // once so every invoice/packing slip can print them from here on.
  await backfillOrderItemSkus(order);

  // 4. Fetch User for customer snapshot
  const user = await User.findById(order.userId);

  // 5. Generate a unique invoice number via an atomic counter seed so concurrent
  // requests can never hand out the same number (the unique index is the backstop).
  const year = new Date().getFullYear();
  const existingForYear = await Invoice.countDocuments({
    invoiceNumber: new RegExp(`^SF-INV-${year}-`)
  });
  const seq = await incrementCounter(`INVOICE_${year}`, existingForYear);
  const invoiceNumber = `SF-INV-${year}-${String(seq).padStart(6, '0')}`;

  // 6. Snapshot Order & Customer state. Cancelled units stay on the snapshot
  // for the audit trail, but never change the ordered quantity / line total.
  const isFullyCancelled =
    order.status === 'CANCELLED' ||
    order.items.every((item) => (item.cancelledQuantity || 0) >= item.quantity);

  const newInvoice = new Invoice({
    invoiceNumber,
    orderId: order._id,
    userId: order.userId,
    orderNumber: order.orderNumber,
    status: isFullyCancelled ? InvoiceStatus.REFUNDED : InvoiceStatus.ISSUED,
    issuedAt: new Date(),
    customerSnapshot: {
      name: user?.name || order.shippingAddress.fullName,
      email: user?.email || 'N/A',
      phone: user?.phone || order.shippingAddress.phone
    },
    billingAddressSnapshot: {
      fullName: order.shippingAddress.fullName,
      phone: order.shippingAddress.phone,
      addressLine1: order.shippingAddress.addressLine1,
      addressLine2: order.shippingAddress.addressLine2,
      city: order.shippingAddress.city,
      state: order.shippingAddress.state,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country || 'India',
      landmark: order.shippingAddress.landmark
    },
    shippingAddressSnapshot: {
      fullName: order.shippingAddress.fullName,
      phone: order.shippingAddress.phone,
      addressLine1: order.shippingAddress.addressLine1,
      addressLine2: order.shippingAddress.addressLine2,
      city: order.shippingAddress.city,
      state: order.shippingAddress.state,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country || 'India',
      landmark: order.shippingAddress.landmark
    },
    itemsSnapshot: order.items.map(item => ({
      productId: item.productId,
      productName: item.productName,
      productImage: item.productImage,
      sku: item.sku,
      selectedSize: item.selectedSize,
      selectedColor: item.selectedColor,
      quantity: item.quantity,
      cancelledQuantity: Math.min(item.quantity, Math.max(0, item.cancelledQuantity || 0)),
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      customDesignId: item.customDesignId,
      customizationSnapshot: item.customizationSnapshot ? {
        name: item.customizationSnapshot.name,
        previewImage: item.customizationSnapshot.previewImage,
        printLocations: item.customizationSnapshot.printLocations,
        customFee: item.customizationSnapshot.customFee
      } : undefined
    })),
    subtotal: order.subtotal,
    discount: order.discount,
    shipping: order.shipping,
    tax: order.tax,
    total: order.total,
    currency: order.currency || 'INR',
    paymentSnapshot: {
      provider: 'RAZORPAY',
      status: order.paymentStatus,
      amount: order.total,
      currency: order.currency || 'INR'
    }
  });

  try {
    await newInvoice.save();
    return newInvoice;
  } catch (error: unknown) {
    // Two concurrent callers (e.g. webhook + verify) can both see no invoice.
    // The unique orderId index keeps a single invoice; return the winner.
    const isDuplicateKey =
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000;

    if (isDuplicateKey) {
      const concurrentInvoice = await Invoice.findOne({ orderId: order._id });
      if (concurrentInvoice) {
        return concurrentInvoice;
      }
    }

    throw error;
  }
}

/**
 * Repairs invoices that were snapshotted before cancellations were tracked on
 * the line items. Those documents still carry `cancelledQuantity: 0`, so the
 * PDF would keep billing units that were cancelled and refunded. Totals are
 * deliberately left untouched (money is reconciled through credit notes).
 */
async function reconcileInvoiceCancellations(invoice: IInvoice): Promise<IInvoice> {
  const order = await Order.findById(invoice.orderId);
  if (!order) return invoice;

  // Legacy orders may not carry SKUs yet either.
  await backfillOrderItemSkus(order);

  // Prefer positional matching when both sides describe the same lines; fall
  // back to the product/variant tuple used by the cancellation service.
  const matchByIndex = order.items.length === invoice.itemsSnapshot.length;

  let changed = false;
  invoice.itemsSnapshot.forEach((snapshot, index) => {
    const orderItem = matchByIndex
      ? order.items[index]
      : order.items.find(
          (item) =>
            item.productId.toString() === snapshot.productId.toString() &&
            item.selectedSize === snapshot.selectedSize &&
            item.selectedColor === snapshot.selectedColor
        );

    if (!orderItem) return;

    const sku = normalizeSku(orderItem.sku);
    if (sku && normalizeSku(snapshot.sku) !== sku) {
      snapshot.sku = sku;
      changed = true;
    }

    const cancelledQuantity = Math.min(orderItem.quantity, Math.max(0, orderItem.cancelledQuantity || 0));
    if ((snapshot.cancelledQuantity || 0) !== cancelledQuantity) {
      snapshot.cancelledQuantity = cancelledQuantity;
      changed = true;
    }
  });

  const fullyCancelled =
    order.status === 'CANCELLED' ||
    order.items.every((item) => (item.cancelledQuantity || 0) >= item.quantity);

  if (fullyCancelled && invoice.status === InvoiceStatus.ISSUED) {
    invoice.status = InvoiceStatus.REFUNDED;
    changed = true;
  }

  if (changed) {
    await invoice.save();
  }

  return invoice;
}

/**
 * GET /api/orders/:id/invoice - View Invoice JSON
 */
export async function getInvoiceByOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authUser = req.user;
    const orderIdStr = String(req.params.id);
    let order = null;
    if (mongoose.Types.ObjectId.isValid(orderIdStr)) {
      order = await Order.findById(orderIdStr);
    }
    if (!order) {
      order = await Order.findOne({ orderNumber: orderIdStr });
    }

    if (!order) {
      return next(new AppError('Order not found', 404, 'NOT_FOUND'));
    }

    // Ownership & Role Verification
    const isOwner = authUser?.id === order.userId.toString();
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(authUser?.role || '');

    if (!isOwner && !isAdmin) {
      return next(new AppError('Access denied to this invoice', 403, 'FORBIDDEN'));
    }

    const invoice = await getOrCreateInvoiceForOrder(order._id.toString());
    await reconcileInvoiceCancellations(invoice);

    // Audit Log for Admin invoice access
    if (isAdmin && authUser) {
      await AuditLog.create({
        actorId: authUser.id,
        actorRole: authUser.role,
        action: 'VIEW_INVOICE',
        entityType: 'Order',
        entityId: order._id,
        metadata: { invoiceNumber: invoice.invoiceNumber }
      }).catch(err => console.error('AuditLog error:', err));
    }

    res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/orders/:id/invoice/pdf - Download Invoice PDF Stream
 */
export async function downloadInvoicePDF(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authUser = req.user;
    const orderIdStr = String(req.params.id);
    let order = null;
    if (mongoose.Types.ObjectId.isValid(orderIdStr)) {
      order = await Order.findById(orderIdStr);
    }
    if (!order) {
      order = await Order.findOne({ orderNumber: orderIdStr });
    }

    if (!order) {
      return next(new AppError('Order not found', 404, 'NOT_FOUND'));
    }

    // Ownership & Role Verification
    const isOwner = authUser?.id === order.userId.toString();
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(authUser?.role || '');

    if (!isOwner && !isAdmin) {
      return next(new AppError('Access denied to this invoice', 403, 'FORBIDDEN'));
    }

    const invoice = await getOrCreateInvoiceForOrder(order._id.toString());
    await reconcileInvoiceCancellations(invoice);

    const creditNotes = await CreditNote.find({
      orderId: order._id,
      status: 'ISSUED',
    }).sort({ issuedAt: 1 });

    // Stream PDF response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Invoice-${invoice.invoiceNumber}.pdf"`);

    await ensureInvoiceFonts();
    const pdfDoc = generateInvoicePDFStream(invoice, creditNotes);
    pdfDoc.pipe(res);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/orders/:id/credit-notes - Get Credit Notes for an Order
 */
export async function getCreditNotesByOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authUser = req.user;
    const orderIdStr = String(req.params.id);
    let order = null;
    if (mongoose.Types.ObjectId.isValid(orderIdStr)) {
      order = await Order.findById(orderIdStr);
    }
    if (!order) {
      order = await Order.findOne({ orderNumber: orderIdStr });
    }

    if (!order) {
      return next(new AppError('Order not found', 404, 'NOT_FOUND'));
    }

    // Ownership & Role Verification
    const isOwner = authUser?.id === order.userId.toString();
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(authUser?.role || '');

    if (!isOwner && !isAdmin) {
      return next(new AppError('Access denied to credit notes', 403, 'FORBIDDEN'));
    }

    const creditNotes = await CreditNote.find({ orderId: order._id }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: creditNotes,
    });
  } catch (error) {
    next(error);
  }
}
