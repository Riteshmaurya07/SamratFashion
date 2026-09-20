import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ContentBanner, BannerStatus, BannerPosition } from "../models/ContentBanner";
import { Campaign, CampaignStatus } from "../models/Campaign";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// CTA URL Validator to prevent javascript: or executable protocols
function isValidCtaUrl(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase().trim();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
    return false;
  }
  return true;
}

const bannerSchema = z.object({
  title: z.string().min(2).max(120),
  subtitle: z.string().max(200).optional(),
  image: z.string().min(1),
  mobileImage: z.string().optional(),
  ctaLabel: z.string().max(50).optional(),
  ctaUrl: z.string().optional(),
  position: z.nativeEnum(BannerPosition).optional(),
  displayOrder: z.number().optional(),
  status: z.nativeEnum(BannerStatus).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

// 1. Get Admin Banners List
export const getAdminBanners = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const position = req.query.position as string;
    const status = req.query.status as string;

    const filter: any = {};
    if (position && position !== "All") filter.position = position;
    if (status && status !== "All") filter.status = status;

    const total = await ContentBanner.countDocuments(filter);
    const banners = await ContentBanner.find(filter)
      .sort({ displayOrder: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      data: banners,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// 2. Create Admin Banner
export const createAdminBanner = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parseResult = bannerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return next(new AppError(parseResult.error.issues[0]?.message || "Invalid banner data", 400));
    }

    const { title, subtitle, image, mobileImage, ctaLabel, ctaUrl, position, displayOrder, status, startsAt, endsAt } = parseResult.data;

    if (ctaUrl && !isValidCtaUrl(ctaUrl)) {
      return next(new AppError("Unsafe CTA URL protocol detected", 400));
    }

    const banner = await ContentBanner.create({
      title: title.trim(),
      subtitle: subtitle?.trim(),
      image,
      mobileImage,
      ctaLabel: ctaLabel?.trim(),
      ctaUrl: ctaUrl?.trim() || "/shop",
      position: position || BannerPosition.HERO,
      displayOrder: displayOrder || 0,
      status: status || BannerStatus.DRAFT,
      startsAt: startsAt ? new Date(startsAt) : undefined,
      endsAt: endsAt ? new Date(endsAt) : undefined,
    });

    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_BANNER_CREATED",
        entityType: "BANNER",
        entityId: banner._id.toString(),
        metadata: { title: banner.title, position: banner.position },
      });
    }

    res.status(201).json({
      success: true,
      message: "Banner created successfully.",
      data: banner,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Update Admin Banner Status
export const updateAdminBannerStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!Object.values(BannerStatus).includes(status)) {
      return next(new AppError("Invalid banner status value", 400));
    }

    const banner = await ContentBanner.findById(id);
    if (!banner) {
      return next(new AppError("Banner not found", 404));
    }

    banner.status = status as BannerStatus;
    await banner.save();

    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: status === BannerStatus.ACTIVE ? "ADMIN_BANNER_PUBLISHED" : "ADMIN_BANNER_PAUSED",
        entityType: "BANNER",
        entityId: banner._id.toString(),
        metadata: { newStatus: status },
      });
    }

    res.status(200).json({
      success: true,
      message: `Banner status updated to ${status}`,
      data: banner,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Delete Admin Banner
export const deleteAdminBanner = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const banner = await ContentBanner.findByIdAndDelete(id);
    if (!banner) {
      return next(new AppError("Banner not found", 404));
    }

    res.status(200).json({
      success: true,
      message: "Banner deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// 5. Get Admin Campaigns List
export const getAdminCampaigns = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const status = req.query.status as string;
    const filter: any = {};
    if (status && status !== "All") filter.status = status;

    const total = await Campaign.countDocuments(filter);
    const campaigns = await Campaign.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("bannerIds")
      .populate("couponId", "code discountType discountValue");

    res.status(200).json({
      success: true,
      data: campaigns,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// 6. Create Admin Campaign
export const createAdminCampaign = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, description, discountTag, status, startsAt, endsAt, bannerIds, couponId, productIds, categoryIds } = req.body;

    if (!name || !name.trim()) {
      return next(new AppError("Campaign name is required", 400));
    }

    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "") + "-" + Date.now();

    const campaign = await Campaign.create({
      name: name.trim(),
      slug,
      description: description?.trim(),
      discountTag: discountTag?.trim(),
      status: status || CampaignStatus.DRAFT,
      startsAt: startsAt ? new Date(startsAt) : undefined,
      endsAt: endsAt ? new Date(endsAt) : undefined,
      bannerIds: bannerIds || [],
      couponId: couponId || undefined,
      productIds: productIds || [],
      categoryIds: categoryIds || [],
    });

    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_CAMPAIGN_CREATED",
        entityType: "CAMPAIGN",
        entityId: campaign._id.toString(),
        metadata: { name: campaign.name },
      });
    }

    res.status(201).json({
      success: true,
      message: "Campaign created successfully.",
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

// 7. Update Admin Campaign Status
export const updateAdminCampaignStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!Object.values(CampaignStatus).includes(status)) {
      return next(new AppError("Invalid campaign status value", 400));
    }

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return next(new AppError("Campaign not found", 404));
    }

    campaign.status = status as CampaignStatus;
    await campaign.save();

    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: status === CampaignStatus.ACTIVE ? "ADMIN_CAMPAIGN_ACTIVATED" : "ADMIN_CAMPAIGN_PAUSED",
        entityType: "CAMPAIGN",
        entityId: campaign._id.toString(),
        metadata: { newStatus: status },
      });
    }

    res.status(200).json({
      success: true,
      message: `Campaign status updated to ${status}`,
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};
