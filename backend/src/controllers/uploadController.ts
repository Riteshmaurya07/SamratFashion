import { Request, Response } from 'express';
import DOMPurify from 'isomorphic-dompurify';
import { ImageService } from '../services/image/ImageService';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function uploadImage(req: Request, res: Response): Promise<void> {
  try {
    const category = (req.body.category || 'product').toLowerCase();
    const user = (req as any).user;
    const userId = user?.id || 'anonymous';
    const userRole = user?.role;

    // RBAC Authorization Guard
    if (['product', 'banner', 'campaign'].includes(category)) {
      if (!userRole || !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        res.status(403).json({ success: false, message: 'Forbidden: Admin authorization required for catalog assets' });
        return;
      }
    } else {
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized: Login required for image upload' });
        return;
      }
    }

    let uploadPayload: string | Buffer | null = null;
    let originalMimeType = req.file?.mimetype || '';
    let isSvg = false;

    if (req.file) {
      if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype) && !req.file.originalname.toLowerCase().endsWith('.svg') && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
        res.status(400).json({ success: false, message: 'Invalid file format. Allowed formats: PNG, JPG, WEBP, SVG, PDF.' });
        return;
      }
      if (req.file.size > MAX_FILE_SIZE) {
        res.status(400).json({ success: false, message: 'File size exceeds maximum limit of 10MB.' });
        return;
      }

      isSvg = req.file.mimetype === 'image/svg+xml' || req.file.originalname.toLowerCase().endsWith('.svg');
      if (isSvg) {
        // Sanitize SVG with isomorphic-dompurify
        const rawSvg = req.file.buffer.toString('utf-8');
        const sanitizedSvg = DOMPurify.sanitize(rawSvg, { USE_PROFILES: { svg: true } });
        uploadPayload = Buffer.from(sanitizedSvg, 'utf-8');
      } else {
        uploadPayload = req.file.buffer;
      }
    } else if (req.body.base64) {
      const base64Str = req.body.base64;
      if (!base64Str.startsWith('data:image/') && !base64Str.startsWith('data:application/pdf')) {
        res.status(400).json({ success: false, message: 'Invalid base64 payload.' });
        return;
      }
      uploadPayload = base64Str;
    } else {
      res.status(400).json({ success: false, message: 'No file or base64 payload provided.' });
      return;
    }

    if (!uploadPayload) {
      res.status(400).json({ success: false, message: 'Invalid image payload.' });
      return;
    }

    let result;
    if (category === 'product') {
      result = await ImageService.uploadProductImage(uploadPayload, req.body.productId);
    } else if (category === 'custom-artwork') {
      result = await ImageService.uploadCustomArtwork(uploadPayload, userId);
    } else if (category === 'review') {
      result = await ImageService.uploadReviewPhoto(uploadPayload, req.body.reviewId);
    } else if (category === 'banner') {
      result = await ImageService.uploadCMSBanner(uploadPayload, req.body.bannerId);
    } else {
      result = await ImageService.uploadProductImage(uploadPayload);
    }

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        provider: result.provider,
        publicId: result.publicId,
        url: result.secureUrl || result.url,
        width: result.width,
        height: result.height,
        format: result.format,
      },
    });
  } catch (err: any) {
    console.error('Image upload controller error:', err);
    res.status(500).json({ success: false, message: err.message || 'Image upload failed. Please try again.' });
  }
}

export async function deleteImage(req: Request, res: Response): Promise<void> {
  try {
    const { publicId } = req.body;
    if (!publicId) {
      res.status(400).json({ success: false, message: 'Public ID is required for asset deletion' });
      return;
    }

    const success = await ImageService.deleteAsset(publicId);
    res.status(200).json({ success, message: success ? 'Asset deleted' : 'Failed to delete asset' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Asset deletion failed' });
  }
}
