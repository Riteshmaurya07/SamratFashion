import { Request, Response, NextFunction } from "express";
import mongoose, { QueryFilter } from "mongoose";
import { z } from "zod";
import {
  BulkOrderRequest,
  BulkRequestStatus,
  IBulkOrderRequest,
  IVariantAllocation,
} from "../models/BulkOrderRequest";
import { BulkQuote, BulkQuoteStatus, IBulkQuote } from "../models/BulkQuote";
import { Product, ProductStatus } from "../models/Product";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { CustomDesign } from "../models/CustomDesign";
import { Order } from "../models/Order";
import { User } from "../models/User";
import { AppError } from "../utils/AppError";
import { validateQuantityMOQ } from "../services/volumePricingService";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

const artworkFileSchema = z.object({
  url: z.string().url(),
  publicId: z.string().optional(),
  originalFilename: z.string().optional(),
  fileType: z.string().optional(),
  sizeBytes: z.number().optional(),
});

const variantAllocationSchema = z.object({
  variantId: z.string().optional(),
  size: z.string().min(1),
  color: z.string().optional(),
  quantity: z.number().int().min(1),
  sku: z.string().optional(),
});

const bulkRequestSchema = z.object({
  organizationName: z.string().max(120).optional().default("Individual"),
  contactName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(8),
  productId: z.string().min(1),
  catalogItemId: z.string().optional(),
  variantBreakdown: z.record(z.string(), z.number().int().min(0)).optional(),
  variantAllocations: z.array(variantAllocationSchema).optional(),
  colorAllocation: z.string().optional(),
  customPrintingRequired: z.boolean().optional(),
  customDesignId: z.string().optional(),
  printLocations: z.array(z.string()).optional(),
  printMethod: z.string().optional(),
  artworkFiles: z.array(artworkFileSchema).optional(),
  needsDesignAssistance: z.boolean().optional(),
  printText: z.string().max(500).optional(),
  preferredColors: z.array(z.string()).optional(),
  designPreferences: z.string().max(1000).optional(),
  deliveryLocation: z.string().optional().default("To be confirmed"),
  city: z.string().min(2).optional(),
  state: z.string().min(2).optional(),
  postalCode: z.string().min(3).optional(),
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
      catalogItemId,
      variantBreakdown,
      variantAllocations,
      colorAllocation,
      customPrintingRequired,
      customDesignId,
      printLocations,
      printMethod,
      artworkFiles,
      needsDesignAssistance,
      printText,
      preferredColors,
      designPreferences,
      deliveryLocation,
      city,
      state,
      postalCode,
      requiredByDate,
      customerNote,
    } = parseResult.data;

    // Verify Active Product
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return next(new AppError("Invalid Product ID", 400));
    }
    const product = await Product.findOne({ _id: productId, status: ProductStatus.ACTIVE });
    if (!product) {
      return next(new AppError("Selected product is unavailable for bulk order", 400));
    }

    // Verify Catalog Item if specified, or auto-associate if active catalog item exists for product
    let verifiedCatalogId: mongoose.Types.ObjectId | undefined = undefined;
    if (catalogItemId) {
      if (!mongoose.Types.ObjectId.isValid(catalogItemId)) {
        return next(new AppError("Invalid Catalog Item ID", 400));
      }
      const catItem = await CustomPrintCatalogItem.findById(catalogItemId);
      if (catItem) {
        verifiedCatalogId = catItem._id as mongoose.Types.ObjectId;
      }
    } else {
      const activeCatItem = await CustomPrintCatalogItem.findOne({ productId: product._id, isActive: true });
      if (activeCatItem) {
        verifiedCatalogId = activeCatItem._id as mongoose.Types.ObjectId;
      }
    }
    // Calculate total quantity
    let totalQuantity = 0;
    const finalAllocations: IVariantAllocation[] = [];
    const finalBreakdown: Record<string, number> = {};

    if (Array.isArray(variantAllocations) && variantAllocations.length > 0) {
      for (const alloc of variantAllocations) {
        if (alloc.variantId) {
          if (!mongoose.Types.ObjectId.isValid(alloc.variantId)) {
            return next(new AppError(`Invalid variant ID: ${alloc.variantId}`, 400));
          }
          const validVariant = product.variants.some((v) => v._id?.toString() === alloc.variantId);
          if (!validVariant) {
            return next(new AppError(`Variant ID ${alloc.variantId} does not belong to product ${product.name}`, 400));
          }
        }
        totalQuantity += alloc.quantity;
        finalAllocations.push({
          variantId: alloc.variantId ? new mongoose.Types.ObjectId(alloc.variantId) : undefined,
          size: alloc.size,
          color: alloc.color,
          quantity: alloc.quantity,
          sku: alloc.sku,
        });
        finalBreakdown[alloc.size] = (finalBreakdown[alloc.size] || 0) + alloc.quantity;
      }
    } else if (variantBreakdown && Object.keys(variantBreakdown).length > 0) {
      for (const [size, qty] of Object.entries(variantBreakdown)) {
        const q = Number(qty) || 0;
        if (q > 0) {
          totalQuantity += q;
          finalBreakdown[size] = q;
          finalAllocations.push({
            size,
            quantity: q,
          });
        }
      }
    }

    // Authoritative MOQ Check
    const moqCheck = await validateQuantityMOQ(totalQuantity, product._id, verifiedCatalogId);
    if (!moqCheck.valid) {
      return next(new AppError(moqCheck.message || `Minimum order quantity requirement not met.`, 400));
    }

    // Resolve User ID if authenticated or matching registered account exists
    let resolvedUserId: mongoose.Types.ObjectId | undefined = undefined;
    if (req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id)) {
      resolvedUserId = new mongoose.Types.ObjectId(req.user.id);
    } else {
      const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
      if (existingUser) {
        resolvedUserId = existingUser._id as mongoose.Types.ObjectId;
      }
    }

    // Verify Custom Design Ownership if provided
    let verifiedDesignId: mongoose.Types.ObjectId | undefined = undefined;
    if (customDesignId) {
      if (!mongoose.Types.ObjectId.isValid(customDesignId)) {
        return next(new AppError("Invalid Custom Design ID", 400));
      }
      const designQuery: Record<string, unknown> = { _id: customDesignId };
      if (resolvedUserId) {
        designQuery.userId = resolvedUserId;
      }
      const design = await CustomDesign.findOne(designQuery);
      if (!design) {
        return next(new AppError("Attached custom design not found or not owned by your account", 400));
      }
      verifiedDesignId = design._id as mongoose.Types.ObjectId;
    }


    const quoteNumber = await generateQuoteNumber();

    const bulkRequest = await BulkOrderRequest.create({
      quoteNumber,
      userId: resolvedUserId,
      organizationName: (organizationName || contactName || "Individual").trim(),
      contactName: contactName.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      productId: product._id,
      catalogItemId: verifiedCatalogId,
      variantBreakdown: finalBreakdown,
      variantAllocations: finalAllocations,
      totalQuantity,
      colorAllocation: colorAllocation?.trim(),
      customPrintingRequired: customPrintingRequired || false,
      customDesignId: verifiedDesignId,
      printLocations: printLocations && printLocations.length > 0 ? printLocations : undefined,
      printMethod: printMethod || "DTF Transfer",
      artworkFiles: artworkFiles || [],
      needsDesignAssistance: Boolean(needsDesignAssistance),
      printText: printText?.trim(),
      preferredColors: preferredColors || [],
      designPreferences: designPreferences?.trim(),
      deliveryLocation: (deliveryLocation || "To be confirmed").trim(),
      city: city?.trim(),
      state: state?.trim(),
      postalCode: postalCode?.trim(),
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
      .populate("productId", "name images basePrice")
      .populate("catalogItemId", "name slug mockupImageUrl");

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

// 3. Get Single Bulk Request Scoped to Customer
export const getMyBulkRequestById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid Request ID", 400));
    }

    const request = await BulkOrderRequest.findOne({ _id: id, userId: req.user.id })
      .populate("productId")
      .populate("catalogItemId")

    if (!request) return next(new AppError("Bulk order request not found", 404));

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

// 4. Approve Mockup (Customer)
export const approveMockup = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));
    const requestId = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return next(new AppError("Invalid Request ID", 400));
    }

    const request = await BulkOrderRequest.findOne({ _id: requestId, userId: req.user.id });
    if (!request) {
      return next(new AppError("Bulk order request not found", 404));
    }

    if (request.status !== BulkRequestStatus.MOCKUP_SHARED && request.status !== BulkRequestStatus.REVISION_REQUESTED) {
      return next(new AppError(`Cannot approve mockup in '${request.status}' state. Must be MOCKUP_SHARED.`, 400));
    }

    const latestVersion = request.mockupHistory?.length || 1;
    const decision = {
      decision: "APPROVED" as const,
      decidedAt: new Date(),
      decidedBy: new mongoose.Types.ObjectId(req.user.id),
      mockupVersion: latestVersion,
    };

    request.status = BulkRequestStatus.DESIGN_APPROVED;
    request.approvalDecision = decision;
    request.approvalHistory = request.approvalHistory || [];
    request.approvalHistory.push(decision);
    await request.save();

    res.status(200).json({
      success: true,
      message: "Design mockup approved! We will proceed to issue your formal quotation.",
      data: request,
    });
  } catch (error) {
    next(error);
  }
};

// 5. Request Mockup Revision (Customer)
export const requestMockupRevision = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));
    const requestId = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return next(new AppError("Invalid Request ID", 400));
    }

    const { comment } = req.body;
    if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
      return next(new AppError("Revision feedback comment is required", 400));
    }

    const request = await BulkOrderRequest.findOne({ _id: requestId, userId: req.user.id });
    if (!request) {
      return next(new AppError("Bulk order request not found", 404));
    }

    if (request.status !== BulkRequestStatus.MOCKUP_SHARED && request.status !== BulkRequestStatus.DESIGN_APPROVED) {
      return next(new AppError("Cannot request revisions in the current state", 400));
    }

    const latestVersion = request.mockupHistory?.length || 1;
    const decision = {
      decision: "REVISION_REQUESTED" as const,
      comment: comment.trim(),
      decidedAt: new Date(),
      decidedBy: new mongoose.Types.ObjectId(req.user.id),
      mockupVersion: latestVersion,
    };

    request.status = BulkRequestStatus.REVISION_REQUESTED;
    request.approvalDecision = decision;
    request.approvalHistory = request.approvalHistory || [];
    request.approvalHistory.push(decision);
    await request.save();

    res.status(200).json({
      success: true,
      message: "Revision requested successfully. Our design team will review your comments.",
      data: request,
    });
  } catch (error) {
    next(error);
  }
};

// 6. Get Single Quotation Detail Scoped to Customer
export const getQuoteById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const quoteIdStr = Array.isArray(req.params.quoteId) ? req.params.quoteId[0] : req.params.quoteId;

    const filter: QueryFilter<IBulkQuote> = {
      $or: [{ _id: mongoose.Types.ObjectId.isValid(quoteIdStr) ? quoteIdStr : undefined }, { quoteNumber: quoteIdStr }],
      userId: req.user.id,
    };

    const quote = await BulkQuote.findOne(filter)
      .populate({
        path: "bulkRequestId",
        populate: [
          { path: "productId", select: "name images basePrice description variants" },
          { path: "catalogItemId" },
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

// 7. Accept Quote & Convert to Order (Customer)
export const acceptQuote = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const quoteIdStr = Array.isArray(req.params.quoteId) ? req.params.quoteId[0] : req.params.quoteId;

    const filter: QueryFilter<IBulkQuote> = {
      $or: [{ _id: mongoose.Types.ObjectId.isValid(quoteIdStr) ? quoteIdStr : undefined }, { quoteNumber: quoteIdStr }],
      userId: req.user.id,
    };

    const quote = await BulkQuote.findOne(filter).populate("bulkRequestId");

    if (!quote) {
      return next(new AppError("Bulk quotation not found", 404));
    }

    // Idempotency: Prevent duplicate order creation if already accepted
    if (quote.status === BulkQuoteStatus.ACCEPTED || quote.convertedOrderId) {
      const existingOrder = await Order.findById(quote.convertedOrderId);
      return res.status(200).json({
        success: true,
        message: "This quotation has already been accepted and converted to an order.",
        data: {
          quote,
          order: existingOrder,
        },
      });
    }

    // Only SENT quotes can be accepted
    if (quote.status !== BulkQuoteStatus.SENT) {
      return next(
        new AppError(
          quote.status === BulkQuoteStatus.REJECTED
            ? "This quotation was rejected and can no longer be accepted"
            : "This quotation is not available to accept",
          400
        )
      );
    }

    if (new Date(quote.validUntil) < new Date()) {
      quote.status = BulkQuoteStatus.EXPIRED;
      await quote.save();
      return next(new AppError("This quotation has expired and can no longer be accepted", 400));
    }

    // Atomic claim: Transition quote status from SENT to ACCEPTED atomically.
    // Only ONE concurrent request can successfully claim this quote.
    const claimedQuote = await BulkQuote.findOneAndUpdate(
      { _id: quote._id, status: BulkQuoteStatus.SENT, convertedOrderId: { $exists: false } },
      { $set: { status: BulkQuoteStatus.ACCEPTED } },
      { returnDocument: 'after' }
    );

    if (!claimedQuote) {
      const currentQuote = await BulkQuote.findById(quote._id);
      if (currentQuote && currentQuote.convertedOrderId) {
        const existingOrder = await Order.findById(currentQuote.convertedOrderId);
        return res.status(200).json({
          success: true,
          message: "This quotation has already been accepted and converted to an order.",
          data: { quote: currentQuote, order: existingOrder },
        });
      }
      return next(new AppError("Quotation is currently being processed by another request", 409));
    }

    const bulkReq = quote.bulkRequestId as unknown as IBulkOrderRequest;
    const product = await Product.findById(bulkReq.productId);
    if (!product) {
      return next(new AppError("Quoted product is no longer available", 400));
    }

    // Financial conversion: BulkQuote stores in paise; Order stores in Rupees.
    const subtotalRupees = Math.round(quote.subtotal / 100);
    const discountRupees = Math.round(quote.discount / 100);
    const shippingRupees = Math.round(quote.shipping / 100);
    const taxRupees = Math.round(quote.tax / 100);
    const totalRupees = Math.round(quote.total / 100);
    const totalQty = Math.max(1, bulkReq.totalQuantity || 1);

    // Build specific order items from actual variant allocations
    const items: Array<{
      productId: mongoose.Types.ObjectId;
      variantId: mongoose.Types.ObjectId;
      productName: string;
      productImage: string;
      selectedSize: string;
      selectedColor: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      isCustomized?: boolean;
      customizationNotes?: string;
      mockupImages?: Array<{ url: string }>;
      printLocations?: string[];
    }> = [];

    const effectiveUnitPrice = Math.max(1, Math.round(subtotalRupees / totalQty));
    let accumulatedLineTotal = 0;

    const allocations: IVariantAllocation[] = bulkReq.variantAllocations && bulkReq.variantAllocations.length > 0
      ? bulkReq.variantAllocations
      : Object.entries(bulkReq.variantBreakdown || {})
          .filter(([_, q]) => (Number(q) || 0) > 0)
          .map(([size, q]) => ({ size, quantity: Number(q) || 0 }));
    if (allocations.length > 0) {
      for (const [index, alloc] of allocations.entries()) {
        const isLast = index === allocations.length - 1;
        // Resolve matching product variant with strict matching (no silent fallback to wrong variants)
        let matchedVariant = undefined;
        if (alloc.variantId) {
          matchedVariant = product.variants.find((v) => v._id?.toString() === alloc.variantId?.toString());
        } else if (alloc.sku) {
          matchedVariant = product.variants.find((v) => v.sku === alloc.sku);
        } else if (alloc.size && alloc.color) {
          const allocColor = alloc.color.toLowerCase();
          matchedVariant = product.variants.find((v) =>
            (v.size || "").toLowerCase() === alloc.size.toLowerCase() &&
            (v.color || "").toLowerCase() === allocColor
          );
        } else if (alloc.size) {
          const sizeMatches = product.variants.filter((v) => (v.size || "").toLowerCase() === alloc.size.toLowerCase());
          if (sizeMatches.length === 1) {
            matchedVariant = sizeMatches[0];
          } else if (sizeMatches.length > 1) {
            if (bulkReq.colorAllocation) {
              const normalizedReqColor = bulkReq.colorAllocation.toLowerCase().replace(/\s*\(\d+\)\s*$/, '').trim();
              matchedVariant = sizeMatches.find((v) => {
                const vColor = (v.color || "").toLowerCase().trim();
                return vColor === normalizedReqColor || normalizedReqColor.includes(vColor) || vColor.includes(normalizedReqColor);
              });
            }
            if (!matchedVariant) {
              const availableSizeMatches = sizeMatches.filter((v) => v.isAvailable !== false);
              if (availableSizeMatches.length === 1) {
                matchedVariant = availableSizeMatches[0];
              }
            }
          }
        }

        if (!matchedVariant || !matchedVariant._id) {
          // Rollback atomic claim on failure so quote remains valid
          await BulkQuote.updateOne({ _id: quote._id, convertedOrderId: { $exists: false } }, { $set: { status: BulkQuoteStatus.SENT } });
          throw new AppError(`Ambiguous or missing variant match for allocation (Size: ${alloc.size}${alloc.color ? `, Color: ${alloc.color}` : ""})`, 400);
        }
        const lineTotal = isLast
          ? Math.max(1, subtotalRupees - accumulatedLineTotal)
          : effectiveUnitPrice * alloc.quantity;
        accumulatedLineTotal += lineTotal;

        const colorName = alloc.color || bulkReq.colorAllocation || matchedVariant?.color || "Standard";

        items.push({
          productId: product._id as mongoose.Types.ObjectId,
          variantId: (matchedVariant?._id || new mongoose.Types.ObjectId()) as mongoose.Types.ObjectId,
          productName: `Bulk: ${product.name} (${alloc.size}${colorName ? ` / ${colorName}` : ""})`,
          productImage: matchedVariant?.images?.[0] || product.images[0] || "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500",
          selectedSize: alloc.size,
          selectedColor: colorName,
          quantity: alloc.quantity,
          unitPrice: effectiveUnitPrice,
          lineTotal,
          isCustomized: true,
          customizationNotes: bulkReq.customerNote,
          mockupImages: bulkReq.currentMockupUrl ? [{ url: bulkReq.currentMockupUrl }] : [],
          printLocations: bulkReq.printLocations && bulkReq.printLocations.length > 0 ? bulkReq.printLocations : undefined,
        });
      }
    } else {
      // Fallback single item
      const variant = product.variants[0];
      items.push({
        productId: product._id as mongoose.Types.ObjectId,
        variantId: (variant?._id || new mongoose.Types.ObjectId()) as mongoose.Types.ObjectId,
        productName: `Bulk: ${product.name} (${totalQty} units)`,
        productImage: product.images[0] || "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500",
        selectedSize: "VARIOUS",
        selectedColor: bulkReq.colorAllocation || "Standard",
        quantity: totalQty,
        unitPrice: effectiveUnitPrice,
        lineTotal: subtotalRupees,
        isCustomized: true,
        customizationNotes: bulkReq.customerNote,
        mockupImages: bulkReq.currentMockupUrl ? [{ url: bulkReq.currentMockupUrl }] : [],
        printLocations: bulkReq.printLocations && bulkReq.printLocations.length > 0 ? bulkReq.printLocations : undefined,
      });
    }

    const orderNumber = `SF-ORD-BULK-${Date.now()}`;
    const order = await Order.create({
      orderNumber,
      userId: req.user.id,
      items,
      shippingAddress: {
        fullName: bulkReq.contactName,
        phone: bulkReq.phone,
        addressLine1: bulkReq.deliveryLocation,
        city: bulkReq.city || "City",
        state: bulkReq.state || "State",
        postalCode: bulkReq.postalCode || "110001",
        country: "India",
        addressType: "WORK",
      },
      subtotal: subtotalRupees,
      discount: discountRupees,
      shipping: shippingRupees,
      tax: taxRupees,
      total: totalRupees,
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

// 8. Reject Quote (Customer)
export const rejectQuote = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const quoteIdStr = Array.isArray(req.params.quoteId) ? req.params.quoteId[0] : req.params.quoteId;

    const filter: QueryFilter<IBulkQuote> = {
      $or: [{ _id: mongoose.Types.ObjectId.isValid(quoteIdStr) ? quoteIdStr : undefined }, { quoteNumber: quoteIdStr }],
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
