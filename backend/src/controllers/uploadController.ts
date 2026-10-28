import { Request, Response } from 'express';
import DOMPurify from 'isomorphic-dompurify';
import { ImageService } from '../services/image/ImageService';

const ALLOWED_CATEGORIES = ['product', 'banner', 'campaign', 'custom-artwork', 'review'] as const;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Strict Magic-byte and content inspection.
 * Never trusts client-supplied MIME or file extensions.
 */
function detectFileKind(buffer: Buffer): 'jpeg' | 'png' | 'webp' | 'svg' | 'pdf' | null {
  if (buffer.length < 4) return null;

  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (buffer.subarray(0, 4).toString('ascii').startsWith('%PDF')) {
    return 'pdf';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // WebP: RIFF .... WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }

  // SVG: pure UTF-8 text containing svg tags, without binary NUL bytes
  const head = buffer.subarray(0, 2048);
  if (!head.includes(0)) {
    const trimmed = head.toString('utf-8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
    if (
      trimmed.startsWith('<svg') ||
      trimmed.startsWith('<?xml') ||
      trimmed.startsWith('<!doctype svg') ||
      trimmed.includes('<svg')
    ) {
      return 'svg';
    }
  }

  return null;
}

export async function uploadImage(req: Request, res: Response): Promise<void> {
  try {
    const category = (req.body.category || 'product').toLowerCase().trim();
    const user = (req as any).user;
    const userId = user?.id || 'anonymous';
    const userRole = user?.role;

    // Category Allowlist Validation
    if (!ALLOWED_CATEGORIES.includes(category as any)) {
      res.status(400).json({
        success: false,
        message: `Invalid upload category: ${category}. Permitted categories: ${ALLOWED_CATEGORIES.join(', ')}`,
      });
      return;
    }

    // RBAC Authorization Guard
    if (['product', 'banner', 'campaign'].includes(category)) {
      if (!userRole || !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        res.status(403).json({ success: false, message: 'Forbidden: Admin authorization required for catalog assets' });
        return;
      }
    } else if (category === 'custom-artwork') {
      // Public inquiry artwork upload allowed for guests and customers
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
      if (!fileKind) {
        res.status(400).json({ success: false, message: 'Invalid or unsupported file format. Content bytes do not match permitted image types.' });
        return;
      }

      const isSvg = fileKind === 'svg';
      const isPdf = fileKind === 'pdf';

      if (!isCustomArtwork && (isSvg || isPdf)) {
        res.status(400).json({ success: false, message: 'SVG and PDF files are only permitted for custom artwork uploads.' });
        return;
      }

      if (!ALLOWED_MIME_TYPES.includes(mime)) {
        res.status(400).json({ success: false, message: 'Invalid file MIME type. Allowed formats: PNG, JPG, WEBP, SVG, PDF.' });
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

      const base64Mime = matches[1].toLowerCase();
      if (!ALLOWED_MIME_TYPES.includes(base64Mime)) {
        res.status(400).json({ success: false, message: 'Invalid file MIME type in base64 payload.' });
        return;
      }

      const decodedBuffer = Buffer.from(matches[2], 'base64');
      const fileKind = detectFileKind(decodedBuffer);
      if (!fileKind) {
        res.status(400).json({ success: false, message: 'Invalid or unsupported file format. Decoded content bytes do not match permitted image types.' });
        return;
      }

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
    } else if (category === 'campaign') {
      result = await ImageService.uploadCMSBanner(uploadPayload, req.body.campaignId);
    } else {
      res.status(400).json({ success: false, message: 'Unhandled upload category' });
      return;
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
    const { publicId, url } = req.body;
    const target = publicId || url;
    if (!target) {
      res.status(400).json({ success: false, message: 'Public ID or image URL is required for asset deletion' });
      return;
    }

    const success = await ImageService.deleteAsset(target);
    res.status(200).json({ success, message: success ? 'Asset deleted' : 'Failed to delete asset' });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message || 'Asset deletion failed' });
  }
}
