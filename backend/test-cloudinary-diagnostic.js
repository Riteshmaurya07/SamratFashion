const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const cloudinary = require('cloudinary').v2;

async function run() {
  console.log('--- CLOUDINARY 403 DIAGNOSTIC ---');

  const providerType = process.env.IMAGE_PROVIDER;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  console.log('1. ENVIRONMENT LOADED:');
  console.log(`IMAGE_PROVIDER: ${providerType}`);
  console.log(`CLOUDINARY_CLOUD_NAME: ${cloudName ? 'configured (length: ' + cloudName.length + ')' : 'missing'}`);
  console.log(`CLOUDINARY_API_KEY: ${apiKey ? 'configured (length: ' + apiKey.length + ')' : 'missing'}`);
  console.log(`CLOUDINARY_API_SECRET: ${apiSecret ? 'configured (length: ' + apiSecret.length + ')' : 'missing'}`);

  console.log('\n2. CONFIGURING CLOUDINARY SDK:');
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  console.log('SDK Configured.');

  console.log('\n3. REACHABILITY & DIAGNOSTIC:');
  try {
    const pingResult = await cloudinary.api.ping();
    console.log('Ping result:', pingResult);
  } catch (error) {
    console.error('Ping failed:', error.message || error);
    if (error.http_code) {
      console.error(`HTTP Code: ${error.http_code}`);
    }
  }

  try {
    console.log('\nTesting safe diagnostic operation (cloudinary.api.usage):');
    const usageResult = await cloudinary.api.usage();
    console.log('Usage result (keys snippet):', Object.keys(usageResult));
  } catch (error) {
    console.error('Usage failed:', error.message || error);
    if (error.http_code) {
      console.error(`HTTP Code: ${error.http_code}`);
    }
  }

  console.log('\n4. CONTROLLED UPLOAD TEST:');
  try {
    const base64Image = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const uploadResult = await cloudinary.uploader.upload(base64Image, {
      folder: 'samrat-fashion/diagnostic',
      tags: ['diagnostic']
    });
    console.log('Upload Result SUCCESS:');
    console.log('Public ID:', uploadResult.public_id);
    console.log('URL:', uploadResult.url);
    console.log('Status: 200 assumed as upload resolved');
    
    // Cleanup
    await cloudinary.uploader.destroy(uploadResult.public_id);
    console.log('Cleanup successful');
  } catch (error) {
    console.error('Upload failed with exact error:');
    console.error(error.message || error);
    if (error.http_code) {
      console.error(`HTTP Code: ${error.http_code}`);
    }
  }

  console.log('\n--- DIAGNOSTIC FINISHED ---');
}

run().catch(console.error);
