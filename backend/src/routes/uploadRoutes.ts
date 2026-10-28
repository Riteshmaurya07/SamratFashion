import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth';
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
    if (error instanceof multer.MulterError) {
      next(new AppError(`File upload error: ${error.message}`, 400, 'FILE_UPLOAD_ERROR'));
      return;
    }
    if (error) {
      next(new AppError((error as Error).message || 'File upload failed.', 400, 'FILE_UPLOAD_ERROR'));
      return;
    }
    next();
  });
};

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 uploads per 15 minutes per IP
  message: { success: false, message: 'Too many upload requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.post('/image', uploadLimiter, optionalAuth, uploadSingleImage, uploadImage);
router.delete('/image', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), deleteImage);

export default router;
