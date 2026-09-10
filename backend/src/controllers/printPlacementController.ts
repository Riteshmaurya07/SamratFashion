import { Request, Response } from "express";
import { PrintPlacementTemplate } from "../models/PrintPlacementTemplate";

export const getPrintPlacementTemplates = async (req: Request, res: Response) => {
  try {
    const templates = await PrintPlacementTemplate.find({ isActive: true }).sort({ sortOrder: 1 });
    res.json({
      success: true,
      data: templates,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch print placement templates",
    });
  }
};
