import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Review, ReviewStatus } from "../models/Review";
import { Product } from "../models/Product";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// 1. Get Paginated Admin Reviews
export const getAdminReviews = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    const status = req.query.status as string;
    const rating = req.query.rating ? parseInt(req.query.rating as string) : undefined;
    const q = req.query.q as string;

    const filter: any = {};
    if (status && status !== "All") filter.status = status;
    if (rating) filter.rating = rating;

    const totalReviews = await Review.countDocuments(filter);
    const reviews = await Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name email")
      .populate("productId", "name images slug");

    let results = reviews;
    if (q) {
      const lower = q.toLowerCase();
      results = results.filter(
        (r: any) =>
          r.body.toLowerCase().includes(lower) ||
          r.userId?.name?.toLowerCase().includes(lower) ||
          r.productId?.name?.toLowerCase().includes(lower)
      );
    }

    res.status(200).json({
      success: true,
      data: results,
      pagination: {
        page,
        limit,
        total: totalReviews,
        pages: Math.ceil(totalReviews / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// 2. Moderate Review (Approve or Reject) & Recalculate Product Aggregates
export const moderateReview = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return next(new AppError("Invalid Review ID", 400));
    }

    if (!Object.values(ReviewStatus).includes(status)) {
      return next(new AppError("Invalid status value", 400));
    }

    const review = await Review.findById(id);
    if (!review) {
      return next(new AppError("Review not found", 404));
    }

    review.status = status as ReviewStatus;
    await review.save();

    // Recalculate Product Rating Aggregates for Approved Reviews
    const approvedStats = await Review.aggregate([
      { $match: { productId: review.productId, status: ReviewStatus.APPROVED } },
      {
        $group: {
          _id: "$productId",
          averageRating: { $avg: "$rating" },
          reviewCount: { $sum: 1 },
        },
      },
    ]);

    const averageRating = approvedStats[0] ? parseFloat(approvedStats[0].averageRating.toFixed(1)) : 0;
    const reviewCount = approvedStats[0] ? approvedStats[0].reviewCount : 0;

    await Product.findByIdAndUpdate(review.productId, {
      averageRating,
      reviewCount,
    });

    // Log Moderation Action
    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: status === ReviewStatus.APPROVED ? "ADMIN_REVIEW_APPROVED" : "ADMIN_REVIEW_REJECTED",
        entityType: "REVIEW",
        entityId: review._id.toString(),
        metadata: { productId: review.productId.toString(), newStatus: status },
      });
    }

    res.status(200).json({
      success: true,
      message: `Review moderation status updated to ${status}`,
      data: review,
    });
  } catch (error) {
    next(error);
  }
};
