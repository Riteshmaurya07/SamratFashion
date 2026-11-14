import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { Invoice } from '../models/Invoice';
import { Product, ProductStatus } from '../models/Product';
import { getOrCreateInvoiceForOrder } from '../controllers/invoiceController';
import { backfillOrderItemSkus } from '../services/skuService';
import { findDuplicateSkus, isDuplicateSkuError, normalizeSku } from '../utils/skuFormat';
import { connectSafeTestDb } from './testHelpers';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, name: string, details?: string) {
  if (cond) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    const msg = `  FAIL: ${name}${details ? ` - ${details}` : ''}`;
    console.error(msg);
    failures.push(msg);
    failed++;
  }
}

const TEST_OWNER_ID = new mongoose.Types.ObjectId().toString();
const SKU_PREFIX = 'SKUINTEG';

const ADDRESS = {
  fullName: 'SKU Test Customer',
  phone: '9876543210',
  addressLine1: '1 Test Street',
  city: 'Mumbai',
  state: 'Maharashtra',
  postalCode: '400001',
  country: 'India',
  addressType: 'HOME' as const,
};

async function createProduct(slugSuffix: string, skus: string[]) {
  return Product.create({
    name: `SKU Integrity Tee ${slugSuffix}`,
    slug: `sku-integrity-${slugSuffix}`,
    description: 'SKU uniqueness test product',
    categoryId: new mongoose.Types.ObjectId(),
    basePrice: 500,
    images: ['https://example.com/sku-tee.jpg'],
    status: ProductStatus.ACTIVE,
    variants: skus.map((sku, index) => ({
      size: ['S', 'M', 'L', 'XL'][index] || 'M',
      color: 'BLACK',
      sku,
      stock: 10,
      additionalPrice: 0,
      images: [],
      isAvailable: true,
    })),
  }) as any;
}

async function run() {
  console.log('\n=== SKU Integrity Regression Tests ===\n');
  await connectSafeTestDb();
  console.log('Connected to verified isolated test database\n');

  try {
    // ─── 1. Canonicalisation ────────────────────────────────────────────
    check(normalizeSku('  tv-ovr-blk-m ') === 'TV-OVR-BLK-M', 'SKU-1 SKUs are trimmed and upper-cased');
    check(normalizeSku(undefined) === '', 'SKU-2 Missing SKUs normalise to an empty code');

    const duplicates = findDuplicateSkus([{ sku: 'abc' }, { sku: ' ABC ' }, { sku: 'XYZ' }]);
    check(
      duplicates.length === 1 && duplicates[0] === 'ABC',
      'SKU-3 Duplicate detection is case and whitespace insensitive',
      JSON.stringify(duplicates)
    );

    check(
      isDuplicateSkuError({ code: 11000, keyPattern: { 'variants.sku': 1 } }),
      'SKU-3a Unique-index violations on variants.sku are recognised as SKU conflicts'
    );
    check(
      !isDuplicateSkuError({ code: 11000, keyPattern: { slug: 1 } }),
      'SKU-3b Other duplicate-key errors are not misreported as SKU conflicts'
    );

    // ─── 2. Database-level guarantee ────────────────────────────────────
    await Product.deleteMany({ slug: /^sku-integrity-/ });
    let indexReady = true;
    try {
      await Product.init();
    } catch (error) {
      indexReady = false;
      console.error('  Product.init() failed:', (error as Error).message);
    }
    check(indexReady, 'SKU-4 Catalog unique-SKU index is buildable');

    const uniqueSuffix = `${Date.now()}`;
    const productA = await createProduct(`a-${uniqueSuffix}`, [`${SKU_PREFIX}-BLK-M`, `${SKU_PREFIX}-BLK-L`]);
    check(
      productA.variants.map((v: any) => v.sku).join(',') === `${SKU_PREFIX}-BLK-M,${SKU_PREFIX}-BLK-L`,
      'SKU-5 New variants keep their canonical SKUs'
    );

    let crossProductRejected = false;
    try {
      await createProduct(`b-${uniqueSuffix}`, [`${SKU_PREFIX}-BLK-M`]);
    } catch (error) {
      const code = (error as { code?: number }).code;
      crossProductRejected = code === 11000;
    }
    check(crossProductRejected, 'SKU-6 Two products can never share the same SKU');

    let lowerCaseRejected = false;
    try {
      await createProduct(`c-${uniqueSuffix}`, [`${SKU_PREFIX.toLowerCase()}-blk-l`]);
    } catch (error) {
      lowerCaseRejected = (error as { code?: number }).code === 11000;
    }
    check(lowerCaseRejected, 'SKU-7 A lower-case duplicate is rejected as the same code');

    let withinProductRejected = false;
    try {
      await createProduct(`d-${uniqueSuffix}`, [`${SKU_PREFIX}-DUP-M`, `${SKU_PREFIX}-dup-m`]);
    } catch (error) {
      withinProductRejected = /duplicate skus/i.test((error as Error).message);
    }
    check(withinProductRejected, 'SKU-8 A product cannot repeat a SKU across its own variants');

    const dropped = await Product.deleteOne({ _id: productA._id });
    check(dropped.deletedCount === 1, 'SKU-9 Test product cleanup succeeds');

    // ─── 3. SKUs on order / invoice snapshots ───────────────────────────
    const product = await createProduct(`order-${uniqueSuffix}`, [`${SKU_PREFIX}-ORDER-M`]);
    const variant = product.variants[0];

    const legacyOrder = await Order.create({
      orderNumber: `ORD-SKU-${Date.now()}`,
      userId: new mongoose.Types.ObjectId(TEST_OWNER_ID),
      items: [
        {
          productId: product._id,
          variantId: variant._id,
          productName: product.name,
          productImage: 'https://example.com/sku-tee.jpg',
          selectedSize: variant.size,
          selectedColor: variant.color,
          quantity: 1,
          unitPrice: 500,
          lineTotal: 500,
        },
      ],
      shippingAddress: ADDRESS,
      subtotal: 500,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 500,
      currency: 'INR',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY',
    });

    check(!legacyOrder.items[0].sku, 'SKU-10 Legacy order lines start without a code');

    const backfilled = await backfillOrderItemSkus(legacyOrder);
    check(backfilled === true, 'SKU-11 Legacy order SKUs are resolved from the catalog');
    check(
      legacyOrder.items[0].sku === `${SKU_PREFIX}-ORDER-M`,
      'SKU-12 Resolved SKU is persisted on the order line'
    );

    const invoice = await getOrCreateInvoiceForOrder(legacyOrder._id.toString());
    check(
      invoice.itemsSnapshot[0].sku === `${SKU_PREFIX}-ORDER-M`,
      'SKU-13 Invoice snapshot carries the product code'
    );

    const invoiceReloaded = await Invoice.findById(invoice._id);
    check(
      invoiceReloaded?.itemsSnapshot[0].sku === `${SKU_PREFIX}-ORDER-M`,
      'SKU-14 Product code survives the invoice round-trip to MongoDB'
    );

    await Order.deleteMany({ userId: TEST_OWNER_ID });
    await Invoice.deleteMany({ userId: TEST_OWNER_ID });
    await Product.deleteMany({ slug: /^sku-integrity-/ });
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════');
  if (failed > 0) {
    failures.forEach((failure) => console.error(failure));
    process.exit(1);
  }
}

run().catch((error) => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
