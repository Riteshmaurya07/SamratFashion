import mongoose from 'mongoose';
import { Request, Response, NextFunction } from 'express';
import { connectSafeTestDb } from './testHelpers';
import { Order } from '../models/Order';
import { ReturnRequest } from '../models/ReturnRequest';
import { AuditLog } from '../models/AuditLog';
import { createReturn } from '../controllers/returnController';

async function runTests(): Promise<void> {
  await connectSafeTestDb();
  const userId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const variantId = new mongoose.Types.ObjectId();
  const orderIds: mongoose.Types.ObjectId[] = [];

  try {
    const order = await Order.create({
      orderNumber: `RETURN-RACE-${Date.now()}`,
      userId,
      items: [1, 2].map(() => ({
        productId,
        variantId,
        productName: 'Return race regression item',
        productImage: 'https://example.com/item.jpg',
        selectedSize: 'M',
        selectedColor: 'BLACK',
        quantity: 1,
        unitPrice: 1000,
        lineTotal: 1000,
      })),
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9876543210',
        addressLine1: 'Test Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560038',
        country: 'India',
        addressType: 'HOME',
      },
      subtotal: 2000,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 2000,
      currency: 'INR',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      deliveredAt: new Date(),
    });
    orderIds.push(order._id);

    const submitReturn = async () => {
      let statusCode = 200;
      let nextError: unknown;
      const request = {
        user: { id: userId.toString(), role: 'CUSTOMER' },
        params: { id: order._id.toString() },
        body: { items: [{ variantId: variantId.toString(), quantity: 2, reason: 'WRONG_SIZE' }] },
      } as unknown as Request;
      const response = {
        status(code: number) { statusCode = code; return this; },
        json() { return this; },
      };
      const next: NextFunction = error => { nextError = error; };

      await createReturn(request, response as unknown as Response, next);
      return { statusCode, nextError };
    };

    const outcomes = await Promise.all(Array.from({ length: 8 }, submitReturn));
    const createdCount = await ReturnRequest.countDocuments({ orderId: order._id });
    const successCount = outcomes.filter(outcome => outcome.statusCode === 201).length;
    const rejectedCount = outcomes.filter(outcome => outcome.nextError).length;
    if (createdCount !== 1 || successCount !== 1 || rejectedCount !== 7) {
      throw new Error(
        `Expected one return request from concurrent submissions; got ${createdCount} saved, ${successCount} successful, ${rejectedCount} rejected`
      );
    }

    console.log('PASS: concurrent return submissions cannot exceed purchased quantity');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST: DUPLICATE RETURN LINES CANNOT EXCEED PURCHASED QUANTITY
    // ─────────────────────────────────────────────────────────────────────────────
    const dupLineOrder = await Order.create({
      orderNumber: `RETURN-DUP-${Date.now()}`,
      userId,
      items: [{
        productId,
        variantId,
        productName: 'Duplicate line test item',
        productImage: 'https://example.com/item.jpg',
        selectedSize: 'M',
        selectedColor: 'BLACK',
        quantity: 2, // Purchased quantity = 2
        unitPrice: 1000,
        lineTotal: 2000,
      }],
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9876543210',
        addressLine1: 'Test Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560038',
        country: 'India',
        addressType: 'HOME',
      },
      subtotal: 2000,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 2000,
      currency: 'INR',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      deliveredAt: new Date(),
    });
    orderIds.push(dupLineOrder._id);

    // 1. Duplicate return lines exceeding purchased quantity (2 + 1 = 3 > 2) must be rejected
    let dupExceedError: any = null;
    let dupExceedStatus = 200;
    const dupExceedReq = {
      user: { id: userId.toString(), role: 'CUSTOMER' },
      params: { id: dupLineOrder._id.toString() },
      body: {
        items: [
          { variantId: variantId.toString(), quantity: 2, reason: 'WRONG_SIZE' },
          { variantId: variantId.toString(), quantity: 1, reason: 'DEFECTIVE' },
        ],
      },
    } as unknown as Request;
    const dupExceedRes = {
      status(code: number) { dupExceedStatus = code; return this; },
      json() { return this; },
    };
    await createReturn(dupExceedReq, dupExceedRes as unknown as Response, (err) => { dupExceedError = err; });

    if (!dupExceedError || dupExceedError.statusCode !== 400 || !dupExceedError.message.includes('Cannot return')) {
      throw new Error(`Expected duplicate return lines exceeding purchased quantity to be rejected with 400, got: ${dupExceedError?.message || dupExceedStatus}`);
    }
    console.log('PASS: duplicate return lines exceeding purchased quantity in a single request are rejected with 400');

    // 2. Duplicate return lines within purchased quantity (1 + 1 = 2 <= 2) must succeed
    let dupValidError: any = null;
    let dupValidStatus = 200;
    const dupValidReq = {
      user: { id: userId.toString(), role: 'CUSTOMER' },
      params: { id: dupLineOrder._id.toString() },
      body: {
        items: [
          { variantId: variantId.toString(), quantity: 1, reason: 'WRONG_SIZE' },
          { variantId: variantId.toString(), quantity: 1, reason: 'DEFECTIVE' },
        ],
      },
    } as unknown as Request;
    const dupValidRes = {
      status(code: number) { dupValidStatus = code; return this; },
      json() { return this; },
    };
    await createReturn(dupValidReq, dupValidRes as unknown as Response, (err) => { dupValidError = err; });

    if (dupValidError || dupValidStatus !== 201) {
      throw new Error(`Expected duplicate return lines within purchased quantity to succeed with 201, got error: ${dupValidError?.message || dupValidStatus}`);
    }
    console.log('PASS: duplicate return lines within purchased quantity are accepted with 201');

    // 3. Subsequent return line after limit reached must be rejected
    let subsequentError: any = null;
    let subsequentStatus = 200;
    const subsequentReq = {
      user: { id: userId.toString(), role: 'CUSTOMER' },
      params: { id: dupLineOrder._id.toString() },
      body: {
        items: [
          { variantId: variantId.toString(), quantity: 1, reason: 'WRONG_SIZE' },
        ],
      },
    } as unknown as Request;
    const subsequentRes = {
      status(code: number) { subsequentStatus = code; return this; },
      json() { return this; },
    };
    await createReturn(subsequentReq, subsequentRes as unknown as Response, (err) => { subsequentError = err; });

    if (!subsequentError || subsequentError.statusCode !== 400) {
      throw new Error(`Expected subsequent return exceeding purchased quantity to be rejected with 400, got: ${subsequentError?.message || subsequentStatus}`);
    }
    console.log('PASS: duplicate return line after purchased quantity exhausted is rejected with 400');
  } finally {
    await ReturnRequest.deleteMany({ orderId: { $in: orderIds } });
    await AuditLog.deleteMany({ entityId: { $in: orderIds }, action: 'RETURN_REQUESTED' });
    await Order.deleteMany({ _id: { $in: orderIds } });
    await mongoose.disconnect();
  }
}

runTests().catch(error => {
  console.error('Return request concurrency test failed:', error);
  process.exit(1);
});
