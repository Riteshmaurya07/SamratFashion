import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { ImageService } from './src/services/image/ImageService';
import { CloudinaryImageStorageProvider } from './src/services/image/CloudinaryImageStorageProvider';

async function run() {
  console.log('--- STARTING CLOUDINARY LIVE E2E TEST ---');

  const providerType = process.env.IMAGE_PROVIDER;
  console.log(`1. Provider resolution: IMAGE_PROVIDER=${providerType}`);
  
  if (providerType !== 'cloudinary') {
    throw new Error('IMAGE_PROVIDER must be cloudinary');
  }
  
  const provider = ImageService.getProvider();
  console.log('Provider instantiated:', provider instanceof CloudinaryImageStorageProvider);
  
  // Create a small test image
  const testImagePath = path.join(__dirname, 'test-asset.jpg');
  // Just a tiny 1x1 base64 transparent gif masquerading as jpg or we can use base64 directly
  const base64Image = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  
  console.log('2. Real Cloudinary connection & 3. Real image upload');
  let result;
  try {
    result = await ImageService.uploadProductImage(base64Image, 'test-123');
    console.log('Upload Result:', result);
  } catch (error) {
    console.error('Upload failed:', error);
    process.exit(1);
  }

  console.log('4. Cloudinary asset exists');
  const exists = await (provider as CloudinaryImageStorageProvider).exists(result.publicId);
  console.log('Exists:', exists);

  console.log('5. CDN URL');
  console.log('URL:', result.url);
  console.log('Secure URL:', result.secureUrl);

  console.log('6. Transformation');
  const transformedUrl = ImageService.getProductImageUrl(result.publicId, { width: 100, height: 100, crop: 'fill' });
  console.log('Transformed URL:', transformedUrl);

  console.log('7. Delete');
  const deleted = await ImageService.deleteAsset(result.publicId);
  console.log('Deleted:', deleted);

  console.log('--- TEST FINISHED ---');
}

run().catch(console.error);
