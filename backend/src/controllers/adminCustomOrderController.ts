import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Order } from "../models/Order";
import { PrintJob, PrintJobStatus, PrintJobPriority } from "../models/PrintJob";
import { Product } from "../models/Product";
import { CustomDesign } from "../models/CustomDesign";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";
import { notificationService } from "../services/notifications/notificationService";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// 1. Get Paginated Admin Custom Orders
export const getCustomOrders = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const q = req.query.q as string;
    const productionStatus = req.query.productionStatus as string;
    const priority = req.query.priority as string;

    // Filter for orders containing at least one custom item (V1 legacy OR V2)
    const filter: any = {
      $or: [
        { "items.customDesignId": { $exists: true, $ne: null } },
        { "items.isCustomized": true },
        { "items.customConfigurations.0": { $exists: true } },
      ],
    };

    if (q) {
      filter.$or = [
        { orderNumber: { $regex: q, $options: "i" } },
        { "shippingAddress.fullName": { $regex: q, $options: "i" } },
        { "items.productName": { $regex: q, $options: "i" } },
      ];
    }

    await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name email");

    // Resolve or Auto-create PrintJobs for each order's custom items
    const customOrdersData = await Promise.all(
      orders.map(async (order) => {
        const customItems = order.items.filter(
        (item: any) =>
          item.customDesignId || item.isCustomized || (item.customConfigurations && item.customConfigurations.length > 0)
      );
      
        const itemsWithPrintJobs = await Promise.all(
          customItems.map(async (item: any) => {
            let printJob = await PrintJob.findOne({ orderId: order._id, orderItemId: item._id?.toString() || item.customDesignId });
            if (!printJob) {
              const targetDesignId = item.customDesignId || item.customConfigurations?.[0]?.designId;
              printJob = await PrintJob.create({
                orderId: order._id,
                orderItemId: item._id?.toString() || (targetDesignId ? targetDesignId.toString() : new mongoose.Types.ObjectId().toString()),
                customDesignId: targetDesignId || undefined,
                status: PrintJobStatus.PENDING_REVIEW,
                priority: PrintJobPriority.MEDIUM,
                printLocations: item.customizationSnapshot?.printLocations || ["FRONT"],
              });
            }
            return {
              item,
              printJob,
            };
          })
        );

        return {
          _id: order._id,
          orderNumber: order.orderNumber,
          user: order.userId,
          shippingAddress: order.shippingAddress,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          createdAt: order.createdAt,
          customItems: itemsWithPrintJobs,
        };
      })
    );

    const requestFilter: any = { requestType: "PRINTING_REQUEST" };
    if (q) {
      requestFilter.$or = [
        { name: { $regex: q, $options: "i" } },
        { instructions: { $regex: q, $options: "i" } },
      ];
    }
    const requests = await CustomDesign.find(requestFilter)
      .sort({ createdAt: -1 })
      .populate("userId", "name email phone")
      .populate("productId", "name slug basePrice images");

    const requestData = requests.map((request: any) => ({
      _id: request._id,
      orderNumber: `REQUEST-${request._id.toString().slice(-8).toUpperCase()}`,
      user: request.userId,
      status: "REQUESTED",
      paymentStatus: "NOT_APPLICABLE",
      total: null,
      createdAt: request.createdAt,
      isPrintingRequest: true,
      customItems: [{
        item: {
          productId: request.productId?._id,
          productName: request.productId?.name,
          selectedColor: request.selectedColor,
          selectedSize: request.selectedSize,
          quantity: 1,
          unitPrice: null,
          instructions: request.instructions,
          artwork: request.artwork,
          requestType: request.artworkType,
          customizationSnapshot: {
            name: request.name,
            previewImage: request.artwork?.url || request.productId?.images?.[0],
            printLocations: request.printLocations,
            designAssistance: request.designAssistance,
          },
        },
        printJob: null,
      }],
    }));

    const combinedData = [...customOrdersData, ...requestData].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Apply optional production status or priority filter
    let filteredData = combinedData;
    if (productionStatus && productionStatus !== "All") {
      filteredData = filteredData.filter((o) =>
        o.customItems.some((ci) => ci.printJob?.status === productionStatus)
      );
    }
    if (priority && priority !== "All") {
      filteredData = filteredData.filter((o) =>
        o.customItems.some((ci) => ci.printJob?.priority === priority)
      );
    }

    res.status(200).json({
      success: true,
      data: filteredData,
      pagination: {
        page,
        limit,
        total: filteredData.length,
        pages: Math.ceil(filteredData.length / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};


// 2. Get Single Custom Order Detail for Admin Inspection
export const getCustomOrderById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid Order ID format", 400));
    }
    const request = await CustomDesign.findOne({ _id: id, requestType: "PRINTING_REQUEST" })
      .populate("userId", "name email phone")
      .populate("productId", "name slug basePrice images");
    if (request) {
      const requestData = request as unknown as {
        _id: mongoose.Types.ObjectId;
        name: string;
        userId: unknown;
        productId?: { _id: mongoose.Types.ObjectId; name: string; slug: string; basePrice: number; images?: string[] };
        selectedColor: string;
        selectedSize: string;
        printLocations: string[];
        designAssistance?: any;
        instructions?: string;
        artwork?: { url: string; publicId?: string; format?: string };
        artworkType?: string;
        createdAt: Date;
      };
      return res.status(200).json({
        success: true,
        data: {
          _id: requestData._id,
          orderNumber: `REQUEST-${requestData._id.toString().slice(-8).toUpperCase()}`,
          user: requestData.userId,
          status: "REQUESTED",
          paymentStatus: "NOT_APPLICABLE",
          total: null,
          createdAt: requestData.createdAt,
          isPrintingRequest: true,
          customItems: [{
            item: {
              productId: requestData.productId?._id,
              productName: requestData.productId?.name,
              selectedColor: requestData.selectedColor,
              selectedSize: requestData.selectedSize,
              quantity: 1,
              unitPrice: null,
              instructions: requestData.instructions,
              artwork: requestData.artwork,
              requestType: requestData.artworkType,
              customizationSnapshot: {
                name: requestData.name,
                previewImage: requestData.artwork?.url || requestData.productId?.images?.[0],
                printLocations: requestData.printLocations,
                designAssistance: requestData.designAssistance,
              },
            },
            printJob: null,
            product: requestData.productId ? {
              _id: requestData.productId._id,
              name: requestData.productId.name,
              slug: requestData.productId.slug,
              sku: "REQUEST",
              color: requestData.selectedColor,
              size: requestData.selectedSize,
              basePrice: requestData.productId.basePrice,
            } : null,
          }],
        },
      });
    }

    // Retail custom orders are backed by paid Order records and can enter production.

    const order = await Order.findById(id).populate("userId", "name email phone");
    if (!order) {
      return next(new AppError("Order not found", 404));
    }

    const customItems = order.items.filter(
      (item: any) =>
        item.customDesignId || item.isCustomized || (item.customConfigurations && item.customConfigurations.length > 0)
    );
    if (customItems.length === 0) {
      return next(new AppError("This order does not contain custom designs", 400));
    }

    // Populate PrintJobs & Product Variants
    const customItemsDetails = await Promise.all(
      customItems.map(async (item: any) => {
        let printJob = await PrintJob.findOne({ orderId: order._id, orderItemId: item._id?.toString() || item.customDesignId }).populate("notes.createdBy", "name email");
        if (!printJob) {
          const targetDesignId = item.customDesignId || item.customConfigurations?.[0]?.designId;
          printJob = await PrintJob.create({
            orderId: order._id,
            orderItemId: item._id?.toString() || (targetDesignId ? targetDesignId.toString() : new mongoose.Types.ObjectId().toString()),
            customDesignId: targetDesignId || undefined,
            status: PrintJobStatus.PENDING_REVIEW,
            priority: PrintJobPriority.MEDIUM,
            printLocations: item.customizationSnapshot?.printLocations || ["FRONT"],
          });
        }

        const product = await Product.findById(item.productId);
        const variant = product?.variants.find((v: any) => v._id?.toString() === item.variantId?.toString());

        return {
          item,
          printJob,
          product: product
            ? {
                _id: product._id,
                name: product.name,
                slug: product.slug,
                sku: variant?.sku || "CUSTOM-SKU",
                color: item.selectedColor,
                size: item.selectedSize,
                basePrice: product.basePrice,
              }
            : null,
        };
      })
    );

    // Log View Action
    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_CUSTOM_ORDER_VIEWED",
        entityType: "ORDER",
        entityId: order._id.toString(),
      });
    }

    res.status(200).json({
      success: true,
      data: {
        _id: order._id,
        orderNumber: order.orderNumber,
        user: order.userId,
        shippingAddress: order.shippingAddress,
        status: order.status,
        paymentStatus: order.paymentStatus,
        subtotal: order.subtotal,
        discount: order.discount,
        shipping: order.shipping,
        total: order.total,
        createdAt: order.createdAt,
        customItems: customItemsDetails,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 3. Update PrintJob Production Status State Machine
export const updatePrintJobStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { printJobId } = req.params;
    const { status, priority } = req.body;

    if (!mongoose.Types.ObjectId.isValid(printJobId as string)) {
      return next(new AppError("Invalid PrintJob ID", 400));
    }

    const printJob = await PrintJob.findById(printJobId);
    if (!printJob) {
      return next(new AppError("PrintJob not found", 404));
    }

    // State machine validation
    const validTransitions: Record<string, string[]> = {
      PENDING_REVIEW: ["READY_FOR_PRINT", "REJECTED"],
      READY_FOR_PRINT: ["PRINTING", "REJECTED"],
      PRINTING: ["QUALITY_CHECK", "PRINTED"],
      QUALITY_CHECK: ["PRINTED", "REJECTED"],
      PRINTED: ["COMPLETED"],
      COMPLETED: [],
      REJECTED: ["PENDING_REVIEW"],
    };

    if (status && status !== printJob.status) {
      const allowed = validTransitions[printJob.status] || [];
      if (!allowed.includes(status)) {
        return next(new AppError(`Invalid status transition from ${printJob.status} to ${status}`, 400));
      }

      // PROD DISPATCH GUARD: If moving to READY_FOR_PRINT, PRINTING, or PRINTED, check customer mockup approvalStatus
      if (["READY_FOR_PRINT", "PRINTING", "PRINTED"].includes(status)) {
        const order = await Order.findById(printJob.orderId);
        if (!order) {
          return next(new AppError('Associated order not found for this print job', 404));
        }

        let targetItem = order.items.find(
          (i: any) => i._id?.toString() === printJob.orderItemId?.toString()
        );
        if (!targetItem && printJob.customDesignId) {
          targetItem = order.items.find(
            (i: any) => i.customDesignId?.toString() === printJob.customDesignId?.toString()
          );
        }
        if (!targetItem && order.items.length === 1 && (order.items[0].isCustomized || order.items[0].customDesignId)) {
          targetItem = order.items[0];
        }

        if (!targetItem) {
          return next(new AppError('Target custom item not found in order for this print job', 404));
        }

        const isApprovedOrLegacy = targetItem.approvalStatus === 'approved' || targetItem.approvalStatus === 'in_production' || targetItem.approvalStatus === undefined;
        if (!isApprovedOrLegacy) {
          return next(new AppError(`Order mockup must be approved by customer before sending to production (current status: ${targetItem.approvalStatus || 'pending_design'})`, 400));
        }
      }

      printJob.status = status as PrintJobStatus;
    }

    if (priority) {
      printJob.priority = priority as PrintJobPriority;
    }

    if (req.user) {
      printJob.updatedBy = new mongoose.Types.ObjectId(req.user.id);
    }

    await printJob.save();

    // Log Status Change
    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_PRINT_STATUS_UPDATED",
        entityType: "PRINT_JOB",
        entityId: printJob._id.toString(),
        metadata: { newStatus: status, newPriority: priority },
      });
    }

    res.status(200).json({
      success: true,
      message: "Print job production status updated",
      data: printJob,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Add Production Note
export const addProductionNote = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { printJobId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return next(new AppError("Note text is required", 400));
    }

    const printJob = await PrintJob.findById(printJobId);
    if (!printJob) {
      return next(new AppError("PrintJob not found", 404));
    }

    if (!req.user) return next(new AppError("Unauthorized", 401));

    printJob.notes.push({
      text: text.trim(),
      createdBy: new mongoose.Types.ObjectId(req.user.id),
      createdAt: new Date(),
    });

    await printJob.save();

    res.status(200).json({
      success: true,
      message: "Production note added",
      data: printJob,
    });
  } catch (error) {
    next(error);
  }
};

// 5. High-Res Artwork Export Generator (3000x4000px @ 300 DPI equivalent)
export const generatePrintSheetExport = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const side = (req.query.side as string) || "FRONT";

    const order = await Order.findById(orderId);
    if (!order) {
      return next(new AppError("Order not found", 404));
    }

    const customItem = order.items.find((item: any) => item.customDesignId);
    if (!customItem || !customItem.customizationSnapshot) {
      return next(new AppError("Custom item snapshot unavailable for order", 400));
    }

    const snapshot = customItem.customizationSnapshot;
    const exportWidth = 3000;
    const exportHeight = 4000;

    // Construct SVG High-Res Printable Artwork Export Document
    const svgExport = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${exportWidth}" height="${exportHeight}" viewBox="0 0 ${exportWidth} ${exportHeight}">
  <style>
    .print-title { font-family: 'Hanken Grotesk', sans-serif; font-size: 72px; font-weight: 800; fill: #191c1d; }
    .print-meta { font-family: 'JetBrains Mono', monospace; font-size: 36px; fill: #434655; }
    .print-box { fill: none; stroke: #004ac6; stroke-width: 8; stroke-dasharray: 20 20; }
  </style>

  <!-- Industrial Print Metadata Header -->
  <rect width="${exportWidth}" height="320" fill="#f3f4f5"/>
  <text x="80" y="120" class="print-title">ORDER EXPORT: ${order.orderNumber}</text>
  <text x="80" y="200" class="print-meta">GARMENT: ${customItem.productName} | COLOR: ${customItem.selectedColor} | SIZE: ${customItem.selectedSize} | QUANTITY: ${customItem.quantity}</text>
  <text x="80" y="270" class="print-meta">PRINT LOCATION: ${side} VIEW | METHOD: DTG | TARGET RESOLUTION: 300 DPI (3000x4000px)</text>
  
  <!-- Printable Target Area Boundary (12x16 inches equivalent) -->
  <rect x="300" y="500" width="2400" height="3200" class="print-box"/>

  <!-- Render Customer Design Preview Layer -->
  ${
    snapshot.previewImage
      ? `<image href="${snapshot.previewImage}" x="300" y="500" width="2400" height="3200" preserveAspectRatio="xMidYMid meet"/>`
      : `<text x="1500" y="2100" text-anchor="middle" font-size="64" fill="#888">HD Customer Artwork Placeholder</text>`
  }
</svg>`;

    // Log Export Generation
    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_PRINT_EXPORT_GENERATED",
        entityType: "ORDER",
        entityId: order._id.toString(),
        metadata: { side, exportWidth, exportHeight },
      });
    }

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Content-Disposition", `attachment; filename="${order.orderNumber}_${side}_PRINT_SHEET.svg"`);
    res.status(200).send(svgExport);
  } catch (error) {
    next(error);
  }
};

export const uploadStaffMockup = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, itemId } = req.params;
    const orderId = Array.isArray(id) ? id[0] : id;
    const rawItemId = Array.isArray(itemId) ? itemId[0] : itemId;
    if (!orderId || !rawItemId || !mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(rawItemId)) {
      return next(new AppError("Invalid order or item ID", 400));
    }

    const rawImages: unknown[] = Array.isArray(req.body.mockupImages) ? req.body.mockupImages : [];
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    const formattedMockups = rawImages
      .map((value) => {
        if (typeof value === "string") return value;
        if (value && typeof value === "object" && "url" in value && typeof value.url === "string") {
          return value.url;
        }
        return null;
      })
      .filter((url): url is string => Boolean(url))
      .map((url) => ({
        url,
        uploadedAt: new Date(),
        uploadedBy: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
      }));

    if (formattedMockups.length === 0) {
      return next(new AppError("At least one mockup image URL is required", 400));
    }

    const order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        items: {
          $elemMatch: {
            _id: rawItemId,
            approvalStatus: { $in: ["pending_design", "revision_requested"] },
          },
        },
      },
      {
        $push: {
          "items.$.mockupImages": { $each: formattedMockups },
          "items.$.approvalHistory": {
            status: "mockup_sent",
            note: note || "Mockup uploaded by staff",
            actor: "staff",
            timestamp: new Date(),
          },
        },
        $set: { "items.$.approvalStatus": "mockup_sent" },
      },
      { returnDocument: 'after' }
    );

    if (!order) {
      const current = await Order.findById(orderId);
      if (!current) return next(new AppError("Order not found", 404));
      const item = current.items.find((candidate) => candidate._id?.toString() === rawItemId);
      if (!item) return next(new AppError("Order item not found", 404));
      return next(new AppError(`Mockup upload is not allowed from ${item.approvalStatus || "pending_design"}`, 409));
    }

    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_MOCKUP_UPLOADED",
        entityType: "ORDER_ITEM",
        entityId: new mongoose.Types.ObjectId(rawItemId),
        metadata: { orderId, mockupCount: formattedMockups.length, note },
      });
    }

    const customerUser = await mongoose.model("User").findById(order.userId);
    notificationService.notify({
      eventType: "MOCKUP_SENT",
      entityType: "ORDER",
      entityId: order._id,
      recipientEmail: customerUser?.email || "customer@example.com",
      data: {
        orderNumber: order.orderNumber,
        customerName: customerUser?.name || "Customer",
      },
    });

    res.status(200).json({
      success: true,
      message: "Mockup uploaded and sent to customer for approval",
      data: order,
    });
  } catch (error) {
    next(error);
  }
};
