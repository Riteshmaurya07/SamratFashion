import { IImageStorageProvider, ImageUploadOptions, ImageUploadResult, ImageTransformationOptions } from './IImageStorageProvider';
import { CloudinaryImageStorageProvider } from './CloudinaryImageStorageProvider';
import { LocalImageStorageProvider } from './LocalImageStorageProvider';

export class ImageService {
  private static providerInstance: IImageStorageProvider | null = null;

  public static getProvider(): IImageStorageProvider {
    if (!this.providerInstance) {
      const providerType = process.env.IMAGE_PROVIDER || 'local';
      if (providerType === 'cloudinary') {
        this.providerInstance = new CloudinaryImageStorageProvider();
      } else {
        this.providerInstance = new LocalImageStorageProvider();
      }
    }
    return this.providerInstance;
  }

  // Allow custom provider injection for automated testing
  public static setProvider(provider: IImageStorageProvider): void {
    this.providerInstance = provider;
  }

  public static resetProvider(): void {
    this.providerInstance = null;
  }

  public static async uploadProductImage(
    file: string | Buffer,
    productId?: string
  ): Promise<ImageUploadResult> {
    try {
      const provider = this.getProvider();
      return await provider.upload(file, {
        folder: 'samrat-fashion/products',
        tags: ['product', productId || 'general'].filter(Boolean),
      });
    } catch (err: any) {
      if ((process.env.IMAGE_PROVIDER || 'local') === 'cloudinary') {
        throw err;
      }
      console.warn(`[ImageService] Primary provider failed (${err?.message || err}), falling back to LocalImageStorageProvider.`);
      const fallback = new LocalImageStorageProvider();
      return await fallback.upload(file, {
        folder: 'samrat-fashion/products',
        tags: ['product', productId || 'general'].filter(Boolean),
      });
    }
  }

  public static async uploadCustomArtwork(
    file: string | Buffer,
    userId: string
  ): Promise<ImageUploadResult> {
    try {
      const provider = this.getProvider();
      return await provider.upload(file, {
        folder: 'samrat-fashion/custom-designs',
        tags: ['custom-artwork', `user_${userId}`],
      });
    } catch (err: any) {
      if ((process.env.IMAGE_PROVIDER || 'local') === 'cloudinary') {
        throw err;
      }
      console.warn(`[ImageService] Primary provider failed (${err?.message || err}), falling back to LocalImageStorageProvider.`);
      const fallback = new LocalImageStorageProvider();
      return await fallback.upload(file, {
        folder: 'samrat-fashion/custom-designs',
        tags: ['custom-artwork', `user_${userId}`],
      });
    }
  }

  public static async uploadReviewPhoto(
    file: string | Buffer,
    reviewId?: string
  ): Promise<ImageUploadResult> {
    try {
      const provider = this.getProvider();
      return await provider.upload(file, {
        folder: 'samrat-fashion/reviews',
        tags: ['review', reviewId || 'general'].filter(Boolean),
      });
    } catch (err: any) {
      if ((process.env.IMAGE_PROVIDER || 'local') === 'cloudinary') {
        throw err;
      }
      console.warn(`[ImageService] Primary provider failed (${err?.message || err}), falling back to LocalImageStorageProvider.`);
      const fallback = new LocalImageStorageProvider();
      return await fallback.upload(file, {
        folder: 'samrat-fashion/reviews',
        tags: ['review', reviewId || 'general'].filter(Boolean),
      });
    }
  }

  public static async uploadCMSBanner(
    file: string | Buffer,
    bannerId?: string
  ): Promise<ImageUploadResult> {
    try {
      const provider = this.getProvider();
      return await provider.upload(file, {
        folder: 'samrat-fashion/banners',
        tags: ['cms', 'banner', bannerId || 'general'].filter(Boolean),
      });
    } catch (err: any) {
      if ((process.env.IMAGE_PROVIDER || 'local') === 'cloudinary') {
        throw err;
      }
      console.warn(`[ImageService] Primary provider failed (${err?.message || err}), falling back to LocalImageStorageProvider.`);
      const fallback = new LocalImageStorageProvider();
      return await fallback.upload(file, {
        folder: 'samrat-fashion/banners',
        tags: ['cms', 'banner', bannerId || 'general'].filter(Boolean),
      });
    }
  }

  public static async deleteAsset(publicId: string): Promise<boolean> {
    if (!publicId) return true;
    const provider = this.getProvider();
    return provider.delete(publicId);
  }

  public static getThumbnailUrl(publicId: string): string {
    const provider = this.getProvider();
    return provider.getUrl(publicId, {
      width: 300,
      height: 400,
      crop: 'fill',
      quality: 'auto',
      format: 'auto',
    });
  }

  public static getProductImageUrl(publicId: string, options?: ImageTransformationOptions): string {
    const provider = this.getProvider();
    return provider.getUrl(publicId, {
      width: options?.width || 800,
      height: options?.height || 1000,
      crop: options?.crop || 'fit',
      quality: options?.quality || 'auto',
      format: options?.format || 'auto',
    });
  }
}
