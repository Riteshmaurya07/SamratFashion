import { v2 as cloudinary } from 'cloudinary';
import {
  IImageStorageProvider,
  ImageUploadOptions,
  ImageUploadResult,
  ImageTransformationOptions,
} from './IImageStorageProvider';

export class CloudinaryImageStorageProvider implements IImageStorageProvider {
  private cloudName: string;
  private apiKey: string;

  constructor() {
    this.cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
    this.apiKey = process.env.CLOUDINARY_API_KEY || '';
    const apiSecret = process.env.CLOUDINARY_API_SECRET || '';

    const providerEnv = process.env.IMAGE_PROVIDER || 'local';

    if (providerEnv === 'cloudinary' && (!this.cloudName || !this.apiKey || !apiSecret)) {
      throw new Error(
        'IMAGE_PROVIDER_CONFIG_ERROR: Missing required Cloudinary credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).'
      );
    }

    if (this.cloudName && this.apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: this.cloudName,
        api_key: this.apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    }
  }

  async upload(
    fileBufferOrPathOrBase64: string | Buffer,
    options?: ImageUploadOptions
  ): Promise<ImageUploadResult> {
    return new Promise((resolve, reject) => {
      const uploadParams: any = {
        folder: options?.folder || 'samrat-fashion/general',
        resource_type: options?.resourceType || 'auto',
      };

      if (options?.publicId) {
        uploadParams.public_id = options.publicId;
      }
      if (options?.tags) {
        uploadParams.tags = options.tags;
      }

      if (typeof fileBufferOrPathOrBase64 === 'string') {
        cloudinary.uploader.upload(fileBufferOrPathOrBase64, uploadParams, (error, result) => {
          if (error || !result) {
            return reject(new Error(`Cloudinary upload failed: ${error?.message || 'Unknown error'}`));
          }
          resolve({
            provider: 'cloudinary',
            publicId: result.public_id,
            url: result.url,
            secureUrl: result.secure_url,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
          });
        });
      } else {
        const stream = cloudinary.uploader.upload_stream(uploadParams, (error, result) => {
          if (error || !result) {
            return reject(new Error(`Cloudinary stream upload failed: ${error?.message || 'Unknown error'}`));
          }
          resolve({
            provider: 'cloudinary',
            publicId: result.public_id,
            url: result.url,
            secureUrl: result.secure_url,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
          });
        });
        stream.end(fileBufferOrPathOrBase64);
      }
    });
  }

  async delete(publicId: string): Promise<boolean> {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      return result.result === 'ok';
    } catch (err) {
      console.error(`Failed to delete Cloudinary asset ${publicId}:`, err);
      return false;
    }
  }

  getUrl(publicId: string, options?: ImageTransformationOptions): string {
    if (publicId.startsWith('http://') || publicId.startsWith('https://')) {
      return publicId;
    }

    const transformParams: any = {};
    if (options?.width) transformParams.width = options.width;
    if (options?.height) transformParams.height = options.height;
    if (options?.crop) transformParams.crop = options.crop;
    if (options?.quality) transformParams.quality = options.quality;
    if (options?.format) transformParams.fetch_format = options.format;
    if (options?.gravity) transformParams.gravity = options.gravity;

    return cloudinary.url(publicId, {
      secure: true,
      transformation: [transformParams],
    });
  }

  transform(publicId: string, options?: ImageTransformationOptions): string {
    return this.getUrl(publicId, options);
  }

  async exists(publicId: string): Promise<boolean> {
    try {
      const res = await cloudinary.api.resource(publicId);
      return !!res;
    } catch (err) {
      return false;
    }
  }
}
