import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import { Order, IOrder } from '../models/Order';
import { Fulfillment, FulfillmentStatus } from '../models/Fulfillment';
import { getFulfillment, pickFulfillment, packFulfillment } from '../controllers/fulfillmentController';
import { getPackingSlipLines, renderPackingSlipDocument } from '../utils/packingSlipRenderer';
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
const TEST_ADMIN_ID = new mongoose.Types.ObjectId().toString();

const TEST_ADDRESS = {
  fullName: 'Packing Test Customer',
  phone: '9876543210',
  addressLine1: '123 Warehouse Street',
  city: 'Mumbai',
  state: 'Maharashtra',
  postalCode: '400001',
  country: 'India',
  addressType: 'HOME' as const,
};

async function createOrder(): Promise<IOrder> {
  return Order.create({
    orderNumber: `ORD-PACK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId: new mongoose.Types.ObjectId(TEST_OWNER_ID),
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: 'Oversized Heavyweight Tee',
        productImage: 'https://example.com/item.jpg',
        sku: 'TEE-L-BLK',
        selectedSize: 'L',
        selectedColor: 'BLACK',
        quantity: 2,
        unitPrice: 500,
        lineTotal: 1000,
        cancelledQuantity: 1,
      },
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: 'Custom Print Hoodie',
        productImage: 'https://example.com/item.jpg',
        sku: 'HOODIE-M-SAND',
        selectedSize: 'M',
        selectedColor: 'SAND',
        quantity: 1,
        unitPrice: 1899,
        lineTotal: 1899,
        cancelledQuantity: 1,
      },
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: 'Everyday Cap',
        productImage: 'https://example.com/item.jpg',
        sku: 'CAP-FREE-WHT',
        selectedSize: 'FREE',
        selectedColor: 'WHITE',
        quantity: 1,
        unitPrice: 399,
        lineTotal: 399,
        cancelledQuantity: 0,
      },
    ],
    shippingAddress: TEST_ADDRESS,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    initialSubtotal: 3298,
    initialTotal: 3298,
    currency: 'INR',
    status: 'PROCESSING',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    partiallyCancelled: true,
  });
}

function makeReq(orderId: string): Request {
  return {
    params: { id: orderId },
    user: { id: TEST_ADMIN_ID, role: 'ADMIN' },
  } as unknown as Request;
}

function makeRes(): { res: Response; body: { value: any } } {
  const body: { value: any } = { value: undefined };
  const res = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      body.value = payload;
      return this;
    },
  };
  return { res: res as unknown as Response, body };
}

/**
 * PDFKit writes text as hex strings inside TJ operators. Extract and decode
 * them so the rendered slip can be asserted on directly.
 */
function extractPdfText(pdf: string): string {
  const parts: string[] = [];
  const hexString = /<([0-9A-Fa-f]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = hexString.exec(pdf)) !== null) {
    if (match[1].length % 2 !== 0) continue;
    parts.push(Buffer.from(match[1], 'hex').toString('latin1'));
  }
  return parts.join('');
}

async function renderSlip(order: IOrder, fulfillment: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4', compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(extractPdfText(Buffer.concat(chunks).toString('latin1'))));
    renderPackingSlipDocument(doc, order, fulfillment);
    doc.end();
  });
}

async function run() {
  console.log('\n=== Packing Slip Cancellation Regression Tests ===\n');
  await connectSafeTestDb();
  console.log('Connected to verified isolated test database\n');

  try {
    const order = await createOrder();
    const [tee, hoodie, cap] = order.items;

    // Simulates a fulfillment record created BEFORE the cancellations landed:
    // every line still holds its original ordered quantity.
    const legacyFulfillment = await Fulfillment.create({
      orderId: order._id,
      userId: order.userId,
      status: FulfillmentStatus.PICKING,
      items: [
        { orderItemId: tee._id!.toString(), productId: tee.productId, variantId: tee.variantId, productName: tee.productName, selectedSize: tee.selectedSize, selectedColor: tee.selectedColor, quantityOrdered: 2, quantityPicked: 2, quantityPacked: 0 },
        { orderItemId: hoodie._id!.toString(), productId: hoodie.productId, variantId: hoodie.variantId, productName: hoodie.productName, selectedSize: hoodie.selectedSize, selectedColor: hoodie.selectedColor, quantityOrdered: 1, quantityPicked: 1, quantityPacked: 0 },
        { orderItemId: cap._id!.toString(), productId: cap.productId, variantId: cap.variantId, productName: cap.productName, selectedSize: cap.selectedSize, selectedColor: cap.selectedColor, quantityOrdered: 1, quantityPicked: 0, quantityPacked: 0 },
      ],
      packageDetails: { weightGrams: 900 },
      createdBy: TEST_ADMIN_ID,
      updatedBy: TEST_ADMIN_ID,
    });

    const { res, body } = makeRes();
    await getFulfillment(makeReq(order._id.toString()), res);

    check(body.value?.success === true, 'PACK-1 Fulfillment state endpoint succeeds');

    const synced = await Fulfillment.findById(legacyFulfillment._id);
    check(synced?.items[0].quantityOrdered === 1, 'PACK-2 Partially cancelled line keeps only active units');
    check(synced?.items[1].quantityOrdered === 0, 'PACK-3 Fully cancelled line drops to zero units');
    check(synced?.items[2].quantityOrdered === 1, 'PACK-4 Unaffected line keeps its ordered quantity');
    check(synced?.items[0].quantityPicked === 1, 'PACK-5 Already-picked cancelled unit is clamped down');
    check(synced?.items[1].quantityPicked === 0, 'PACK-6 Picked quantity of a cancelled line is cleared');
    check(synced?.status === FulfillmentStatus.PICKING, 'PACK-7 Partially cancelled fulfillment stays in picking');

    const lines = getPackingSlipLines(order, synced!);
    check(lines.packableLines.length === 2, 'PACK-8 Packing slip drops fully cancelled lines');
    check(
      lines.packableLines.every((line) => line.item.productName !== 'Custom Print Hoodie'),
      'PACK-9 Cancelled product never appears on the packing slip'
    );
    check(
      lines.packableLines[0].cancelledQuantity === 1,
      'PACK-10 Surviving line reports how many units were cancelled'
    );
    check(lines.cancelledUnits === 2, 'PACK-11 Slip footnote counts every cancelled unit');

    const partialSlip = await renderSlip(order, synced!);
    check(partialSlip.includes('Oversized Heavyweight Tee'), 'PACK-12 Slip lists the partially cancelled product');
    check(partialSlip.includes('Everyday Cap'), 'PACK-13 Slip lists unaffected products');
    check(!partialSlip.includes('Custom Print Hoodie'), 'PACK-14 Slip omits the fully cancelled product');
    check(partialSlip.includes('1 cancelled'), 'PACK-15 Slip annotates partially cancelled units');
    check(
      partialSlip.includes('cancelled & refunded unit(s) are excluded from this slip'),
      'PACK-16 Slip warns that cancelled units must not be packed'
    );
    check(partialSlip.includes('Qty to Pack'), 'PACK-17 Slip header asks for packable units only');
    check(synced?.items[0].sku === 'TEE-L-BLK', 'PACK-17a Fulfilment line inherits the SKU from the order item');
    check(partialSlip.includes('SKU: TEE-L-BLK'), 'PACK-17b Slip prints the product code of a packable line');
    check(partialSlip.includes('SKU: CAP-FREE-WHT'), 'PACK-17c Slip prints every packable product code');
    check(!partialSlip.includes('HOODIE-M-SAND'), 'PACK-17d Cancelled product code is not printed');

    // Now cancel everything that is left.
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          status: 'CANCELLED',
          paymentStatus: 'REFUNDED',
          partiallyCancelled: false,
          'items.0.cancelledQuantity': 2,
          'items.2.cancelledQuantity': 1,
        },
      }
    );

    const fullyCancelledOrder = (await Order.findById(order._id))!;
    const secondRes = makeRes();
    await getFulfillment(makeReq(order._id.toString()), secondRes.res);

    const cancelledFulfillment = await Fulfillment.findById(legacyFulfillment._id);
    check(
      cancelledFulfillment?.status === FulfillmentStatus.CANCELLED,
      'PACK-18 Fully cancelled order cancels the fulfillment record'
    );
    check(
      cancelledFulfillment?.items.every((item) => item.quantityOrdered === 0) === true,
      'PACK-19 Every line of a fully cancelled order drops to zero'
    );

    const cancelledLines = getPackingSlipLines(fullyCancelledOrder, cancelledFulfillment!);
    check(cancelledLines.packableLines.length === 0, 'PACK-20 Nothing remains packable');

    const pickAttempt = makeRes();
    await pickFulfillment(makeReq(order._id.toString()), pickAttempt.res);
    check(
      (pickAttempt.res as any).statusCode === 400 &&
        String(pickAttempt.body.value?.message || '').includes('cancelled'),
      'PACK-20a Picking is blocked once every unit is cancelled'
    );

    const packAttempt = makeRes();
    await packFulfillment(makeReq(order._id.toString()), packAttempt.res);
    check(
      (packAttempt.res as any).statusCode === 400 &&
        String(packAttempt.body.value?.message || '').includes('cancelled'),
      'PACK-20b Packing is blocked once every unit is cancelled',
      `status=${(packAttempt.res as any).statusCode} message=${packAttempt.body.value?.message}`
    );

    const cancelledSlip = await renderSlip(fullyCancelledOrder, cancelledFulfillment!);
    check(
      cancelledSlip.includes('All items on this order were cancelled and refunded'),
      'PACK-21 Fully cancelled slip prints the empty-state warning'
    );
    check(
      cancelledSlip.includes('DO NOT PACK OR DISPATCH THIS ORDER'),
      'PACK-22 Fully cancelled slip blocks packing explicitly'
    );
    check(
      !cancelledSlip.includes('Oversized Heavyweight Tee') &&
        !cancelledSlip.includes('Custom Print Hoodie') &&
        !cancelledSlip.includes('Everyday Cap'),
      'PACK-23 Fully cancelled slip lists no products at all'
    );
    check(cancelledSlip.includes('Units to pack: 0'), 'PACK-24 Fully cancelled slip reports zero units to pack');
    check(!cancelledSlip.includes('SKU:'), 'PACK-24a Fully cancelled slip prints no product codes');

    // A clean order must keep behaving exactly as before.
    const cleanOrder = await Order.create({
      orderNumber: `ORD-PACK-CLEAN-${Date.now()}`,
      userId: new mongoose.Types.ObjectId(TEST_OWNER_ID),
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          variantId: new mongoose.Types.ObjectId(),
          productName: 'Clean Order Tee',
        productImage: 'https://example.com/item.jpg',
        sku: 'CLEAN-M-NAVY',
          selectedSize: 'M',
          selectedColor: 'NAVY',
          quantity: 2,
          unitPrice: 600,
          lineTotal: 1200,
        },
      ],
      shippingAddress: TEST_ADDRESS,
      subtotal: 1200,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 1200,
      currency: 'INR',
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY',
    });

    const cleanRes = makeRes();
    await getFulfillment(makeReq(cleanOrder._id.toString()), cleanRes.res);
    const cleanFulfillment = await Fulfillment.findOne({ orderId: cleanOrder._id });
    check(cleanFulfillment?.items[0].quantityOrdered === 2, 'PACK-25 Clean order keeps its full ordered quantity');
    check(cleanFulfillment?.status === FulfillmentStatus.UNALLOCATED, 'PACK-26 Clean order starts unallocated');

    const cleanSlip = await renderSlip(cleanOrder, cleanFulfillment!);
    check(cleanSlip.includes('Clean Order Tee'), 'PACK-27 Clean slip lists its product');
    check(!cleanSlip.includes('cancelled'), 'PACK-28 Clean slip has no cancellation messaging');
    check(cleanSlip.includes('SKU: CLEAN-M-NAVY'), 'PACK-29 Clean slip prints the product code');
  } finally {
    await Order.deleteMany({ userId: TEST_OWNER_ID });
    await Fulfillment.deleteMany({ userId: TEST_OWNER_ID });
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
