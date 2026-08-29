import fs from 'fs';
import path from 'path';
import {
  IImageStorageProvider,
  ImageUploadOptions,
  ImageUploadResult,
  ImageTransformationOptions,
} from './IImageStorageProvider';

export class LocalImageStorageProvider implements IImageStorageProvider {
  private memoryAssets: Map<string, { url: string; bytes: number }> = new Map();

  async upload(
    fileBufferOrPathOrBase64: string | Buffer,
    options?: ImageUploadOptions
  ): Promise<ImageUploadResult> {
    const folder = options?.folder || 'samrat-fashion/general';
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 9);
    const publicId = options?.publicId || `${folder}/asset_${timestamp}_${randomId}`;

    let fileBuffer: Buffer;
    let extension = 'jpg';

    if (Buffer.isBuffer(fileBufferOrPathOrBase64)) {
      fileBuffer = fileBufferOrPathOrBase64;
    } else if (typeof fileBufferOrPathOrBase64 === 'string') {
      if (fileBufferOrPathOrBase64.startsWith('data:image/')) {
        const matches = fileBufferOrPathOrBase64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          fileBuffer = Buffer.from(matches[2], 'base64');
        } else {
          fileBuffer = Buffer.from(fileBufferOrPathOrBase64, 'utf-8');
        }
      } else if (fs.existsSync(fileBufferOrPathOrBase64)) {
        extension = path.extname(fileBufferOrPathOrBase64).replace('.', '') || 'jpg';
        fileBuffer = fs.readFileSync(fileBufferOrPathOrBase64);
      } else {
        fileBuffer = Buffer.from(fileBufferOrPathOrBase64, 'utf-8');
      }
    } else {
      throw new Error('Invalid file format provided for image upload');
    }

    const uploadsBaseDir = path.resolve(__dirname, '../../../uploads');
    const folderDir = path.join(uploadsBaseDir, folder);

    if (!fs.existsSync(folderDir)) {
      fs.mkdirSync(folderDir, { recursive: true });
    }

    const safeFilename = `${timestamp}_${randomId}.${extension}`;
    const filePath = path.join(folderDir, safeFilename);

    fs.writeFileSync(filePath, fileBuffer);

    const baseUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:5000';
    const fileUrl = `${baseUrl}/uploads/${folder}/${safeFilename}`;

    this.memoryAssets.set(publicId, { url: fileUrl, bytes: fileBuffer.length });

    return {
      provider: 'local',
      publicId,
      url: fileUrl,
      secureUrl: fileUrl,
      width: 800,
      height: 1000,
      format: extension,
      bytes: fileBuffer.length,
    };
  }

  async delete(publicId: string): Promise<boolean> {
    if (this.memoryAssets.has(publicId)) {
      this.memoryAssets.delete(publicId);
      return true;
    }
    return true;
  }

  getUrl(publicId: string, options?: ImageTransformationOptions): string {
    if (publicId.startsWith('http://') || publicId.startsWith('https://')) {
      return publicId;
    }
    const asset = this.memoryAssets.get(publicId);
    if (asset) return asset.url;
    return `https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=${options?.width || 800}`;
  }

  transform(publicId: string, options?: ImageTransformationOptions): string {
    return this.getUrl(publicId, options);
  }

  async exists(publicId: string): Promise<boolean> {
    return this.memoryAssets.has(publicId) || publicId.startsWith('http');
  }
}
