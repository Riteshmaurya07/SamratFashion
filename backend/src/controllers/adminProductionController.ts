import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import JSZip from "jszip";
import { PrintJob, PrintJobStatus, PrintJobPriority } from "../models/PrintJob";
import { Product } from "../models/Product";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// 1. Get Production Queue with Allowlisted Sorting and Server-Side Filtering
export const getProductionQueue = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 15, 50); // cap limit
    const skip = (page - 1) * limit;

    const status = req.query.status as string;
    const priority = req.query.priority as string;
    const q = req.query.q as string;
    const sortBy = req.query.sortBy as string;

    const filter: any = {};
    if (status && status !== "All") filter.status = status;
    if (priority && priority !== "All") filter.priority = priority;

    // Allowlisted Sorting
    let sortOptions: any = { createdAt: -1 };
    if (sortBy === "oldest") sortOptions = { createdAt: 1 };
    else if (sortBy === "priority") sortOptions = { priority: -1, createdAt: -1 };
    else if (sortBy === "status") sortOptions = { status: 1, createdAt: -1 };

    const totalJobs = await PrintJob.countDocuments(filter);
    const printJobs = await PrintJob.find(filter)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .populate("orderId")
      .populate("customDesignId");

    // Populate order items and product SKU
    const queueData = await Promise.all(
      printJobs.map(async (job) => {
        const order: any = job.orderId;
        const customItem = order?.items?.find((item: any) => item.customDesignId?.toString() === job.customDesignId?._id?.toString() || item._id?.toString() === job.orderItemId);
        
        let productInfo = null;
        if (customItem?.productId) {
          const product = await Product.findById(customItem.productId);
          const variant = product?.variants.find((v: any) => v._id?.toString() === customItem.variantId?.toString());
          productInfo = {
            name: product?.name || customItem.productName,
            sku: variant?.sku || "CUSTOM-SKU",
            color: customItem.selectedColor,
            size: customItem.selectedSize,
          };
        }

        return {
          _id: job._id,
          orderId: order?._id,
          orderNumber: order?.orderNumber || "UNKNOWN",
          customerName: order?.shippingAddress?.fullName || "Customer",
          item: customItem,
          product: productInfo,
          status: job.status,
          priority: job.priority,
          printLocations: job.printLocations,
          printMethod: job.printMethod,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        };
      })
    );

    // Search filter in memory if query provided
    let results = queueData;
    if (q) {
      const lower = q.toLowerCase();
      results = results.filter(
        (r) =>
          r.orderNumber.toLowerCase().includes(lower) ||
          r.customerName.toLowerCase().includes(lower) ||
          r.product?.name.toLowerCase().includes(lower) ||
          r.product?.sku.toLowerCase().includes(lower)
      );
    }

    res.status(200).json({
      success: true,
      data: results,
      pagination: {
        page,
        limit,
        total: totalJobs,
        pages: Math.ceil(totalJobs / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get Real Production Aggregated Analytics & KPIs
export const getProductionAnalytics = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Server-side start of day in UTC/IST
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [statusCounts, todayJobsCount, completedTodayCount] = await Promise.all([
      PrintJob.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
      PrintJob.countDocuments({ createdAt: { $gte: startOfToday } }),
      PrintJob.countDocuments({ status: PrintJobStatus.COMPLETED, updatedAt: { $gte: startOfToday } }),
    ]);

    const countsMap: Record<string, number> = {};
    statusCounts.forEach((sc) => {
      countsMap[sc._id] = sc.count;
    });

    const analytics = {
      total: Object.values(countsMap).reduce((a, b) => a + b, 0),
      pendingReview: countsMap[PrintJobStatus.PENDING_REVIEW] || 0,
      readyForPrint: countsMap[PrintJobStatus.READY_FOR_PRINT] || 0,
      printing: countsMap[PrintJobStatus.PRINTING] || 0,
      qualityCheck: countsMap[PrintJobStatus.QUALITY_CHECK] || 0,
      printed: countsMap[PrintJobStatus.PRINTED] || 0,
      completed: countsMap[PrintJobStatus.COMPLETED] || 0,
      rejected: countsMap[PrintJobStatus.REJECTED] || 0,
      jobsToday: todayJobsCount,
      completedToday: completedTodayCount,
    };

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Batch Update Priority
export const batchUpdatePriority = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { printJobIds, priority } = req.body;

    if (!Array.isArray(printJobIds) || printJobIds.length === 0) {
      return next(new AppError("printJobIds must be a non-empty array", 400));
    }

    if (printJobIds.length > 50) {
      return next(new AppError("Maximum 50 print jobs allowed per batch update", 400));
    }

    if (!Object.values(PrintJobPriority).includes(priority)) {
      return next(new AppError("Invalid priority value", 400));
    }

    const result = await PrintJob.updateMany(
      { _id: { $in: printJobIds } },
      { $set: { priority, updatedBy: req.user ? new mongoose.Types.ObjectId(req.user.id) : undefined } }
    );

    // Audit Log
    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_PRINT_PRIORITY_BATCH_UPDATED",
        entityType: "PRINT_JOB",
        entityId: printJobIds[0],
        metadata: { count: result.modifiedCount, priority },
      });
    }

    res.status(200).json({
      success: true,
      message: `Updated priority for ${result.modifiedCount} print jobs`,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Batch Export PrintJobs (ZIP package containing SVG artwork & manifest.json)
export const batchExportPrintJobs = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { printJobIds } = req.body;

    if (!Array.isArray(printJobIds) || printJobIds.length === 0) {
      return next(new AppError("printJobIds must be a non-empty array", 400));
    }

    if (printJobIds.length > 50) {
      return next(new AppError("Maximum 50 print jobs allowed per batch export", 400));
    }

    const printJobs = await PrintJob.find({ _id: { $in: printJobIds } }).populate("orderId");
    if (printJobs.length === 0) {
      return next(new AppError("No valid print jobs found for export", 404));
    }

    const zip = new JSZip();
    const manifestEntries: any[] = [];

    for (const job of printJobs) {
      const order: any = job.orderId;
      if (!order) continue;

      const customItem = order.items.find(
        (item: any) =>
          item.customDesignId?.toString() === job.customDesignId?.toString() ||
          item._id?.toString() === job.orderItemId
      );

      if (!customItem || !customItem.customizationSnapshot) continue;

      const snapshot = customItem.customizationSnapshot;
      const exportWidth = 3000;
      const exportHeight = 4000;

      // Construct High-Res Printable Artwork SVG for FRONT and BACK
      const createSvg = (side: string) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${exportWidth}" height="${exportHeight}" viewBox="0 0 ${exportWidth} ${exportHeight}">
  <rect width="${exportWidth}" height="320" fill="#f3f4f5"/>
  <text x="80" y="120" font-family="sans-serif" font-size="72" font-weight="bold" fill="#191c1d">ORDER EXPORT: ${order.orderNumber}</text>
  <text x="80" y="200" font-family="monospace" font-size="36" fill="#434655">GARMENT: ${customItem.productName} | COLOR: ${customItem.selectedColor} | SIZE: ${customItem.selectedSize}</text>
  <text x="80" y="270" font-family="monospace" font-size="36" fill="#434655">PRINT LOCATION: ${side} | TARGET: 300 DPI (3000x4000px)</text>
  <rect x="300" y="500" width="2400" height="3200" fill="none" stroke="#004ac6" stroke-width="8" stroke-dasharray="20 20"/>
  ${
    snapshot.previewImage
      ? `<image href="${snapshot.previewImage}" x="300" y="500" width="2400" height="3200" preserveAspectRatio="xMidYMid meet"/>`
      : `<text x="1500" y="2100" text-anchor="middle" font-size="64" fill="#888">HD Customer Artwork Placeholder</text>`
  }
</svg>`;

      const frontSvg = createSvg("FRONT");
      const safeOrderNum = order.orderNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
      
      zip.file(`${safeOrderNum}_FRONT.svg`, frontSvg);

      manifestEntries.push({
        jobId: job._id,
        orderNumber: order.orderNumber,
        productName: customItem.productName,
        selectedColor: customItem.selectedColor,
        selectedSize: customItem.selectedSize,
        quantity: customItem.quantity,
        printLocations: snapshot.printLocations || ["FRONT"],
        snapshotName: snapshot.name,
      });
    }

    zip.file("manifest.json", JSON.stringify(manifestEntries, null, 2));

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // Log Batch Export Action
    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_PRINT_BATCH_EXPORT_GENERATED",
        entityType: "PRINT_JOB",
        entityId: printJobs[0]._id.toString(),
        metadata: { count: printJobs.length },
      });
    }

    const timestamp = Date.now();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="sf_print_batch_${timestamp}.zip"`);
    res.status(200).send(zipBuffer);
  } catch (error) {
    next(error);
  }
};
