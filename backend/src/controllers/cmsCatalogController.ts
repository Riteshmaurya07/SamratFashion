import { Request, Response, NextFunction } from "express";
import { ContentBanner, BannerStatus, BannerPosition } from "../models/ContentBanner";
import { Campaign, CampaignStatus } from "../models/Campaign";

// 1. Get Public Banners (ACTIVE & Valid Date Range Only)
export const getPublicBanners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const position = (req.query.position as string) || BannerPosition.HERO;
    const now = new Date();

    const filter: any = {
      position,
      status: BannerStatus.ACTIVE,
      $and: [
        { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    };

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
      .populate("couponId", "code discountType discountValue minOrderAmount")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: campaigns,
    });
  } catch (error) {
    next(error);
  }
};
