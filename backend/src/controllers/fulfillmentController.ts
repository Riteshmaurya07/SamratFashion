import { Request, Response } from 'express';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import { Order } from '../models/Order';
import { Fulfillment, FulfillmentStatus } from '../models/Fulfillment';
import { PrintJob, PrintJobStatus } from '../models/PrintJob';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// Helper: Ensure Fulfillment record exists for an order
const getOrCreateFulfillment = async (orderId: string, userId: string, adminId: string) => {
  let fulfillment = await Fulfillment.findOne({ orderId });
  if (!fulfillment) {
    const order = await Order.findById(orderId);
    if (!order) throw new AppError('Order not found', 404);

    const items = order.items.map((item: any) => ({
      orderItemId: item._id ? item._id.toString() : new mongoose.Types.ObjectId().toString(),
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      selectedSize: item.selectedSize,
      selectedColor: item.selectedColor,
      quantityOrdered: item.quantity,
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
  return fulfillment;
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
    const { items: pickedItems } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    const fulfillment = await getOrCreateFulfillment(id, order.userId.toString(), req.user.id);

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
    const { packageDetails } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid order ID', 400);
    if (!req.user) throw new AppError('Unauthorized', 401);

    const order = await Order.findById(id);
    if (!order) throw new AppError('Order not found', 404);

    const fulfillment = await getOrCreateFulfillment(id, order.userId.toString(), req.user.id);

    const unpicked = fulfillment.items.filter(i => i.quantityPicked < i.quantityOrdered);
    if (unpicked.length > 0) {
      throw new AppError('Cannot pack order before all ordered items are fully picked.', 400);
    }

    fulfillment.items.forEach(item => {
      item.quantityPacked = item.quantityPicked;
    });

    if (packageDetails) {
      fulfillment.packageDetails = {
        weightGrams: Number(packageDetails.weightGrams) || 500,
        lengthCm: Number(packageDetails.lengthCm) || 30,
        widthCm: Number(packageDetails.widthCm) || 25,
        heightCm: Number(packageDetails.heightCm) || 5,
        packedBy: new mongoose.Types.ObjectId(req.user.id),
        packedAt: new Date()
      };
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

    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    doc.pipe(res);

    // Header
    doc.fontSize(20).text('SAMRAT FASHION — WAREHOUSE PACKING SLIP', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Order Ref: ${order.orderNumber} | Date: ${new Date().toLocaleDateString('en-IN')}`, { align: 'center' });
    doc.moveDown(1);
    doc.moveTo(36, doc.y).lineTo(559, doc.y).stroke('#CCCCCC');
    doc.moveDown(1);

    // Address & Warehouse Info
    doc.fontSize(12).text('RECIPIENT / SHIPPING ADDRESS:', { underline: true });
    doc.fontSize(10).text(order.shippingAddress.fullName);
    doc.text(`${order.shippingAddress.addressLine1} ${order.shippingAddress.addressLine2 || ''}`);
    doc.text(`${order.shippingAddress.city}, ${order.shippingAddress.state} - ${order.shippingAddress.postalCode}`);
    doc.text(`Phone: ${order.shippingAddress.phone}`);
    doc.moveDown(1);

    doc.fontSize(12).text('FULFILLMENT DETAILS:', { underline: true });
    doc.fontSize(10).text(`Status: ${fulfillment.status}`);
    doc.text(`Location: Main Warehouse (Bin A1-BIN)`);
    doc.text(`Weight: ${fulfillment.packageDetails?.weightGrams || 500}g`);
    doc.moveDown(1);
    doc.moveTo(36, doc.y).lineTo(559, doc.y).stroke('#CCCCCC');
    doc.moveDown(1);

    // Items Table
    doc.fontSize(12).text('PACKED ITEMS LIST:', { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(10).text('Product Name', 36, doc.y, { width: 220 });
    doc.text('Size / Color', 260, doc.y - 12, { width: 120 });
    doc.text('Ordered', 390, doc.y - 12, { width: 70 });
    doc.text('Packed', 470, doc.y - 12, { width: 70 });
    doc.moveDown(0.5);

    fulfillment.items.forEach(item => {
      doc.fontSize(9).text(item.productName, 36, doc.y, { width: 220 });
      doc.text(`${item.selectedSize} / ${item.selectedColor}`, 260, doc.y - 11, { width: 120 });
      doc.text(String(item.quantityOrdered), 390, doc.y - 11, { width: 70 });
      doc.text(String(item.quantityPacked || item.quantityOrdered), 470, doc.y - 11, { width: 70 });
      doc.moveDown(0.5);
    });

    doc.moveDown(2);
    doc.font('Helvetica-Oblique').fontSize(9).text('NOTE: This packing slip is for warehouse verification. Not a financial tax invoice or shipping label.', { align: 'center' });

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
    const hasCustomItems = order.items.some(i => i.customDesignId);
    if (hasCustomItems && status === 'PASSED') {
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
