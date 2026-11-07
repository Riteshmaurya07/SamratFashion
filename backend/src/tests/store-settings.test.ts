import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import mongoose from 'mongoose';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { Cart } from '../models/Cart';
import { AuditLog } from '../models/AuditLog';
import { StoreSettings } from '../models/StoreSettings';
import { getCart } from '../controllers/cartController';
import { updateAdminStoreSettings } from '../controllers/storeSettingsController';
import {
  STORE_SETTINGS_DEFAULTS,
  calculateShipping,
  getStoreSettings,
  saveStoreSettings,
} from '../services/storeSettingsService';

function mockRes(resolve: (value: any) => void): any {
  const res: any = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.data = data;
      resolve({ statusCode: this.statusCode, data, err: null });
      return this;
    },
  };
  return res;
}

function invoke(handler: any, req: any): Promise<{ statusCode: number; data: any; err: any }> {
  return new Promise((resolve) => {
    const res = mockRes(resolve);
    handler(req, res, (err: any) => resolve({ statusCode: res.statusCode, data: null, err }));
  });
}

async function run() {
  await connectSafeTestDb();

  let passed = 0;
  let failed = 0;
  const check = (condition: boolean, message: string) => {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${message}`);
      failed++;
    }
  };

  // Clean only the collections this suite owns.
  await Promise.all([
    StoreSettings.deleteMany({}),
    Cart.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);

  console.log('\n[SETTINGS-1] Missing document falls back to historical defaults');
  {
    const settings = await getStoreSettings();
    check(
      settings.freeShippingThreshold === STORE_SETTINGS_DEFAULTS.freeShippingThreshold,
      `Default free-delivery threshold is ${STORE_SETTINGS_DEFAULTS.freeShippingThreshold}`
    );
    check(
      settings.standardShippingFee === STORE_SETTINGS_DEFAULTS.standardShippingFee,
      `Default delivery fee is ${STORE_SETTINGS_DEFAULTS.standardShippingFee}`
    );
  }

  console.log('\n[SETTINGS-2] Shipping calculation respects threshold and fee');
  {
    check(
      calculateShipping(400, 0, { freeShippingThreshold: 499, standardShippingFee: 49 }) === 49,
      'Order below threshold is charged the configured fee'
    );
    check(
      calculateShipping(499, 0, { freeShippingThreshold: 499, standardShippingFee: 49 }) === 0,
      'Order exactly at threshold ships free'
    );
    check(
      calculateShipping(600, 150, { freeShippingThreshold: 499, standardShippingFee: 49 }) === 49,
      'Discount is applied before the threshold is checked'
    );
    check(
      calculateShipping(3, 0, { freeShippingThreshold: 499, standardShippingFee: 49 }) === 49,
      'Small orders below the threshold are charged the configured fee'
    );
    check(
      calculateShipping(100, 0, { freeShippingThreshold: 0, standardShippingFee: 49 }) === 0,
      'Threshold of 0 makes every order free'
    );
    check(
      calculateShipping(100, 0, { freeShippingThreshold: 499, standardShippingFee: 0 }) === 0,
      'Fee of 0 never charges delivery'
    );
    check(calculateShipping(0, 0, { freeShippingThreshold: 499, standardShippingFee: 49 }) === 0, 'Empty cart has no shipping');
  }

  console.log('\n[SETTINGS-3] Cart summary uses the saved settings');
  {
    const { product, variantIds } = await createTestProduct({ basePrice: 400 });
    const userId = new mongoose.Types.ObjectId();
    await Cart.create({
      userId,
      items: [{ productId: product._id, variantId: variantIds[0], quantity: 1 }],
    });

    const before = await invoke(getCart, { user: { id: userId.toString() } });
    check(before.err === null, 'Cart summary request succeeds with default settings');
    check(before.data?.data?.summary?.shipping === 100, 'Default cart shipping is ₹100 below ₹999');
    check(
      before.data?.data?.summary?.freeShippingThreshold === 999,
      'Cart summary exposes the active threshold'
    );

    await saveStoreSettings({ freeShippingThreshold: 499, standardShippingFee: 49 });
    const after = await invoke(getCart, { user: { id: userId.toString() } });
    check(after.err === null, 'Cart summary request succeeds after settings update');
    check(after.data?.data?.summary?.shipping === 49, 'Cart shipping uses the new ₹49 fee');
    check(
      after.data?.data?.summary?.freeShippingThreshold === 499,
      'Cart summary reflects the new ₹499 threshold'
    );

    product.basePrice = 2;
    await product.save();
    const tiny = await invoke(getCart, { user: { id: userId.toString() } });
    check(tiny.err === null, 'Cart summary request succeeds for a ₹2 order');
    check(
      tiny.data?.data?.summary?.shipping === 49,
      'A ₹2 order below the ₹499 threshold is charged ₹49 instead of showing free'
    );

    product.basePrice = 500;
    await product.save();
    const free = await invoke(getCart, { user: { id: userId.toString() } });
    check(free.err === null, 'Cart summary request succeeds for order at threshold');
    check(free.data?.data?.summary?.shipping === 0, 'Cart shipping is free at the configured threshold');
  }

  console.log('\n[SETTINGS-3b] Per-product free delivery overrides the threshold');
  {
    check(
      calculateShipping(2, 0, { freeShippingThreshold: 499, standardShippingFee: 49 }, {
        allItemsFreeDelivery: true,
      }) === 0,
      'An all-free-delivery cart ships free below the threshold'
    );
    check(
      calculateShipping(2, 0, { freeShippingThreshold: 499, standardShippingFee: 49 }, {
        allItemsFreeDelivery: false,
      }) === 49,
      'A cart without free delivery still pays the fee'
    );

    const freeProduct = await createTestProduct({ basePrice: 2, freeDelivery: true });
    const freeUserId = new mongoose.Types.ObjectId();
    await Cart.create({
      userId: freeUserId,
      items: [{ productId: freeProduct.product._id, variantId: freeProduct.variantIds[0], quantity: 1 }],
    });

    const freeCart = await invoke(getCart, { user: { id: freeUserId.toString() } });
    check(freeCart.err === null, 'Cart summary request succeeds for a free-delivery product');
    check(freeCart.data?.data?.summary?.shipping === 0, 'A ₹2 free-delivery product ships free');
    check(
      freeCart.data?.data?.summary?.allItemsFreeDelivery === true,
      'Cart summary reports that every item is free delivery'
    );

    const normalProduct = await createTestProduct({ basePrice: 2 });
    await Cart.updateOne(
      { userId: freeUserId },
      {
        $push: {
          items: { productId: normalProduct.product._id, variantId: normalProduct.variantIds[0], quantity: 1 },
        },
      }
    );

    const mixedCart = await invoke(getCart, { user: { id: freeUserId.toString() } });
    check(mixedCart.err === null, 'Cart summary request succeeds for a mixed cart');
    check(
      mixedCart.data?.data?.summary?.shipping === 49,
      'A mixed cart falls back to the normal threshold rule'
    );
    check(
      mixedCart.data?.data?.summary?.allItemsFreeDelivery === false,
      'Cart summary reports that not every item is free delivery'
    );
  }

  console.log('\n[SETTINGS-4] Admin controller validates and persists');
  {
    const adminId = new mongoose.Types.ObjectId();

    const invalid = await invoke(updateAdminStoreSettings, {
      body: { freeShippingThreshold: -1, standardShippingFee: 49 },
      user: { id: adminId.toString(), role: 'ADMIN' },
    });
    check(invalid.err?.statusCode === 400, 'Negative threshold is rejected with HTTP 400');

    const missing = await invoke(updateAdminStoreSettings, {
      body: { freeShippingThreshold: 'abc', standardShippingFee: 49 },
      user: { id: adminId.toString(), role: 'ADMIN' },
    });
    check(missing.err?.statusCode === 400, 'Non-numeric threshold is rejected');

    const saved = await invoke(updateAdminStoreSettings, {
      body: { freeShippingThreshold: 499, standardShippingFee: 49 },
      user: { id: adminId.toString(), role: 'ADMIN' },
    });
    check(saved.err === null && saved.statusCode === 200, 'Valid settings are saved');
    check(
      saved.data?.data?.freeShippingThreshold === 499 &&
        saved.data?.data?.standardShippingFee === 49,
      'Save response returns the persisted values'
    );

    const doc = await StoreSettings.findOne({ key: 'default' });
    check(Boolean(doc), 'Singleton settings document exists');
    check(doc?.freeShippingThreshold === 499 && doc?.standardShippingFee === 49, 'Database stores ₹499 / ₹49');

    const audit = await AuditLog.findOne({ action: 'ADMIN_STORE_SETTINGS_UPDATED' });
    check(Boolean(audit), 'Settings change writes an audit log entry');
    check(
      audit?.metadata?.updated?.freeShippingThreshold === 499,
      'Audit log captures the updated threshold'
    );
  }

  await mongoose.disconnect();

  console.log('\n══════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

run().catch(async (error) => {
  console.error('Settings test error:', error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
