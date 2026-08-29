export interface ImageUploadOptions {
  folder?: string;
  publicId?: string;
  tags?: string[];
  transformation?: Record<string, any>;
  resourceType?: 'image' | 'raw' | 'auto';
}

export interface ImageUploadResult {
  provider: string;
  publicId: string;
  url: string;
  secureUrl: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}

export interface ImageTransformationOptions {
  width?: number;
  height?: number;
  crop?: string;
  quality?: string | number;
  format?: 'webp' | 'avif' | 'png' | 'jpg' | 'auto';
  gravity?: string;
}

export interface IImageStorageProvider {
  upload(fileBufferOrPathOrBase64: string | Buffer, options?: ImageUploadOptions): Promise<ImageUploadResult>;
  delete(publicId: string): Promise<boolean>;
  getUrl(publicId: string, options?: ImageTransformationOptions): string;
  transform(publicId: string, options?: ImageTransformationOptions): string;
  exists(publicId: string): Promise<boolean>;
}
