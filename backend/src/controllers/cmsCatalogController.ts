import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { ContentBanner, BannerStatus } from "../models/ContentBanner";
import { Campaign, CampaignStatus } from "../models/Campaign";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cmsMemoryCache = new Map<string, CacheEntry<unknown>>();

export function invalidateCmsCache(prefix?: string) {
  if (prefix) {
    for (const key of cmsMemoryCache.keys()) {
      if (key.startsWith(prefix)) cmsMemoryCache.delete(key);
    }
  } else {
    cmsMemoryCache.clear();
  }
}
function setCacheHeaders(res: Response, value: string): void {
  if (typeof res?.setHeader === "function") {
    res.setHeader("Cache-Control", value);
  }
}

function getCmsFromCache<T>(key: string): T | null {
  const entry = cmsMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cmsMemoryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCmsInCache<T>(key: string, data: T, ttlMs = 60000): void {
  cmsMemoryCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// 1. Get Public Banners (ACTIVE & Valid Date Range Only)
export const getPublicBanners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const position = req.query.position as string | undefined;
    const audience = req.query.audience as string | undefined;
    const cacheKey = `banners_${position || "ALL"}_${audience || "ALL"}`;
    const cached = getCmsFromCache<unknown[]>(cacheKey);
    if (cached) {
      setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ success: true, data: cached });
    }

    const now = new Date();

    const filter: Record<string, unknown> = {
      status: BannerStatus.ACTIVE,
      $and: [
        { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    };

    if (position && position !== "ALL") {
      filter.position = position;
    }

    if (audience && ["RETAIL", "B2B_CUSTOM"].includes(audience)) {
      filter.targetAudience = { $in: ["ALL", audience] };
    }

    const banners = await ContentBanner.find(filter).sort({ displayOrder: 1, createdAt: -1 }).lean();
    setCmsInCache(cacheKey, banners, 60000);

    setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
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
    const cached = getCmsFromCache<unknown[]>("activeCampaigns");
    if (cached) {
      setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ success: true, data: cached });
    }

    const now = new Date();

    const campaignFilter: Record<string, unknown> = {
      status: CampaignStatus.ACTIVE,
      $and: [
        { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    };

    const campaigns = await Campaign.find(campaignFilter)
      .populate("bannerIds")
      .populate("couponId", "code discountType discountValue minOrderValue status startsAt expiresAt usageLimit usedCount")
      .sort({ createdAt: -1 })
      .lean();

    // Only expose linked coupons that are actually usable right now
    const sanitizedCampaigns = campaigns.map((campaign: any) => {
      const c = campaign.couponId;
      if (!c || typeof c !== "object") {
        return { ...campaign, couponId: null };
      }
      const isInactive = c.status !== "ACTIVE";
      const isExpired = Boolean(c.expiresAt && new Date(c.expiresAt) < now);
      const isNotStarted = Boolean(c.startsAt && new Date(c.startsAt) > now);
      const isExhausted = Boolean(c.usageLimit && (c.usedCount || 0) >= c.usageLimit);
      if (isInactive || isExpired || isNotStarted || isExhausted) {
        return { ...campaign, couponId: null };
      }
      return {
        ...campaign,
        couponId: {
          _id: c._id,
          code: c.code,
          discountType: c.discountType,
          discountValue: c.discountValue,
          minOrderValue: c.minOrderValue,
        },
      };
    });

    setCmsInCache("activeCampaigns", sanitizedCampaigns, 60000);

    setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      success: true,
      data: sanitizedCampaigns,
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
