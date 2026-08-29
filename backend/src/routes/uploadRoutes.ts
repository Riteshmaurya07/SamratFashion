import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { uploadImage, deleteImage } from '../controllers/uploadController';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const router = Router();

router.post('/image', requireAuth, upload.single('file'), uploadImage);
router.delete('/image', requireAuth, deleteImage as any);

export default router;
