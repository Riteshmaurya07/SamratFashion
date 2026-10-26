import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { BulkOrderRequest, BulkRequestStatus } from "../models/BulkOrderRequest";
import { BulkQuote, BulkQuoteStatus } from "../models/BulkQuote";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";
import { calculateAuthoritativeBulkPricing } from "../services/volumePricingService";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

const mockupUploadSchema = z.object({
  mockupUrl: z.string().url(),
  notes: z.string().trim().max(1000).optional(),
});

// 1. Get Paginated Admin Bulk Order Requests
export const getAdminBulkRequests = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    const status = req.query.status as string;
    const q = req.query.q as string;

    const filter: Record<string, unknown> = {};
    if (status && status !== "All") filter.status = status;

    if (q) {
      filter.$or = [
        { quoteNumber: { $regex: q, $options: "i" } },
        { organizationName: { $regex: q, $options: "i" } },
        { contactName: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
      ];
    }

    const total = await BulkOrderRequest.countDocuments(filter);
    const requests = await BulkOrderRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name email phone")
      .populate("productId", "name images basePrice")
      .populate("catalogItemId", "name slug mockupImageUrl");

    res.status(200).json({
      success: true,
      data: {
        requests,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get Single Admin Bulk Request Detail with Suggested Authoritative Quote
export const getAdminBulkRequestById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return next(new AppError("Invalid Bulk Request ID", 400));
    }

    const request = await BulkOrderRequest.findById(id)
      .populate("userId", "name email phone")
      .populate("productId")
      .populate("catalogItemId")
      .populate("customDesignId")
      .populate("mockupHistory.uploadedBy", "name email");

    if (!request) {
      return next(new AppError("Bulk order request not found", 404));
    }

    const existingQuote = await BulkQuote.findOne({ bulkRequestId: request._id });

    // Calculate suggested quote using the backend authoritative pricing rules
    let suggestedQuote = null;
    try {
      if (request.productId) {
        suggestedQuote = await calculateAuthoritativeBulkPricing({
          productId: request.productId._id,
          catalogItemId: request.catalogItemId?._id,
          totalQuantity: request.totalQuantity,
          printLocationsCount: request.printLocations?.length || 1,
        });
      }
    } catch (pricingErr) {
      console.warn("Failed to calculate suggested quote for request", request._id, pricingErr);
    }

    res.status(200).json({
      success: true,
      data: {
        request,
        existingQuote,
        suggestedQuote,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 3. Attach & Share Mockup with Customer (Staff/Admin)
export const uploadAdminMockup = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return next(new AppError("Invalid Bulk Request ID", 400));
    }

    const parsed = mockupUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(parsed.error.issues[0]?.message || "Invalid mockup URL or notes", 400));
    }

    const request = await BulkOrderRequest.findById(id);
    if (!request) {
      return next(new AppError("Bulk order request not found", 404));
    }

    const newVersion = (request.mockupHistory?.length || 0) + 1;
    const historyEntry = {
      version: newVersion,
      mockupUrl: parsed.data.mockupUrl,
      notes: parsed.data.notes,
      uploadedBy: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
      uploadedAt: new Date(),
    };

    request.mockupHistory = request.mockupHistory || [];
    request.mockupHistory.push(historyEntry);
    request.currentMockupUrl = parsed.data.mockupUrl;
    request.status = BulkRequestStatus.MOCKUP_SHARED;
    await request.save();

    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_BULK_MOCKUP_SHARED",
        entityType: "BULK_ORDER_REQUEST",
        entityId: request._id.toString(),
        metadata: { version: newVersion, mockupUrl: parsed.data.mockupUrl },
      });
    }

    res.status(200).json({
      success: true,
      message: `Mockup v${newVersion} shared with customer successfully.`,
      data: request,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Issue / Update B2B Quotation (Admin)
export const createAdminQuote = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { productPrice, printingFee, setupFee, discount, shipping, validUntilDays, notes } = req.body;

    const request = await BulkOrderRequest.findById(id);
    if (!request) {
      return next(new AppError("Bulk order request not found", 404));
    }

    // Validate financial inputs (in ₹)
    const numericFields: Record<string, unknown> = { productPrice, printingFee, setupFee, discount, shipping };
    for (const [key, value] of Object.entries(numericFields)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        return next(new AppError(`${key} must be a non-negative number`, 400));
      }
    }

    const prodPricePaise = Math.round((Number(productPrice) || 0) * 100);
    const printFeePaise = Math.round((Number(printingFee) || 0) * 100);
    const setupFeePaise = Math.round((Number(setupFee) || 0) * 100);
    const discountPaise = Math.round((Number(discount) || 0) * 100);
    const shippingPaise = Math.round((Number(shipping) || 0) * 100);

    const subtotal = prodPricePaise + printFeePaise + setupFeePaise - discountPaise;
    if (subtotal < 0) {
      return next(new AppError("Discount cannot exceed product and fee totals", 400));
    }
    const tax = Math.round(subtotal * 0.18); // 18% GST in paise
    const total = subtotal + tax + shippingPaise;
    if (total <= 0) {
      return next(new AppError("Quotation total must be greater than zero", 400));
    }

    const validDays = Number(validUntilDays) || 7;
    const validUntil = new Date(Date.now() + 86400000 * validDays);

    let quote = await BulkQuote.findOne({ bulkRequestId: request._id });
    if (quote && (quote.status === BulkQuoteStatus.ACCEPTED || quote.convertedOrderId)) {
      return next(new AppError("This quotation has already been accepted and cannot be re-issued", 400));
    }

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
      if (notes) quote.notes = notes;
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
        notes,
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

// 5. Update Bulk Request Status
export const updateBulkStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!Object.values(BulkRequestStatus).includes(status)) {
      return next(new AppError("Invalid Bulk Request Status", 400));
    }

    const request = await BulkOrderRequest.findById(id);
    if (!request) {
      return next(new AppError("Bulk order request not found", 404));
    }

    request.status = status;
    await request.save();

    res.status(200).json({
      success: true,
      message: `Bulk request status updated to ${status}`,
      data: request,
    });
  } catch (error) {
    next(error);
  }
};
