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

    const mockUrl = `https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80`;
    const mockBytes = Buffer.isBuffer(fileBufferOrPathOrBase64)
      ? fileBufferOrPathOrBase64.length
      : fileBufferOrPathOrBase64.length;

    this.memoryAssets.set(publicId, { url: mockUrl, bytes: mockBytes });

    return {
      provider: 'local',
      publicId,
      url: mockUrl,
      secureUrl: mockUrl,
      width: 800,
      height: 1000,
      format: 'webp',
      bytes: mockBytes,
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
