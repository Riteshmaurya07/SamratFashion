import { Request, Response } from "express";
import { PrintPlacementTemplate } from "../models/PrintPlacementTemplate";
import { z } from "zod";

const templateSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  side: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().url(),
  previewConfig: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  isActive: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

export const getTemplates = async (req: Request, res: Response) => {
  try {
    const templates = await PrintPlacementTemplate.find().sort({ sortOrder: 1 });
    res.json({ success: true, data: templates });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to fetch templates" });
  }
};

export const getTemplateById = async (req: Request, res: Response) => {
  try {
    const template = await PrintPlacementTemplate.findById(req.params.id);
    if (!template) {
      res.status(404).json({ success: false, message: "Template not found" });
      return;
    }
    res.json({ success: true, data: template });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to fetch template" });
  }
};

export const createTemplate = async (req: Request, res: Response) => {
  try {
    const validatedData = templateSchema.parse(req.body);
    const exists = await PrintPlacementTemplate.findOne({ code: validatedData.code });
    if (exists) {
      res.status(400).json({ success: false, message: "Template with this code already exists" });
      return;
    }
    const template = new PrintPlacementTemplate(validatedData);
    await template.save();
    res.status(201).json({ success: true, data: template });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Validation failed" });
  }
};

export const updateTemplate = async (req: Request, res: Response) => {
  try {
    const validatedData = templateSchema.parse(req.body);
    const template = await PrintPlacementTemplate.findByIdAndUpdate(req.params.id, validatedData, { new: true, runValidators: true });
    if (!template) {
      res.status(404).json({ success: false, message: "Template not found" });
      return;
    }
    res.json({ success: true, data: template });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Validation failed" });
  }
};

export const deleteTemplate = async (req: Request, res: Response) => {
  try {
    const template = await PrintPlacementTemplate.findById(req.params.id);
    if (!template) {
      res.status(404).json({ success: false, message: "Template not found" });
      return;
    }
    
    // Instead of deleting, just deactivate it to maintain referential integrity
    template.isActive = false;
    await template.save();
    
    res.json({ success: true, message: "Template deactivated successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to deactivate template" });
  }
};
