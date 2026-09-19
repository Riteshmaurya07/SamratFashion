import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { uploadImage, deleteImage } from '../controllers/uploadController';
import { AppError } from '../utils/AppError';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});
const uploadSingleImage = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new AppError('File size exceeds maximum limit of 10MB.', 400, 'FILE_TOO_LARGE'));
      return;
    }
    next(error);
  });
};

const router = Router();

router.post('/image', requireAuth, uploadSingleImage, uploadImage);

export default router;
