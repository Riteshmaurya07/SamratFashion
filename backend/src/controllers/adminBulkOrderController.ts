import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { BulkOrderRequest, BulkRequestStatus } from "../models/BulkOrderRequest";
import { BulkQuote, BulkQuoteStatus } from "../models/BulkQuote";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// 1. Get Paginated Admin Bulk Order Requests
export const getAdminBulkRequests = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    const status = req.query.status as string;
    const q = req.query.q as string;

    const filter: any = {};
    if (status && status !== "All") filter.status = status;

    const total = await BulkOrderRequest.countDocuments(filter);
    const requests = await BulkOrderRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name email phone")
      .populate("productId", "name images basePrice");

    let results = requests;
    if (q) {
      const lower = q.toLowerCase();
      results = results.filter(
        (r: any) =>
          r.quoteNumber.toLowerCase().includes(lower) ||
          r.organizationName.toLowerCase().includes(lower) ||
          r.contactName.toLowerCase().includes(lower) ||
          r.email.toLowerCase().includes(lower)
      );
    }

    res.status(200).json({
      success: true,
      data: results,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get Single Admin Bulk Request Detail
export const getAdminBulkRequestById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return next(new AppError("Invalid Bulk Request ID", 400));
    }

    const request = await BulkOrderRequest.findById(id)
      .populate("userId", "name email phone")
      .populate("productId")
      .populate("customDesignId");

    if (!request) {
      return next(new AppError("Bulk order request not found", 404));
    }

    const existingQuote = await BulkQuote.findOne({ bulkRequestId: request._id });

    res.status(200).json({
      success: true,
      data: {
        request,
        existingQuote,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 3. Issue / Update B2B Quotation (Admin)
export const createAdminQuote = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { productPrice, printingFee, setupFee, discount, shipping, validUntilDays } = req.body;

    const request = await BulkOrderRequest.findById(id);
    if (!request) {
      return next(new AppError("Bulk order request not found", 404));
    }

    const prodPricePaise = Math.round((Number(productPrice) || 0) * 100);
    const printFeePaise = Math.round((Number(printingFee) || 0) * 100);
    const setupFeePaise = Math.round((Number(setupFee) || 0) * 100);
    const discountPaise = Math.round((Number(discount) || 0) * 100);
    const shippingPaise = Math.round((Number(shipping) || 0) * 100);

    const subtotal = prodPricePaise + printFeePaise + setupFeePaise - discountPaise;
    const tax = Math.round(subtotal * 0.18); // 18% GST
    const total = subtotal + tax + shippingPaise;

    const validDays = Number(validUntilDays) || 7;
    const validUntil = new Date(Date.now() + 86400000 * validDays);

    let quote = await BulkQuote.findOne({ bulkRequestId: request._id });
    if (quote) {
      quote.productPrice = prodPricePaise;
      quote.printingFee = printFeePaise;
      quote.setupFee = setupFeePaise;
      quote.discount = discountPaise;
      quote.subtotal = subtotal;
      quote.tax = tax;
      quote.shipping = shippingPaise;
      quote.total = total;
      quote.validUntil = validUntil;
      quote.status = BulkQuoteStatus.SENT;
      await quote.save();
    } else {
      quote = await BulkQuote.create({
        quoteNumber: request.quoteNumber,
        bulkRequestId: request._id,
        userId: request.userId,
        productPrice: prodPricePaise,
        printingFee: printFeePaise,
        setupFee: setupFeePaise,
        discount: discountPaise,
        subtotal,
        tax,
        shipping: shippingPaise,
        total,
        validUntil,
        status: BulkQuoteStatus.SENT,
      });
    }

    request.status = BulkRequestStatus.QUOTED;
    await request.save();

    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_BULK_QUOTE_SENT",
        entityType: "BULK_QUOTE",
        entityId: quote._id.toString(),
        metadata: { total: quote.total, quoteNumber: quote.quoteNumber },
      });
    }

    res.status(200).json({
      success: true,
      message: "B2B Quotation issued and sent to customer.",
      data: {
        request,
        quote,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 4. Update Bulk Request Status
export const updateBulkStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!Object.values(BulkRequestStatus).includes(status)) {
      return next(new AppError("Invalid bulk request status value", 400));
    }

    const request = await BulkOrderRequest.findById(id);
    if (!request) {
      return next(new AppError("Bulk order request not found", 404));
    }

    request.status = status as BulkRequestStatus;
    await request.save();

    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_BULK_REQUEST_REVIEWED",
        entityType: "BULK_REQUEST",
        entityId: request._id.toString(),
        metadata: { newStatus: status },
      });
    }

    res.status(200).json({
      success: true,
      message: `Bulk request status updated to ${status}`,
      data: request,
    });
  } catch (error) {
    next(error);
  }
};
