import { Request, Response } from 'express';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import { Order, IOrder } from '../models/Order';
import { Fulfillment, FulfillmentStatus, IFulfillment, IFulfillmentItem } from '../models/Fulfillment';
import { Shipment } from '../models/Shipment';
import { PrintJob, PrintJobStatus } from '../models/PrintJob';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import { renderPackingSlipDocument } from '../utils/packingSlipRenderer';
import { backfillOrderItemSkus } from '../services/skuService';
import { normalizeSku } from '../utils/skuFormat';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// Helper: quantity of an order line that still has to be picked and shipped.
// Cancelled (and refunded) units are never fulfilled.
const getActiveQuantity = (orderItem: { quantity: number; cancelledQuantity?: number }): number => {
  const quantity = Number(orderItem?.quantity) || 0;
  const cancelledQuantity = Math.min(quantity, Math.max(0, Number(orderItem?.cancelledQuantity) || 0));
  return Math.max(0, quantity - cancelledQuantity);
};

// Helper: mirror item cancellations onto an existing fulfillment snapshot so a
// cancelled unit is never picked, packed, or printed on a packing slip.
const syncFulfillmentWithOrder = async (order: IOrder, fulfillment: IFulfillment): Promise<IFulfillment> => {
  const orderItems = order.items || [];
  const fulfillmentItems = fulfillment.items || [];
  const matchByIndex = orderItems.length === fulfillmentItems.length;

  let changed = false;

  fulfillmentItems.forEach((fulfillmentItem: IFulfillmentItem, index: number) => {
    const orderItem = matchByIndex
      ? orderItems[index]
      : orderItems.find(
          (item) => item._id && item._id.toString() === String(fulfillmentItem.orderItemId)
        );

    if (!orderItem) return;

    const sku = normalizeSku(orderItem.sku);
    if (sku && normalizeSku(fulfillmentItem.sku) !== sku) {
      fulfillmentItem.sku = sku;
      changed = true;
    }

    const activeQuantity = getActiveQuantity(orderItem);

    if (fulfillmentItem.quantityOrdered !== activeQuantity) {
      fulfillmentItem.quantityOrdered = activeQuantity;
      changed = true;
    }
    if (fulfillmentItem.quantityPicked > activeQuantity) {
      fulfillmentItem.quantityPicked = activeQuantity;
      changed = true;
    }
    if (fulfillmentItem.quantityPacked > activeQuantity) {
      fulfillmentItem.quantityPacked = activeQuantity;
      changed = true;
    }
  });

  const fullyCancelled =
    fulfillmentItems.length > 0 &&
    fulfillmentItems.every((item) => item.quantityOrdered === 0);

  if (
    fullyCancelled &&
    fulfillment.status !== FulfillmentStatus.CANCELLED &&
    fulfillment.status !== FulfillmentStatus.HANDED_OVER
  ) {
    fulfillment.status = FulfillmentStatus.CANCELLED;
    changed = true;
  }

  if (changed) {
    await fulfillment.save();
  }

  return fulfillment;
};

// Helper: Ensure Fulfillment record exists for an order
const getOrCreateFulfillment = async (orderId: string, userId: string, adminId: string): Promise<IFulfillment> => {
  const [existingFulfillment, order] = await Promise.all([
    Fulfillment.findOne({ orderId }),
    Order.findById(orderId),
  ]);

  if (!order) throw new AppError('Order not found', 404);

  // Legacy orders may predate SKU snapshots; resolve them before creating or
  // syncing the fulfilment lines so the packing slip can always print a code.
  await backfillOrderItemSkus(order);

  let fulfillment = existingFulfillment;

  if (!fulfillment) {
    const items = order.items.map((item) => ({
      orderItemId: item._id ? item._id.toString() : new mongoose.Types.ObjectId().toString(),
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      sku: normalizeSku(item.sku) || undefined,
      selectedSize: item.selectedSize,
      selectedColor: item.selectedColor,
      quantityOrdered: getActiveQuantity(item),
      quantityPicked: 0,
      quantityPacked: 0,
      warehouseLocation: 'Main Warehouse',
      binLocation: 'A1-BIN',
      customDesignId: item.customDesignId
    }));

    fulfillment = await Fulfillment.create({
      orderId: order._id,
      userId: order.userId,
      status: FulfillmentStatus.UNALLOCATED,
      items,
      packageDetails: { weightGrams: 500, lengthCm: 30, widthCm: 25, heightCm: 5 },
      qc: { status: 'PENDING' },
      createdBy: adminId,
      updatedBy: adminId
    });
  }

  return syncFulfillmentWithOrder(order, fulfillment);
};

// 1. Get Fulfillment State
export const getFulfillment = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    const fulfillment = await getOrCreateFulfillment(id, order.userId.toString(), req.user.id);
    const printJobs = await PrintJob.find({ orderId: id });

    res.status(200).json({
      success: true,
      data: {
        fulfillment,
        printJobs
      }
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// 2. Allocate Order for Picking
export const allocateOrder = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    const fulfillment = await getOrCreateFulfillment(id, order.userId.toString(), req.user.id);

    if (fulfillment.status === FulfillmentStatus.UNALLOCATED) {
      fulfillment.status = FulfillmentStatus.ALLOCATED;
      fulfillment.updatedBy = new mongoose.Types.ObjectId(req.user.id);
      await fulfillment.save();

      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'ADMIN_ORDER_ALLOCATED',
        entityType: 'ORDER',
        entityId: order._id,
        metadata: { fulfillmentId: fulfillment._id }
      });
    }

    res.status(200).json({
      success: true,
      data: fulfillment,
      message: 'Order allocated for warehouse fulfillment.'
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// 3. Confirm Item Pick (No Inventory Sale Deduction)
export const pickFulfillment = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const pickedItems = req.body?.items;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    const fulfillment = await getOrCreateFulfillment(id, order.userId.toString(), req.user.id);

    if (fulfillment.items.every((item) => item.quantityOrdered === 0)) {
      throw new AppError('All items on this order were cancelled and refunded. Nothing left to pick.', 400);
    }

    if (pickedItems && Array.isArray(pickedItems)) {
      for (const pItem of pickedItems) {
        const item = fulfillment.items.find(
          i => i.productId.toString() === pItem.productId && i.variantId.toString() === pItem.variantId
        );
        if (item) {
          const qty = Number(pItem.quantityPicked);
          if (isNaN(qty) || qty < 0 || qty > item.quantityOrdered) {
            throw new AppError(`Picked quantity (${qty}) cannot exceed ordered quantity (${item.quantityOrdered})`, 400);
          }
          item.quantityPicked = qty;
        }
      }
    } else {
      // Auto-mark all ordered items as picked
      fulfillment.items.forEach(item => {
        item.quantityPicked = item.quantityOrdered;
      });
    }

    const allPicked = fulfillment.items.every(i => i.quantityPicked === i.quantityOrdered);
    fulfillment.status = allPicked ? FulfillmentStatus.PICKED : FulfillmentStatus.PICKING;
    fulfillment.pickedBy = new mongoose.Types.ObjectId(req.user.id);
    fulfillment.pickedAt = new Date();
    fulfillment.updatedBy = new mongoose.Types.ObjectId(req.user.id);
    await fulfillment.save();

    await AuditLog.create({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ADMIN_ORDER_PICKED',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: { fulfillmentId: fulfillment._id, status: fulfillment.status }
    });

    res.status(200).json({
      success: true,
      data: fulfillment,
      message: 'Items picked successfully.'
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// 4. Confirm Packing
export const packFulfillment = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { packageDetails } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    const fulfillment = await getOrCreateFulfillment(id, order.userId.toString(), req.user.id);

    if (fulfillment.items.every((item) => item.quantityOrdered === 0)) {
      throw new AppError('All items on this order were cancelled and refunded. Nothing left to pack.', 400);
    }

    const unpicked = fulfillment.items.filter(i => i.quantityPicked < i.quantityOrdered);
    if (unpicked.length > 0) {
      throw new AppError('Cannot pack order before all ordered items are fully picked.', 400);
    }

    fulfillment.items.forEach(item => {
      item.quantityPacked = item.quantityPicked;
    });

    if (packageDetails) {
      const w = Number(packageDetails.weightGrams);
      const l = Number(packageDetails.lengthCm);
      const wi = Number(packageDetails.widthCm);
      const h = Number(packageDetails.heightCm);

      fulfillment.packageDetails = {
        weightGrams: Number.isFinite(w) && w > 0 ? Math.round(w) : 500,
        lengthCm: Number.isFinite(l) && l > 0 ? Math.round(l * 10) / 10 : 30,
        widthCm: Number.isFinite(wi) && wi > 0 ? Math.round(wi * 10) / 10 : 25,
        heightCm: Number.isFinite(h) && h > 0 ? Math.round(h * 10) / 10 : 5,
        packedBy: new mongoose.Types.ObjectId(req.user.id),
        packedAt: new Date(),
        isConfirmed: false,
        confirmedAt: undefined,
        confirmedBy: undefined
      };
    } else if (fulfillment.packageDetails) {
      fulfillment.packageDetails.isConfirmed = false;
      fulfillment.packageDetails.confirmedAt = undefined;
      fulfillment.packageDetails.confirmedBy = undefined;
    }

    fulfillment.status = FulfillmentStatus.PACKED;
    fulfillment.packedBy = new mongoose.Types.ObjectId(req.user.id);
    fulfillment.packedAt = new Date();
    fulfillment.updatedBy = new mongoose.Types.ObjectId(req.user.id);
    await fulfillment.save();

    await AuditLog.create({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ADMIN_ORDER_PACKED',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: { fulfillmentId: fulfillment._id }
    });

    res.status(200).json({
      success: true,
      data: fulfillment,
      message: 'Order packed successfully.'
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// 5. Generate Streamed Packing Slip PDF (Distinct from Invoice & Label)
export const getPackingSlipPDF = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    const fulfillment = await getOrCreateFulfillment(id, order.userId.toString(), req.user?.id || order.userId.toString());

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=PackingSlip-${order.orderNumber}.pdf`);

    const doc = new PDFDocument({
      margin: 36,
      size: 'A4',
      info: {
        Title: `Packing Slip - ${order.orderNumber}`,
        Author: 'Samrat Fashion (THREADVIBE)',
        Subject: `Warehouse Packing Slip #${order.orderNumber}`,
      },
    });
    doc.pipe(res);

    renderPackingSlipDocument(doc, order, fulfillment);

    doc.end();
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// 6. Quality Control Check
export const qcCheckFulfillment = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status, notes, checks } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!['PASSED', 'FAILED'].includes(status)) throw new AppError('QC status must be PASSED or FAILED', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    const fulfillment = await getOrCreateFulfillment(id, order.userId.toString(), req.user.id);

    // Custom Print QC Dependency Check
    const hasCustomItems = order.items.some(i => i.isCustomized || i.customDesignId);
    if (hasCustomItems && status === 'PASSED') {
      // 1. Enforce mockup approval for all custom items
      for (const item of order.items) {
        if (item.isCustomized || item.customDesignId) {
          const isApprovedOrLegacy = item.approvalStatus === 'approved' || item.approvalStatus === 'in_production' || item.approvalStatus === undefined;
          if (!isApprovedOrLegacy) {
            throw new AppError(
              `Order contains unapproved custom item (${item.productName || item.productId}). Customer mockup approval is required before Quality Check (QC) PASS.`,
              400,
              'QC_MOCKUP_APPROVAL_REQUIRED'
            );
          }
        }
      }

      // 2. Enforce Print Job completion
      const printJobs = await PrintJob.find({ orderId: id });
      const uncompletedPrint = printJobs.find(
        pj => ![PrintJobStatus.COMPLETED, PrintJobStatus.PRINTED].includes(pj.status)
      );

      if (uncompletedPrint || printJobs.length === 0) {
        throw new AppError(
          'Custom print production must be COMPLETED before Quality Check (QC) PASS.',
          400,
          'QC_PRODUCTION_DEPENDENCY_ERROR'
        );
      }
    }

    fulfillment.qc = {
      status,
      notes: notes || '',
      qcBy: new mongoose.Types.ObjectId(req.user.id),
      passedAt: status === 'PASSED' ? new Date() : undefined,
      failedAt: status === 'FAILED' ? new Date() : undefined,
      checks: checks || { itemMatch: true, quantityMatch: true, qualityMatch: true }
    };

    fulfillment.status = status === 'PASSED' ? FulfillmentStatus.QC_PASSED : FulfillmentStatus.QC_FAILED;
    fulfillment.qcBy = new mongoose.Types.ObjectId(req.user.id);
    fulfillment.qcAt = new Date();
    fulfillment.updatedBy = new mongoose.Types.ObjectId(req.user.id);
    await fulfillment.save();

    await AuditLog.create({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: status === 'PASSED' ? 'ADMIN_ORDER_QC_PASSED' : 'ADMIN_ORDER_QC_FAILED',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: { fulfillmentId: fulfillment._id, notes }
    });

    res.status(200).json({
      success: true,
      data: fulfillment,
      message: `Quality Check (QC) set to ${status}.`
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// 7. Mark Ready to Ship
export const markReadyToShip = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    if (order.paymentStatus !== 'PAID') {
      throw new AppError('Order payment must be PAID before marking Ready to Ship', 400);
    }

    const fulfillment = await getOrCreateFulfillment(id, order.userId.toString(), req.user.id);

    if (fulfillment.qc?.status !== 'PASSED') {
      throw new AppError('Order must pass Quality Check (QC) before marking Ready to Ship', 400);
    }

    const unpicked = fulfillment.items.filter(i => i.quantityPicked < i.quantityOrdered);
    if (unpicked.length > 0) {
      throw new AppError('All items must be picked before marking Ready to Ship', 400);
    }

    fulfillment.status = FulfillmentStatus.READY_TO_SHIP;
    fulfillment.readyToShipAt = new Date();
    fulfillment.updatedBy = new mongoose.Types.ObjectId(req.user.id);
    await fulfillment.save();

    await AuditLog.create({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ADMIN_ORDER_READY_TO_SHIP',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: { fulfillmentId: fulfillment._id }
    });

    res.status(200).json({
      success: true,
      data: fulfillment,
      message: 'Order marked READY TO SHIP for courier dispatch.'
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/admin/orders/:id/fulfillment/package-details
 * Explicitly confirm or update actual packed parcel weight and dimensions
 */
export const confirmFulfillmentPackage = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { weightGrams, lengthCm, widthCm, heightCm } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    if (weightGrams === undefined || weightGrams === null || weightGrams === '' || typeof weightGrams === 'boolean') {
      throw new AppError('Packed weight (in grams) is required.', 400, 'INVALID_PACKAGE_DETAILS');
    }
    if (lengthCm === undefined || lengthCm === null || lengthCm === '' || typeof lengthCm === 'boolean') {
      throw new AppError('Packed length (in cm) is required.', 400, 'INVALID_PACKAGE_DETAILS');
    }
    if (widthCm === undefined || widthCm === null || widthCm === '' || typeof widthCm === 'boolean') {
      throw new AppError('Packed width (in cm) is required.', 400, 'INVALID_PACKAGE_DETAILS');
    }
    if (heightCm === undefined || heightCm === null || heightCm === '' || typeof heightCm === 'boolean') {
      throw new AppError('Packed height (in cm) is required.', 400, 'INVALID_PACKAGE_DETAILS');
    }

    const w = Number(weightGrams);
    const l = Number(lengthCm);
    const wi = Number(widthCm);
    const h = Number(heightCm);

    if (!Number.isFinite(w) || w <= 0) {
      throw new AppError('Packed weight (in grams) must be a finite positive number greater than 0.', 400, 'INVALID_PACKAGE_DETAILS');
    }
    if (!Number.isFinite(l) || l <= 0) {
      throw new AppError('Packed length (in cm) must be a finite positive number greater than 0.', 400, 'INVALID_PACKAGE_DETAILS');
    }
    if (!Number.isFinite(wi) || wi <= 0) {
      throw new AppError('Packed width (in cm) must be a finite positive number greater than 0.', 400, 'INVALID_PACKAGE_DETAILS');
    }
    if (!Number.isFinite(h) || h <= 0) {
      throw new AppError('Packed height (in cm) must be a finite positive number greater than 0.', 400, 'INVALID_PACKAGE_DETAILS');
    }
    // Existing-Shipment Protection: Cannot confirm/modify package details once shipment exists
    const existingShipment = await Shipment.findOne({ orderId: order._id });
    if (existingShipment) {
      throw new AppError(
        'Cannot modify package measurements: a shipment has already been created for this order.',
        400,
        'SHIPMENT_ALREADY_EXISTS'
      );
    }

    const fulfillment = await Fulfillment.findOne({ orderId: order._id });
    if (!fulfillment) {
      throw new AppError('Fulfillment record not found for this order.', 404, 'FULFILLMENT_NOT_FOUND');
    }

    // Strict State Restriction: Package confirmation is only permitted when fulfillment is READY_TO_SHIP
    if (fulfillment.status !== FulfillmentStatus.READY_TO_SHIP) {
      throw new AppError(
        `Package measurements can only be confirmed when fulfillment is in READY_TO_SHIP status (current status: ${fulfillment.status}).`,
        400,
        'FULFILLMENT_NOT_READY_TO_SHIP'
      );
    }
    fulfillment.packageDetails = {
      weightGrams: Math.round(w),
      lengthCm: Math.round(l * 10) / 10,
      widthCm: Math.round(wi * 10) / 10,
      heightCm: Math.round(h * 10) / 10,
      packedBy: fulfillment.packageDetails?.packedBy || new mongoose.Types.ObjectId(req.user.id),
      packedAt: fulfillment.packageDetails?.packedAt || new Date(),
      isConfirmed: true,
      confirmedAt: new Date(),
      confirmedBy: new mongoose.Types.ObjectId(req.user.id)
    };
    fulfillment.updatedBy = new mongoose.Types.ObjectId(req.user.id);
    await fulfillment.save();

    await AuditLog.create({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ADMIN_PACKAGE_DETAILS_CONFIRMED',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: { fulfillmentId: fulfillment._id, packageDetails: fulfillment.packageDetails }
    });

    res.status(200).json({
      success: true,
      data: fulfillment,
      message: 'Package dimensions and weight confirmed successfully.'
    });
  } catch (error: unknown) {
    const errObj = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
    const status = typeof errObj.statusCode === 'number' ? errObj.statusCode : 500;
    const message = typeof errObj.message === 'string' ? errObj.message : 'Failed to confirm package details';
    res.status(status).json({ success: false, message });
  }
};
