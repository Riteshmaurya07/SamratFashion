import { Request, Response } from 'express';
import DOMPurify from 'isomorphic-dompurify';
import { ImageService } from '../services/image/ImageService';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Magic-byte/byte-content detection — never trust the client-supplied MIME type or
// file extension (they can be spoofed, e.g. SVG markup disguised as an image/png).
function detectFileKind(buffer: Buffer): 'svg' | 'pdf' | 'image' {
  const head = buffer.subarray(0, 2048);
  if (head.subarray(0, 4).toString('ascii').toLowerCase().startsWith('%pdf')) {
    return 'pdf';
  }
  // Real SVG/XHTML files are pure UTF-8 text; binary formats (PNG/JPEG/WEBP) contain
  // NUL bytes within the scan window. Guard against binary metadata strings like "<svg"
  // causing false positives (which would corrupt/reject valid images).
  if (head.includes(0)) {
    return 'image';
  }
  const trimmed = head.toString('utf-8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (
    trimmed.startsWith('<svg') ||
    trimmed.startsWith('<?xml') ||
    trimmed.startsWith('<!doctype svg') ||
    trimmed.includes('<svg')
  ) {
    return 'svg';
  }
  return 'image';
}

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
    const isCustomArtwork = category === 'custom-artwork';

    if (req.file) {
      const mime = req.file.mimetype.toLowerCase();
      const fileKind = detectFileKind(req.file.buffer);
      const isSvg = fileKind === 'svg';
      const isPdf = fileKind === 'pdf';

      if (!isCustomArtwork && (isSvg || isPdf)) {
        res.status(400).json({ success: false, message: 'SVG and PDF files are only permitted for custom artwork uploads.' });
        return;
      }

      if (!ALLOWED_MIME_TYPES.includes(mime) && !isSvg && !isPdf) {
        res.status(400).json({ success: false, message: 'Invalid file format. Allowed formats: PNG, JPG, WEBP, SVG, PDF.' });
        return;
      }

      if (req.file.size > MAX_FILE_SIZE) {
        res.status(400).json({ success: false, message: 'File size exceeds maximum limit of 10MB.' });
        return;
      }

      if (isSvg) {
        const rawSvg = req.file.buffer.toString('utf-8');
        const sanitizedSvg = DOMPurify.sanitize(rawSvg, { USE_PROFILES: { svg: true } });
        uploadPayload = Buffer.from(sanitizedSvg, 'utf-8');
      } else {
        uploadPayload = req.file.buffer;
      }
    } else if (req.body.base64) {
      const base64Str = req.body.base64;
      const matches = base64Str.match(/^data:([a-zA-Z0-9\+\-\/]+);base64,(.+)$/);
      if (!matches) {
        res.status(400).json({ success: false, message: 'Invalid base64 payload data URI.' });
        return;
      }

      const decodedBuffer = Buffer.from(matches[2], 'base64');
      const fileKind = detectFileKind(decodedBuffer);
      const isSvg = fileKind === 'svg';
      const isPdf = fileKind === 'pdf';

      if (!isCustomArtwork && (isSvg || isPdf)) {
        res.status(400).json({ success: false, message: 'SVG and PDF files are only permitted for custom artwork uploads.' });
        return;
      }

      if (decodedBuffer.length > MAX_FILE_SIZE) {
        res.status(400).json({ success: false, message: 'File size exceeds maximum limit of 10MB.' });
        return;
      }

      if (isSvg) {
        const rawSvg = decodedBuffer.toString('utf-8');
        const sanitizedSvg = DOMPurify.sanitize(rawSvg, { USE_PROFILES: { svg: true } });
        uploadPayload = Buffer.from(sanitizedSvg, 'utf-8');
      } else {
        uploadPayload = decodedBuffer;
      }
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
