import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { CustomTemplate } from "../models/CustomTemplate";
import { AppError } from "../utils/AppError";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export const getTemplates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, tags } = req.query;
    const query: any = { isActive: true };
    
    if (category) query.category = category;
    if (tags) {
      const tagsArray = (tags as string).split(',').map(t => t.trim());
      query.tags = { $in: tagsArray };
    }

    const templates = await CustomTemplate.find(query).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: templates,
    });
  } catch (error) {
    next(error);
  }
};

export const getTemplateById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid template ID format", 400));
    }

    const template = await CustomTemplate.findOne({ _id: id, isActive: true });
    
    if (!template) {
      return next(new AppError("Template not found", 404));
    }

    res.status(200).json({
      success: true,
      data: template,
    });
  } catch (error) {
    next(error);
  }
};


