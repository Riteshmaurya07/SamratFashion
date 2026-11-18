import { Request, Response, NextFunction } from "express";
import { Coupon } from "../models/Coupon";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";
import {
  createCouponSchema,
  updateCouponSchema,
  couponStatusSchema,
} from "../utils/couponValidation";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export const createCoupon = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = createCouponSchema.parse(req.body);
    const normalizedCode = data.code.trim().toUpperCase();

    const existing = await Coupon.findOne({ code: normalizedCode });
    if (existing) {
      return next(new AppError("Coupon code already exists", 409, "DUPLICATE_CODE"));
    }

    const coupon = await Coupon.create({
      ...data,
      code: normalizedCode,
      createdBy: req.user!.id,
    });

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_COUPON_CREATED",
      entityType: "COUPON",
      entityId: coupon._id,
      metadata: { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue },
    });

    res.status(201).json({ success: true, data: coupon, message: "Coupon created successfully" });
  } catch (error) {
    next(error);
  }
};

export const updateCoupon = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = updateCouponSchema.parse(req.body);

    if (data.code) {
      const normalizedCode = data.code.trim().toUpperCase();
      const existing = await Coupon.findOne({ code: normalizedCode, _id: { $ne: req.params.id } });
      if (existing) {
        return next(new AppError("Coupon code already exists", 409, "DUPLICATE_CODE"));
      }
      data.code = normalizedCode;
    }

    const existingCoupon = await Coupon.findById(req.params.id);
    if (!existingCoupon) {
      return next(new AppError("Coupon not found", 404, "NOT_FOUND"));
    }

    const effectiveDiscountType = data.discountType ?? existingCoupon.discountType;
    const effectiveDiscountValue = data.discountValue ?? existingCoupon.discountValue;
    const effectiveMinOrderValue = data.minOrderValue ?? existingCoupon.minOrderValue ?? 0;
    if (effectiveDiscountType === "FIXED" && effectiveMinOrderValue <= effectiveDiscountValue) {
      return next(
        new AppError(
          "Minimum order value must be greater than the fixed discount amount so orders cannot become free",
          400,
          "VALIDATION_ERROR"
        )
      );
    }

    const coupon = await Coupon.findByIdAndUpdate(req.params.id, data as any, { returnDocument: 'after' });
    if (!coupon) {
      return next(new AppError("Coupon not found", 404, "NOT_FOUND"));
    }

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_COUPON_UPDATED",
      entityType: "COUPON",
      entityId: coupon._id,
      metadata: { code: coupon.code },
    });

    res.status(200).json({ success: true, data: coupon, message: "Coupon updated successfully" });
  } catch (error) {
    next(error);
  }
};

export const updateCouponStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = couponStatusSchema.parse(req.body);
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return next(new AppError("Coupon not found", 404, "NOT_FOUND"));
    }

    if (status === "ACTIVE" && coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      return next(new AppError("Cannot activate an expired coupon. Extend its expiry date first.", 400, "COUPON_EXPIRED"));
    }

    const prevStatus = coupon.status;
    coupon.status = status;
    await coupon.save();

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: status === "ACTIVE" ? "ADMIN_COUPON_ACTIVATED" : "ADMIN_COUPON_DEACTIVATED",
      entityType: "COUPON",
      entityId: coupon._id,
      metadata: { previousStatus: prevStatus, newStatus: status },
    });

    res.status(200).json({ success: true, data: coupon, message: `Coupon ${status.toLowerCase()}` });
  } catch (error) {
    next(error);
  }
};

export const getAdminCoupons = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const now = new Date();
    const query: any = {};
    if (req.query.search) {
      query.$or = [
        { code: { $regex: req.query.search, $options: "i" } },
        { description: { $regex: req.query.search, $options: "i" } },
      ];
    }
    if (req.query.status === "EXPIRED") {
      query.expiresAt = { $lt: now };
    } else if (req.query.status === "ACTIVE") {
      query.status = "ACTIVE";
      query.$and = [
        ...(query.$and || []),
        { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gte: now } }] },
      ];
    } else if (req.query.status) {
      query.status = req.query.status;
    }

    const [coupons, total] = await Promise.all([
      Coupon.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Coupon.countDocuments(query),
    ]);

    const enrichedCoupons = coupons.map((c: any) => {
      const isExpired = Boolean(c.expiresAt && new Date(c.expiresAt) < now);
      const isScheduled = Boolean(c.startsAt && new Date(c.startsAt) > now);
      const isExhausted = Boolean(c.usageLimit && c.usedCount >= c.usageLimit);
      let effectiveStatus = c.status;
      if (isExpired) {
        effectiveStatus = "EXPIRED";
      } else if (c.status === "ACTIVE" && isExhausted) {
        effectiveStatus = "EXHAUSTED";
      } else if (c.status === "ACTIVE" && isScheduled) {
        effectiveStatus = "SCHEDULED";
      }
      return {
        ...c,
        isExpired,
        effectiveStatus,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        items: enrichedCoupons,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminCouponById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const coupon = await Coupon.findById(req.params.id)
      .populate("applicableProductIds", "name slug")
      .populate("applicableCategoryIds", "name slug")
      .populate("applicableThemeIds", "name slug");

    if (!coupon) {
      return next(new AppError("Coupon not found", 404, "NOT_FOUND"));
    }

    res.status(200).json({ success: true, data: coupon });
  } catch (error) {
    next(error);
  }
};
