import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Review, ReviewStatus } from "../models/Review";
import { Order } from "../models/Order";
import { AppError } from "../utils/AppError";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

const reviewInputSchema = z.object({
  productId: z.string().min(1),
  orderId: z.string().min(1),
  orderItemId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(120).optional(),
  body: z.string().min(10).max(1000),
  photos: z.array(z.string().url().or(z.string().startsWith("data:image/"))).max(4).optional(),
});

// 1. Create Review (Delivered Purchase Verification Required)
export const createReview = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const parseResult = reviewInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return next(new AppError(parseResult.error.issues[0]?.message || "Invalid review data", 400));
    }

    const { productId, orderId, orderItemId, rating, title, body, photos } = parseResult.data;

    // Verify order exists and belongs to user
    const order = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!order) {
      return next(new AppError("Delivered purchase verification failed. Order not found.", 400));
    }

    // Verify order item exists in order
    const orderItem = order.items.find(
      (item: any) =>
        item.productId?.toString() === productId &&
        (item._id?.toString() === orderItemId || item.customDesignId?.toString() === orderItemId)
    );

    if (!orderItem) {
      return next(new AppError("You can only review products purchased in your verified orders.", 400));
    }

    // Check duplicate review
    const existingReview = await Review.findOne({ userId: req.user.id, orderId, orderItemId });
    if (existingReview) {
      return next(new AppError("You have already submitted a review for this purchased item.", 400));
    }

    const review = await Review.create({
      userId: req.user.id,
      productId,
      orderId,
      orderItemId,
      rating,
      title: title?.trim(),
      body: body.trim(),
      photos: photos || [],
      status: ReviewStatus.PENDING,
      isVerifiedPurchase: true,
    });

    res.status(201).json({
      success: true,
      message: "Your review has been submitted and is pending moderation.",
      data: review,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get Customer's Reviews & Unreviewed Purchases
export const getMyReviews = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const myReviews = await Review.find({ userId: req.user.id }).sort({ createdAt: -1 }).populate("productId", "name images slug");

    // Fetch customer's orders to find unreviewed items
    const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });

    const reviewedItemKeys = new Set(myReviews.map((r) => `${r.orderId.toString()}_${r.orderItemId}`));

    const pendingItems: any[] = [];
    orders.forEach((order) => {
      order.items.forEach((item: any) => {
        const itemKey = `${order._id.toString()}_${item._id?.toString() || item.customDesignId?.toString()}`;
        if (!reviewedItemKeys.has(itemKey)) {
          pendingItems.push({
            orderId: order._id,
            orderNumber: order.orderNumber,
            orderItemId: item._id?.toString() || item.customDesignId?.toString(),
            productId: item.productId,
            productName: item.productName,
            productImage: item.productImage,
            deliveredAt: order.updatedAt,
          });
        }
      });
    });

    res.status(200).json({
      success: true,
      data: {
        reviews: myReviews,
        unreviewedItems: pendingItems,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get Public Approved Reviews & PDP Rating Summary
export const getProductReviews = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    if (!mongoose.Types.ObjectId.isValid(productId as string)) {
      return next(new AppError("Invalid Product ID format", 400));
    }

    const filter = { productId, status: ReviewStatus.APPROVED };

    const totalReviews = await Review.countDocuments(filter);
    const reviews = await Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name");

    // Aggregation for Rating Histogram & Average Rating
    const aggregationResult = await Review.aggregate([
      { $match: { productId: new mongoose.Types.ObjectId(productId as string), status: ReviewStatus.APPROVED } },
      {
        $group: {
          _id: "$rating",
          count: { $sum: 1 },
        },
      },
    ]);

    const histogram: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sumRating = 0;
    let totalApproved = 0;

    aggregationResult.forEach((item) => {
      histogram[item._id] = item.count;
      sumRating += item._id * item.count;
      totalApproved += item.count;
    });

    const averageRating = totalApproved > 0 ? parseFloat((sumRating / totalApproved).toFixed(1)) : 0;

    // Collect Customer Photo Showcase Gallery (Approved Reviews with photos)
    const photoReviews = await Review.find({
      productId,
      status: ReviewStatus.APPROVED,
      "photos.0": { $exists: true },
    })
      .select("photos rating title userId createdAt")
      .populate("userId", "name")
      .limit(12);

    const customerPhotos = photoReviews.flatMap((r) =>
      r.photos.map((url) => ({
        url,
        rating: r.rating,
        author: (r.userId as any)?.name || "Verified Customer",
        createdAt: r.createdAt,
      }))
    );

    res.status(200).json({
      success: true,
      data: {
        reviews,
        summary: {
          averageRating,
          totalReviews,
          histogram,
        },
        customerPhotos,
        pagination: {
          page,
          limit,
          total: totalReviews,
          pages: Math.ceil(totalReviews / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
