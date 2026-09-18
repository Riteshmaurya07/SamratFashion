import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { CustomDesign } from './src/models/CustomDesign';
import Product from './src/models/Product';
import { productionAssetService } from './src/services/productionAssetService';

async function runTest() {
  console.log('--- Phase 5 Production Commerce & Asset Pipeline Test ---');

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/samrat_fashion');
    console.log('✅ Connected to MongoDB');

    // Test 1: Validate CustomDesign Status Enum
    console.log('\n--- Test 1: Validating CustomDesign Status Enum ---');
    const validStatuses = ["DRAFT", "SUBMITTED", "PREVIEW_GENERATED", "CUSTOMER_REVIEW", "CUSTOMER_APPROVED", "REVISION_REQUESTED", "PRODUCTION_VALIDATION", "PRODUCTION_READY", "IN_PRODUCTION", "COMPLETED"];
    const schemaStatuses = CustomDesign.schema.path('status').enumValues;
    
    let enumValid = true;
    for (const status of validStatuses) {
      if (!schemaStatuses.includes(status)) {
        console.error(`❌ CustomDesign schema missing status: ${status}`);
        enumValid = false;
      }
    }
    if (enumValid) {
      console.log('✅ CustomDesign schema includes all required production statuses.');
    }

    // Test 2: Validate productionAssetService Abstraction
    console.log('\n--- Test 2: Validating Production Asset Service ---');
    try {
      // Mock design
      const mockDesign = {
        versions: [{
          version: 1,
          design: {
            front: { elements: [{ x: 10, y: 10, type: 'TEXT' }] },
            back: null, leftSleeve: null, rightSleeve: null
          }
        }],
        approvedVersion: 1,
        printLocations: ["FRONT"]
      };

      await productionAssetService.generateProductionAssets(mockDesign, 1);
      console.error('❌ Expected productionAssetService to throw UNAVAILABLE error');
    } catch (e) {
      if (e.message === 'PRODUCTION_ASSET_GENERATION_UNAVAILABLE' || e.statusCode === 501) {
        console.log('✅ productionAssetService correctly returns PRODUCTION_ASSET_GENERATION_UNAVAILABLE.');
      } else {
        console.error('❌ productionAssetService threw unexpected error:', e);
      }
    }

    // Test 3: Validate Validation Logic in productionAssetService
    console.log('\n--- Test 3: Validating Production Asset Service Validation ---');
    try {
      const mockDesign2 = {
        versions: [{ version: 1, design: {} }],
        approvedVersion: 2 // Mismatch
      };
      await productionAssetService.generateProductionAssets(mockDesign2, 1);
      console.error('❌ Expected validation error for unapproved version');
    } catch (e) {
      if (e.message.includes('unapproved version')) {
        console.log('✅ Validation correctly rejects generating assets for unapproved version.');
      } else {
        console.error('❌ Unexpected validation error:', e);
      }
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);
  }
}

runTest();
