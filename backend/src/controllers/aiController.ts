import { Request, Response, NextFunction } from "express";
import { AIDesignService } from "../services/aiDesignService";
import { AppError } from "../utils/AppError";

export const generateDesignAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt, style } = req.body;
    
    if (!prompt) {
      return next(new AppError("Prompt is required for generation", 400));
    }

    const result = await AIDesignService.generateImage({
      prompt,
      style,
    });

    if (!result.success) {
      return next(new AppError(result.error || "Failed to generate design", 500));
    }

    res.status(200).json({
      success: true,
      data: {
        imageUrl: result.imageUrl,
      },
    });
  } catch (error) {
    next(error);
  }
};
