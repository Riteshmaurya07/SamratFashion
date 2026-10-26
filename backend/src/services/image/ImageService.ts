import { IImageStorageProvider, ImageUploadResult, ImageTransformationOptions } from './IImageStorageProvider';
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

  /**
   * Extracts storage publicId from an image URL or identifier.
   * Handles full Cloudinary URLs, transformed URLs, and local upload paths.
   */
  public static extractPublicId(urlOrId?: string): string | null {
    if (!urlOrId || typeof urlOrId !== 'string') return null;
    const trimmed = urlOrId.trim();

    // 1. Cloudinary full or transformed URL
    if (trimmed.includes('res.cloudinary.com')) {
      const match = trimmed.match(
        /\/image\/upload\/(?:(?:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+|[a-zA-Z]_[^/]+),?\/)*(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/
      );
      if (match && match[1]) {
        return match[1];
      }
    }

    // 2. Relative publicId starting with standard folder (samrat-fashion/...)
    if (trimmed.startsWith('samrat-fashion/')) {
      return trimmed.replace(/\.[a-zA-Z0-9]+$/, '');
    }

    // 3. Local storage upload path
    if (trimmed.includes('/uploads/')) {
      const parts = trimmed.split('/uploads/');
      if (parts[1]) {
        return parts[1];
      }
    }

    return null;
  }

  /**
   * Deletes an asset by its publicId or URL.
   */
  public static async deleteAsset(publicIdOrUrl: string): Promise<boolean> {
    if (!publicIdOrUrl) return true;
    const publicId = this.extractPublicId(publicIdOrUrl) || publicIdOrUrl;
    const provider = this.getProvider();
    return provider.delete(publicId);
  }

  /**
   * Deletes an asset by URL.
   */
  public static async deleteAssetByUrl(urlOrId?: string): Promise<boolean> {
    const publicId = this.extractPublicId(urlOrId);
    if (!publicId) return false;
    return this.deleteAsset(publicId);
  }

  /**
   * Deletes multiple assets by their URLs or publicIds.
   * Deduplicates identifiers and ignores external non-Cloudinary/non-local URLs.
   */
  public static async deleteAssetsByUrls(urlsOrIds: (string | undefined | null)[]): Promise<number> {
    const publicIds = Array.from(
      new Set(
        urlsOrIds
          .map((u) => (u ? this.extractPublicId(u) : null))
          .filter((id): id is string => Boolean(id))
      )
    );

    let deletedCount = 0;
    await Promise.allSettled(
      publicIds.map(async (id) => {
        try {
          const deleted = await this.deleteAsset(id);
          if (deleted) deletedCount++;
        } catch (err) {
          console.error(`[ImageService] Failed to delete asset ${id}:`, err);
        }
      })
    );

    return deletedCount;
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
