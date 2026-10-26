import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { ContentBanner, BannerStatus } from "../models/ContentBanner";
import { Campaign, CampaignStatus } from "../models/Campaign";

// 1. Get Public Banners (ACTIVE & Valid Date Range Only)
export const getPublicBanners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const position = req.query.position as string | undefined;
    const now = new Date();

    const filter: any = {
      status: BannerStatus.ACTIVE,
      $and: [
        { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    };

    if (position && position !== "ALL") {
      filter.position = position;
    }

    const audience = req.query.audience as string | undefined;
    if (audience && ["RETAIL", "B2B_CUSTOM"].includes(audience)) {
      filter.targetAudience = { $in: ["ALL", audience] };
    }

    const banners = await ContentBanner.find(filter).sort({ displayOrder: 1, createdAt: -1 });

    res.status(200).json({
      success: true,
      data: banners,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get Public Active Campaigns
export const getPublicActiveCampaigns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();

    const campaignFilter: any = {
      status: CampaignStatus.ACTIVE,
      $and: [
        { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    };

    const campaigns = await Campaign.find(campaignFilter)
      .populate("bannerIds")
      .populate("couponId", "code discountType discountValue minOrderValue")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: campaigns,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Track Banner Impression
export const trackBannerImpression = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
    if (id && mongoose.Types.ObjectId.isValid(id)) {
      await ContentBanner.findByIdAndUpdate(id, { $inc: { impressions: 1 } });
    }
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

// 4. Track Banner Click
export const trackBannerClick = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
    if (id && mongoose.Types.ObjectId.isValid(id)) {
      await ContentBanner.findByIdAndUpdate(id, { $inc: { clicks: 1 } });
    }
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};
