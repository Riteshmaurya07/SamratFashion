import { Request, Response, NextFunction } from 'express';
import { Invoice, InvoiceStatus, IInvoice } from '../models/Invoice';
import { Order } from '../models/Order';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { generateInvoicePDFStream } from '../utils/pdfInvoiceGenerator';
import { AuditLog } from '../models/AuditLog';
import { incrementCounter } from '../models/Counter';

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
  const isPaid = order.paymentStatus === 'PAID';
  const isConfirmedCod = order.paymentStatus === 'PENDING' && ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status);

  if (!isPaid && !isConfirmedCod) {
    throw new AppError('Invoice cannot be generated for an unpaid, failed, or cancelled order', 400, 'BAD_REQUEST');
  }

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

  // 6. Snapshot Order & Customer state
  const newInvoice = new Invoice({
    invoiceNumber,
    orderId: order._id,
    userId: order.userId,
    orderNumber: order.orderNumber,
    status: InvoiceStatus.ISSUED,
    issuedAt: new Date(),
    customerSnapshot: {
      name: user?.name || order.shippingAddress.fullName,
      email: user?.email || '',
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
      selectedSize: item.selectedSize,
      selectedColor: item.selectedColor,
      quantity: item.quantity,
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

  await newInvoice.save();
  return newInvoice;
}

/**
 * GET /api/orders/:id/invoice - View Invoice JSON
 */
export async function getInvoiceByOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const authUser = (req as any).user;
    const orderIdStr = String(req.params.id);
    const mongoose = require('mongoose');
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

    // Audit Log for Admin invoice access
    if (isAdmin) {
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
export async function downloadInvoicePDF(req: Request, res: Response, next: NextFunction) {
  try {
    const authUser = (req as any).user;
    const orderIdStr = String(req.params.id);
    const mongoose = require('mongoose');
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

    // Stream PDF response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Invoice-${invoice.invoiceNumber}.pdf"`);

    const pdfDoc = generateInvoicePDFStream(invoice);
    pdfDoc.pipe(res);
  } catch (error) {
    next(error);
  }
}
