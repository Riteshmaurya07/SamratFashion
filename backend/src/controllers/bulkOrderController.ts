import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { BulkOrderRequest, BulkRequestStatus } from "../models/BulkOrderRequest";
import { BulkQuote, BulkQuoteStatus } from "../models/BulkQuote";
import { Product } from "../models/Product";
import { CustomDesign } from "../models/CustomDesign";
import { Order } from "../models/Order";
import { AppError } from "../utils/AppError";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

const bulkRequestSchema = z.object({
  organizationName: z.string().min(2).max(120),
  contactName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(8),
  productId: z.string().min(1),
  variantBreakdown: z.object({
    S: z.number().int().min(0).optional(),
    M: z.number().int().min(0).optional(),
    L: z.number().int().min(0).optional(),
    XL: z.number().int().min(0).optional(),
    XXL: z.number().int().min(0).optional(),
  }),
  colorAllocation: z.string().optional(),
  customPrintingRequired: z.boolean().optional(),
  customDesignId: z.string().optional(),
  printLocations: z.array(z.string()).optional(),
  printMethod: z.string().optional(),
  deliveryLocation: z.string().min(3),
  requiredByDate: z.string().optional(),
  customerNote: z.string().max(1000).optional(),
});

// Helper: Generate unique human-friendly quote number (e.g. QT202608190842)
async function generateQuoteNumber(): Promise<string> {
  const timestamp = Date.now().toString().slice(-8);
  const quoteNum = `QT${timestamp}`;

  const exists = await BulkOrderRequest.findOne({ quoteNumber: quoteNum });
  if (exists) return generateQuoteNumber();
  return quoteNum;
}

// 1. Submit Bulk Order Quote Request (Customer)
export const createBulkRequest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const parseResult = bulkRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return next(new AppError(parseResult.error.issues[0]?.message || "Invalid bulk request data", 400));
    }

    const {
      organizationName,
      contactName,
      email,
      phone,
      productId,
      variantBreakdown,
      colorAllocation,
      customPrintingRequired,
      customDesignId,
      printLocations,
      printMethod,
      deliveryLocation,
      requiredByDate,
      customerNote,
    } = parseResult.data;

    // Verify Active Product
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return next(new AppError("Invalid Product ID", 400));
    }
    const product = await Product.findOne({ _id: productId, status: "ACTIVE" } as any);
    if (!product) {
      return next(new AppError("Selected product is unavailable for bulk order", 400));
    }

    // Calculate & validate total quantity (minimum 10 units)
    const totalQuantity =
      (variantBreakdown.S || 0) +
      (variantBreakdown.M || 0) +
      (variantBreakdown.L || 0) +
      (variantBreakdown.XL || 0) +
      (variantBreakdown.XXL || 0);

    if (totalQuantity < 10) {
      return next(new AppError("Minimum bulk order quantity is 10 units", 400));
    }

    // Verify Custom Design Ownership if provided
    let verifiedDesignId: mongoose.Types.ObjectId | undefined = undefined;
    if (customDesignId) {
      if (!mongoose.Types.ObjectId.isValid(customDesignId)) {
        return next(new AppError("Invalid Custom Design ID", 400));
      }
      const design = await CustomDesign.findOne({ _id: customDesignId, userId: req.user.id } as any);
      if (!design) {
        return next(new AppError("Attached custom design not found or not owned by your account", 400));
      }
      verifiedDesignId = design._id as mongoose.Types.ObjectId;
    }

    const quoteNumber = await generateQuoteNumber();

    const bulkRequest = await BulkOrderRequest.create({
      quoteNumber,
      userId: req.user.id,
      organizationName: organizationName.trim(),
      contactName: contactName.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      productId,
      variantBreakdown,
      totalQuantity,
      colorAllocation: colorAllocation?.trim(),
      customPrintingRequired: customPrintingRequired || false,
      customDesignId: verifiedDesignId,
      printLocations: printLocations || ["FRONT"],
      printMethod: printMethod || "DTF Transfer",
      deliveryLocation: deliveryLocation.trim(),
      requiredByDate: requiredByDate ? new Date(requiredByDate) : undefined,
      customerNote: customerNote?.trim(),
      status: BulkRequestStatus.REQUESTED,
    });

    res.status(201).json({
      success: true,
      message: "Bulk order quote request submitted successfully.",
      data: bulkRequest,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get Customer's Bulk Requests & Quotes
export const getMyBulkRequests = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const requests = await BulkOrderRequest.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .populate("productId", "name images basePrice");

    const quotes = await BulkQuote.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .populate("bulkRequestId");

    res.status(200).json({
      success: true,
      data: {
        requests,
        quotes,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get Single Quotation Detail Scoped to Customer
export const getQuoteById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const quoteIdStr = Array.isArray(req.params.quoteId) ? req.params.quoteId[0] : req.params.quoteId;

    const filter: any = {
      $or: [{ _id: mongoose.Types.ObjectId.isValid(quoteIdStr) ? quoteIdStr : null }, { quoteNumber: quoteIdStr }],
      userId: req.user.id,
    };

    const quote = await BulkQuote.findOne(filter)
      .populate({
        path: "bulkRequestId",
        populate: [
          { path: "productId", select: "name images basePrice description" },
          { path: "customDesignId" },
        ],
      })
      .populate("userId", "name email phone");

    if (!quote) {
      return next(new AppError("Bulk quotation not found", 404));
    }

    res.status(200).json({
      success: true,
      data: quote,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Accept Quote & Convert to Order (Customer)
export const acceptQuote = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const quoteIdStr = Array.isArray(req.params.quoteId) ? req.params.quoteId[0] : req.params.quoteId;

    const filter: any = {
      $or: [{ _id: mongoose.Types.ObjectId.isValid(quoteIdStr) ? quoteIdStr : null }, { quoteNumber: quoteIdStr }],
      userId: req.user.id,
    };

    const quote = await BulkQuote.findOne(filter).populate("bulkRequestId");

    if (!quote) {
      return next(new AppError("Bulk quotation not found", 404));
    }

    if (quote.status === BulkQuoteStatus.ACCEPTED) {
      return next(new AppError("This quotation has already been accepted and converted to an order", 400));
    }

    if (quote.status === BulkQuoteStatus.EXPIRED || new Date(quote.validUntil) < new Date()) {
      quote.status = BulkQuoteStatus.EXPIRED;
      await quote.save();
      return next(new AppError("This quotation has expired and can no longer be accepted", 400));
    }

    const bulkReq = quote.bulkRequestId as any;
    const product = await Product.findById(bulkReq.productId);
    if (!product) {
      return next(new AppError("Quoted product is no longer available", 400));
    }

    const variant = product.variants[0];

    // Convert Quote to Order
    const orderNumber = `SF-ORD-BULK-${Date.now()}`;
    const order = await Order.create({
      orderNumber,
      userId: req.user.id,
      items: [
        {
          productId: product._id,
          variantId: variant._id,
          productName: `Bulk: ${product.name} (${bulkReq.totalQuantity} units)`,
          productImage: product.images[0] || "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500",
          selectedSize: "VARIOUS",
          selectedColor: bulkReq.colorAllocation || "VARIOUS",
          quantity: bulkReq.totalQuantity,
          unitPrice: Math.round(quote.subtotal / bulkReq.totalQuantity),
          lineTotal: quote.subtotal,
        },
      ],
      shippingAddress: {
        fullName: bulkReq.contactName,
        phone: bulkReq.phone,
        addressLine1: bulkReq.deliveryLocation,
        city: "City",
        state: "State",
        postalCode: "110001",
        country: "India",
        addressType: "WORK",
      },
      subtotal: quote.subtotal,
      discount: quote.discount,
      shipping: quote.shipping,
      tax: quote.tax,
      total: quote.total,
      currency: "INR",
      status: "PENDING",
      paymentStatus: "PENDING",
    });

    quote.status = BulkQuoteStatus.ACCEPTED;
    quote.convertedOrderId = order._id as mongoose.Types.ObjectId;
    await quote.save();

    bulkReq.status = BulkRequestStatus.ACCEPTED;
    await bulkReq.save();

    res.status(200).json({
      success: true,
      message: "Quotation accepted successfully. Proceed to payment for fulfillment.",
      data: {
        quote,
        order,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 5. Reject Quote (Customer)
export const rejectQuote = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const quoteIdStr = Array.isArray(req.params.quoteId) ? req.params.quoteId[0] : req.params.quoteId;

    const filter: any = {
      $or: [{ _id: mongoose.Types.ObjectId.isValid(quoteIdStr) ? quoteIdStr : null }, { quoteNumber: quoteIdStr }],
      userId: req.user.id,
    };

    const quote = await BulkQuote.findOne(filter);

    if (!quote) {
      return next(new AppError("Bulk quotation not found", 404));
    }

    quote.status = BulkQuoteStatus.REJECTED;
    await quote.save();

    await BulkOrderRequest.findByIdAndUpdate(quote.bulkRequestId, { status: BulkRequestStatus.REJECTED });

    res.status(200).json({
      success: true,
      message: "Quotation rejected.",
      data: quote,
    });
  } catch (error) {
    next(error);
  }
};
